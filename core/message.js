/**
 * 消息系统
 * 统一封装 OpenAI 兼容的消息结构 + 粗略 Token 估算
 * 全项目所有 Agent / Scheduler 共用，避免到处手动拼 {role,content}
 */

/**
 * 构造 user 消息
 * @param {string} content
 */
export const userMessage = (content) => ({ role: 'user', content });

/**
 * 构造 system 消息
 * @param {string} content
 */
export const systemMessage = (content) => ({ role: 'system', content });

/**
 * 构造 assistant 消息（纯文本）
 * @param {string} content
 */
export const assistantMessage = (content) => ({ role: 'assistant', content });

/**
 * 构造 tool 消息（Function Calling 工具返回结果）
 * OpenAI 协议要求：role 必须为 'tool'，且带 tool_call_id 关联上一步 tool_calls 中的某项
 * content 必须为字符串（数字/对象需先序列化）
 * @param {string} toolCallId  上一步 LLM 返回的 tool_call.id
 * @param {string} content    工具执行结果字符串
 */
export const toolMessage = (toolCallId, content) => ({
  role: 'tool',
  tool_call_id: toolCallId,
  content: typeof content === 'string' ? content : JSON.stringify(content),
});

/**
 * 粗略 Token 估算（4 字符 ≈ 1 token，中英混合近似）
 * 生产环境如需精确，可替换为 tiktoken。
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text = '') {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/**
 * 估算一个 messages 数组的总 token 数（仅 content 字段）
 * @param {Array<{content?:string}>} messages
 * @returns {number}
 */
export function countMessagesTokens(messages = []) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0);
}

/**
 * 把消息数组渲染为可读的调试字符串（如打印历史时使用）
 * @param {Array<{role:string,content?:string,tool_calls?:any}>} messages
 */
export function stringifyMessages(messages = []) {
  return messages
    .map((m) => {
      const tail = m.tool_calls
        ? ` tool_calls=${JSON.stringify(m.tool_calls.map(t => t.function.name))}`
        : '';
      return `[${m.role}] ${m.content ?? ''}${tail}`;
    })
    .join('\n');
}
