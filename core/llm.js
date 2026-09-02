/**
 * LLM 统一接口
 * 封装 DeepSeek/OpenAI 兼容客户端，全项目共用一个实例
 * 配置从根目录 .env 读取：
 *   DEEPSEEK_API_KEY  DeepSeek API Key（必填）
 *   DEEPSEEK_BASE_URL 可选，默认 https://api.deepseek.com
 *   DEEPSEEK_MODEL    可选，默认 deepseek-v4-flash
 */
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// 加载根目录 .env（本文件位于 core/，故上一级即项目根）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// 必填校验：缺 key 直接抛错，避免后续 API 调用才报错
const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  throw new Error('未设置环境变量 DEEPSEEK_API_KEY，请在项目根目录 .env 中配置后重试');
}

// 单例客户端：全项目共享，便于统一限流/重试
export const llmClient = new OpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  apiKey: API_KEY,
});

// 默认模型名，集中管理便于切换
export const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

// 全局流式开关：从环境变量读取，调用方可通过 options.stream 单次覆盖
// 启用后 chatCompletion 会实时把 delta 打印到 stdout
export const DEFAULT_STREAM = process.env.ENABLE_STREAM === 'true';

/**
 * 统一调用入口：屏蔽 OpenAI SDK 细节，下游只需关心 messages + 可选 tools
 *
 * 流式行为：
 *   - 全局开关 DEFAULT_STREAM 控制是否启用流式
 *   - options.stream 可单次覆盖（true 强制开 / false 强制关）
 *   - 流式时实时 process.stdout.write(delta)，并累积成完整 message 返回
 *   - 返回值结构与非流式一致：{ choices: [{ message }] }，调用方无需感知差异
 *
 * @param {Array<{role:string,content:string}>} messages
 * @param {Array} [tools]      Function Calling 工具 schema，不传则不启用
 * @param {object} [options]   额外参数，如 { stream:true }
 * @returns {Promise<object>}  与 SDK 非流式 completion 结构兼容的对象
 */
export async function chatCompletion(messages, tools, options = {}) {
  const useStream = options.stream ?? DEFAULT_STREAM;
  if (useStream) {
    return await _streamCompletion(messages, tools, options);
  }
  const completion = await llmClient.chat.completions.create({
    model: DEFAULT_MODEL,
    messages,
    ...(tools && tools.length ? { tools } : {}),
    ...options,
  });
  return completion;
}

/**
 * 流式调用：迭代 chunks，实时打印 delta，累积成完整 message
 * 兼容 Function Calling：tool_calls 在流式中分多 chunk 到达，按 index 累积拼接
 */
async function _streamCompletion(messages, tools, options = {}) {
  const stream = await llmClient.chat.completions.create({
    model: DEFAULT_MODEL,
    messages,
    ...(tools && tools.length ? { tools } : {}),
    ...options,
    stream: true,
  });

  let content = '';
  let role = 'assistant';
  // tool_calls 按 index 累积：流式时每个 tool_call 的 id/name/arguments 可能分多 chunk 到达
  const toolCallsAcc = [];

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.role) role = delta.role;
    // 文本 delta：实时打印 + 累积
    if (delta.content) {
      process.stdout.write(delta.content);
      content += delta.content;
    }
    // 工具调用 delta：按 index 累积
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsAcc[idx]) {
          toolCallsAcc[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        }
        if (tc.id) toolCallsAcc[idx].id = tc.id;
        if (tc.type) toolCallsAcc[idx].type = tc.type;
        if (tc.function?.name) toolCallsAcc[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCallsAcc[idx].function.arguments += tc.function.arguments;
      }
    }
  }
  // 流结束补一个换行，避免后续日志贴边
  process.stdout.write('\n');

  // 构造与非流式一致的返回结构
  const message = { role, content };
  const validToolCalls = toolCallsAcc.filter(Boolean);
  if (validToolCalls.length) message.tool_calls = validToolCalls;
  return { choices: [{ message }] };
}
