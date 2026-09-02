/**
 * Agent 基类
 * 定义所有范式（ReAct / PlanAndSolve / Reflection）共享的通用行为：
 *   - 持有 LLM 客户端 + 工具注册中心 + 记忆管理器
 *   - 统一的 LLM 调用入口 _sendMessages
 *   - 统一的工具结果回传 _handleToolCalls（Function Calling）
 *
 * 具体范式的"思考-行动"流程在子类 run() 中实现
 */
import { llmClient, DEFAULT_MODEL, chatCompletion } from './llm.js';

// Function Calling 全局开关：读 .env 的 ENABLE_FUNCTION_CALLING，默认关闭（走 ReAct 文本模式）
// 依赖上方 import llm.js 先行执行 dotenv.config()，故此处读 env 安全
const GLOBAL_FUNCTION_CALLING = process.env.ENABLE_FUNCTION_CALLING === 'true';

class Agent {
  /**
   * @param {object} options
   * @param {object} options.toolRegistry  ToolRegistry 实例（可空：纯文本 Agent 无需工具）
   * @param {object} [options.memoryManager] MemoryManager 实例（可选）
   * @param {number} [options.maxSteps=8]   最大循环步数，防止无限循环
   * @param {string} [options.name]        Agent 名称（用于日志）
   * @param {boolean} [options.useFunctionCalling] 工具调用模式开关：
   *   true=原生 Function Calling（tools schema 传 API，LLM 返回 tool_calls）
   *   false/undefined=ReAct 文本模式（LLM 输出 Thought/Action 文本，代码解析调用）
   *   未显式传参时取全局环境变量 ENABLE_FUNCTION_CALLING；无工具注册中心时强制关闭
   */
  constructor({ toolRegistry = null, memoryManager = null, maxSteps = 8, name = 'Agent', useFunctionCalling } = {}) {
    this.toolRegistry = toolRegistry;
    this.memoryManager = memoryManager;
    this.maxSteps = maxSteps;
    this.name = name;
    this.llm = llmClient;          // 共享单例客户端
    this.model = DEFAULT_MODEL;
    // ?? 保证显式传 false 可覆盖全局 true；!! 把 null 归一为 false
    this.useFunctionCalling = !!(useFunctionCalling ?? GLOBAL_FUNCTION_CALLING) && !!toolRegistry;
  }

  /**
   * 调用 LLM：Agent 层入口，复用 llm.js 的 chatCompletion 屏蔽 SDK 细节
   * 此处负责：提取 message + 预留日志/重试/超时/降级扩展点
   * @param {Array} messages
   * @param {Array} [tools]      Function Calling 工具 schema
   * @param {object} [options]   额外参数，如 stream
   * @returns {Promise<object>}  OpenAI message 对象
   */
  async _sendMessages(messages, tools, options = {}) {
    // this.model 作为 Agent 层覆盖项；...options 在其后展开，调用方仍可进一步覆盖
    // 流式策略：跟随全局 ENABLE_STREAM 开关。流式开启时 LLM 原文在生成中实时输出，
    // 各范式须跳过对内容本身的 console.log 以保证"内容只打印一次"（见各 agent 的 DEFAULT_STREAM 分支）
    const completion = await chatCompletion(messages, tools, { model: this.model, ...options });
    return completion.choices[0].message;
  }

  /**
   * 处理一次 LLM 返回的 tool_calls：执行所有工具并把结果以 role:'tool' 回传
   * 调用方负责把返回的 toolMessages push 到 messages 后再发起下一轮 LLM 调用
   * @param {Array} toolCalls  LLM message.tool_calls
   * @returns {Promise<Array<{role:'tool',tool_call_id:string,content:string}>>}
   */
  async _handleToolCalls(toolCalls = []) {
    if (!this.toolRegistry) {
      // 没有工具注册中心时，给每个 tool_call 回个错误，避免破坏对话协议
      return toolCalls.map((tc) => ({
        role: 'tool',
        tool_call_id: tc.id,
        content: '错误：当前 Agent 未启用工具',
      }));
    }
    const toolMessages = [];
    for (const tc of toolCalls) {
      const toolName = tc.function.name;
      // LLM 返回的 arguments 是 JSON 字符串；解析失败也走兜底，避免残留 tool_calls 无结果导致 API 400
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        console.error(`⚠️ 工具 '${toolName}' 参数不是合法JSON: ${tc.function.arguments}`);
      }
      const result = await this.toolRegistry.execute_tool(toolName, args);
      console.log(`  🔧 [Tool] ${toolName}(${JSON.stringify(args)}) → ${String(result).slice(0, 120)}`);
      toolMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
    return toolMessages;
  }

  /**
   * 子类必须实现 run(question) 返回最终答案字符串
   * @param {string} question
   */
  async run(/* question */) {
    throw new Error('子类必须实现 run(question)');
  }
}

export default Agent;
