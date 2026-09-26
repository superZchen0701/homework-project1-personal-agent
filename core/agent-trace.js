/**
 * Agent Trace 日志
 * 记录每次 LLM 调用与工具调用的：输入输出摘要、Token 消耗、耗时
 *
 * 埋点位置（全项目 LLM/工具调用的两个收敛点）：
 *   1. core/llm.js chatCompletion —— type:'llm' span，含 API 返回的真实 usage
 *      （流式通过 stream_options.include_usage 获取；拿不到时退化为字符估算）
 *   2. core/agent.js _handleToolCalls —— type:'tool' span
 *
 * 使用方式（全局单例，进程内共享）：
 *   import { agentTrace } from './agent-trace.js';
 *   const span = agentTrace.beginLLM('ReAct._sendMessages', { messages, stream: true });
 *   ...await LLM 调用...
 *   span.end({ result: message, usage: completion.usage });
 *
 * 开关：.env 中 TRACE_ENABLED=false 可整体关闭（默认开启，仅内存开销，无 I/O）
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { countMessagesTokens } from './message.js';

// 自行加载 .env：本模块被 llm.js import 时先于其执行，不能依赖外部先完成 dotenv 加载
// dotenv 幂等：已存在的环境变量不会被覆盖
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// 全局开关：默认开启；关闭后所有 begin* 返回空操作 span，零开销
const TRACE_ENABLED = process.env.TRACE_ENABLED !== 'false';

// 预览截断长度：entry 里只存输入输出预览，避免长内容撑爆内存
const PREVIEW_CHARS = 160;

// 最大保留条目数：环形淘汰最旧记录，防止长会话内存膨胀
const MAX_ENTRIES = 1000;

const _truncate = (s) => {
  const str = String(s ?? '');
  return str.length > PREVIEW_CHARS ? `${str.slice(0, PREVIEW_CHARS)}…(${str.length} chars)` : str;
};

class TraceSpan {
  /**
   * @param {AgentTrace|null} trace  为 null 表示 Trace 已关闭，全操作空转
   * @param {object} entry           预填好的条目骨架（ts/type/label/input...）
   */
  constructor(trace, entry) {
    this._trace = trace;
    this._entry = entry;
    this._start = Date.now();
    this._ended = false;
  }

  /**
   * 结束 span：补齐输出/usage/耗时/错误并落盘（内存）
   * @param {object} [data]
   * @param {object} [data.result]   输出对象：LLM message 或工具结果字符串
   * @param {object} [data.usage]    API 返回的 usage（{prompt_tokens,completion_tokens,total_tokens}）
   * @param {Error}  [data.error]    失败时传错误对象
   */
  end({ result, usage, error } = {}) {
    if (this._ended || !this._trace) return this;
    this._ended = true;
    const e = this._entry;
    e.durationMs = Date.now() - this._start;
    if (error) {
      e.error = error.message || String(error);
    } else {
      // 输出摘要：工具结果是字符串，LLM message 取 content/tool_calls
      const outStr = typeof result === 'string' ? result : result?.content ?? JSON.stringify(result?.tool_calls ?? '');
      e.output = { chars: String(outStr ?? '').length, preview: _truncate(outStr) };
    }
    // Token 消耗：优先用 API 真实 usage；流式未返回 usage 时按字符估算并标注来源
    if (usage && typeof usage.total_tokens === 'number') {
      e.usage = {
        prompt_tokens: usage.prompt_tokens ?? 0,
        completion_tokens: usage.completion_tokens ?? 0,
        total_tokens: usage.total_tokens,
        source: 'api',
      };
    } else {
      // 无 API usage 时按字符数粗估（与 estimateTokens 同口径：4 字符 ≈ 1 token）
      const completionTokens = Math.ceil((e.output?.chars ?? 0) / 4);
      e.usage = { completion_tokens: completionTokens, total_tokens: completionTokens, source: 'estimated' };
    }
    this._trace._push(e);
    return this;
  }
}

class AgentTrace {
  constructor({ maxEntries = MAX_ENTRIES, enabled = TRACE_ENABLED } = {}) {
    this.enabled = enabled;
    this.maxEntries = maxEntries;
    this._entries = [];
    this._seq = 0;
  }

  /** 开启一个 LLM 调用 span */
  beginLLM(label, { messages = [], tools, stream = false } = {}) {
    if (!this.enabled) return new TraceSpan(null);
    const entry = {
      id: ++this._seq,
      ts: new Date().toISOString(),
      type: 'llm',
      label,
      stream,
      input: {
        messageCount: messages.length,
        chars: messages.reduce((s, m) => s + String(m.content ?? '').length, 0),
        tokens: countMessagesTokens(messages),
        preview: _truncate(messages.at(-1)?.content ?? ''),
        toolCount: tools?.length || 0,
      },
    };
    return new TraceSpan(this, entry);
  }

  /** 开启一个工具调用 span */
  beginTool(agentName, toolName, args) {
    if (!this.enabled) return new TraceSpan(null);
    const entry = {
      id: ++this._seq,
      ts: new Date().toISOString(),
      type: 'tool',
      label: `${agentName} → ${toolName}`,
      input: { chars: JSON.stringify(args ?? {}).length, preview: _truncate(JSON.stringify(args ?? {})) },
    };
    return new TraceSpan(this, entry);
  }

  /** @private 环形落盘 */
  _push(entry) {
    this._entries.push(entry);
    if (this._entries.length > this.maxEntries) this._entries.shift();
  }

  /** 汇总统计：按类型聚合次数/Token/耗时，llm 按来源 label 细分 */
  stats() {
    const s = {
      entries: this._entries.length,
      llm: { count: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0, byLabel: {}, errors: 0 },
      tool: { count: 0, durationMs: 0, byTool: {}, errors: 0 },
    };
    for (const e of this._entries) {
      const bucket = s[e.type];
      if (!bucket) continue;
      bucket.count += 1;
      bucket.durationMs += e.durationMs || 0;
      if (e.error) bucket.errors += 1;
      if (e.type === 'llm') {
        bucket.promptTokens += e.usage?.prompt_tokens || 0;
        bucket.completionTokens += e.usage?.completion_tokens || 0;
        bucket.totalTokens += e.usage?.total_tokens || 0;
        bucket.byLabel[e.label] = (bucket.byLabel[e.label] || 0) + 1;
      } else {
        const toolName = e.label.split(' → ')[1] || e.label;
        bucket.byTool[toolName] = (bucket.byTool[toolName] || 0) + 1;
      }
    }
    return s;
  }

  /** 最近 N 条记录 */
  recent(n = 10) {
    return this._entries.slice(-n);
  }

  /** 导出全部记录为 JSON 字符串（供落盘分析） */
  exportJSON() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), stats: this.stats(), entries: this._entries }, null, 2);
  }

  clear() {
    this._entries = [];
    this._seq = 0;
  }

  /** 格式化打印统计 + 最近记录（CLI /trace 命令用） */
  printSummary(recentN = 8) {
    const s = this.stats();
    console.log('\n📊 Trace 统计');
    console.log(
      `  LLM: ${s.llm.count} 次 | 输入 ${s.llm.promptTokens} tok | 输出 ${s.llm.completionTokens} tok | 合计 ${s.llm.totalTokens} tok | 耗时 ${(s.llm.durationMs / 1000).toFixed(1)}s${s.llm.errors ? ` | ❌ ${s.llm.errors} 次失败` : ''}`
    );
    const labelDetail = Object.entries(s.llm.byLabel).map(([k, v]) => `${k}×${v}`).join(', ');
    if (labelDetail) console.log(`  └─ ${labelDetail}`);
    const toolDetail = Object.entries(s.tool.byTool).map(([k, v]) => `${k}×${v}`).join(', ');
    console.log(
      `  工具: ${s.tool.count} 次 | 耗时 ${(s.tool.durationMs / 1000).toFixed(1)}s${toolDetail ? ` | ${toolDetail}` : ''}`
    );
    if (!this._entries.length) return;
    console.log(`\n  最近 ${Math.min(recentN, this._entries.length)} 条:`);
    for (const e of this.recent(recentN)) {
      const icon = e.type === 'llm' ? '🧠' : '🔧';
      const tok = e.type === 'llm' && e.usage ? ` [${e.usage.total_tokens} tok${e.usage.source === 'estimated' ? '~' : ''}]` : '';
      const err = e.error ? ` ❌ ${e.error.slice(0, 60)}` : '';
      console.log(`  ${icon} #${e.id} ${e.label}${e.stream ? ' (stream)' : ''}${tok} ${e.durationMs}ms${err}`);
      console.log(`     ⤷ ${e.input.preview ?? ''}${e.output ? ` ⇒ ${e.output.preview}` : ''}`);
    }
  }
}

// 全局单例：与 llmClient 同模式，进程内共享一份 Trace 数据
export const agentTrace = new AgentTrace();
export { AgentTrace, TraceSpan };
export default agentTrace;
