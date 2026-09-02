/**
 * ReAct Agent 实现
 * Thought → Action → Observation 循环
 *
 * 双模式（由 .env 的 ENABLE_FUNCTION_CALLING 或构造参数 useFunctionCalling 控制）：
 * - 默认 ReAct 文本模式：不传 tools 参数给 LLM（避免双重触发导致行为分裂），
 *   LLM 用文本输出 Thought/Action，由代码解析 tool_input；Finish[...] 表示最终答案
 * - Function Calling 模式：tools schema 传给 API，LLM 返回 tool_calls，
 *   由基类 _handleToolCalls 统一执行并以 role:'tool' 回传
 *
 * 共同容错：LLM 直接输出纯文本答案（无 Action / 无 tool_calls）也接受
 */
import Agent from '../core/agent.js';
import { DEFAULT_STREAM } from '../core/llm.js';

const REACT_PROMPT_TEMPLATE = `请注意，你是一个有能力调用外部工具的智能助手。

可用工具如下（含每个工具的参数 schema）:
{tools}

**重要规则**：
1. 任何数学计算（无论难易）都必须调用 calculator 工具获取准确结果，禁止自行心算。
2. 调用工具时，tool_input **必须是符合该工具参数 schema 的 JSON 对象字符串**（键名与 schema 的 properties 一致，必填键不能缺），例如：
   - calculator[{"expr":"(15+28)*3/2"}]
   - memory[{"action":"add","content":"用户叫张三","type":"semantic","importance":0.8}]
   - todo[{"action":"add","title":"明天开会"}]
   禁止输出 memory[add] 或 add(content=...) 之类的非 JSON 格式。
3. 拿到工具返回的 Observation 后，如还需调用其他工具，继续按 Thought/Action 格式输出；如已收集到足够信息能直接回答用户，直接输出最终答案文本（无需 Action: 前缀，无需 Finish[...] 包装）。
4. 当任务含纯文本生成子任务（如写诗、写文案）且无对应工具时，可直接输出该文本作为最终答案。

请严格按照以下格式进行回应（每次只输出一个 Action）:

Thought: 你的思考过程，用于分析问题、拆解任务和规划下一步行动。
Action: 你决定采取的行动，必须是以下格式之一:
- 「{{tool_name}}[{JSON对象}]」:调用一个可用工具，JSON 键名严格对照工具的参数 schema。
- 「Finish[最终答案]」:当你认为已经获得最终答案时。
- 当你收集到足够的信息，能够回答用户的最终问题时，你必须在Action:字段后使用 Finish[最终答案] 来输出最终答案。

现在，请开始解决以下问题:
Question: {question}
History: {history}
`;

class ReActAgent extends Agent {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'ReActAgent' });
    // 单次运行内的历史轨迹（Thought/Action/Observation 字符串列表）
    this.history = [];
  }

  /**
   * 把 LLM 输出的 toolInput 字符串转成工具期望的 args 对象
   * 兼容两种格式：
   *   1) JSON: calculator[{"expr":"3*7+12"}]  → 直接 JSON.parse
   *   2) 裸文本: calculator[3*7+12]            → 按 schema 第一个 required 字段包装
   */
  _parseToolInput(toolName, toolInput) {
    try {
      return JSON.parse(toolInput);
    } catch {
      const tool = this.toolRegistry?._tools?.[toolName];
      const firstRequired = tool?.parameters?.required?.[0];
      return firstRequired ? { [firstRequired]: toolInput } : { input: toolInput };
    }
  }

  // 解析 LLM 输出，提取 Thought 和 Action
  _parseOutput(text) {
    // Thought: 匹配到 Action: 或文本末尾（s flag 跨行）
    const thoughtMatch = text.match(/Thought:\s*(.*?)(?=\nAction:|$)/s);
    const actionMatch = text.match(/Action:\s*(.*?)$/s);
    return {
      thought: thoughtMatch ? thoughtMatch[1].trim() : null,
      action: actionMatch ? actionMatch[1].trim() : null,
    };
  }

  // 解析 Action 字符串：toolName[toolInput] 或 Finish[最终答案]
  _parseAction(actionText) {
    const match = actionText.match(/^(\w+)\[(.*)\]/s);
    if (match) return { toolName: match[1], toolInput: match[2] };
    return { toolName: null, toolInput: null };
  }

  async run(question) {
    // 按 useFunctionCalling 开关分流：原生 Function Calling / ReAct 文本解析
    if (this.useFunctionCalling) {
      return await this._runWithFunctionCalling(question);
    }
    return await this._runWithTextParsing(question);
  }

  /**
   * Function Calling 模式：tools schema 传给 API，LLM 返回 tool_calls 由基类统一执行
   * 每轮把 assistant(tool_calls) + tool 结果按协议顺序追加进 messages，直到 LLM 不再调工具
   */
  async _runWithFunctionCalling(question) {
    const tools = this.toolRegistry.get_tools_schemas();
    const messages = [
      {
        role: 'user',
        content: `你是一个有能力调用外部工具的智能助手。请完成以下任务：
- 任何数学计算必须调用 calculator 工具，禁止心算。
- 需要外部信息（天气/网页/记忆/待办/笔记）时调用对应工具。
- 收集到足够信息后，直接输出面向用户的最终答案，不要再调用工具。

Question: ${question}`,
      },
    ];
    let currentStep = 0;
    while (currentStep < this.maxSteps) {
      currentStep++;
      console.log(`--- [${this.name}] 第 ${currentStep} 步（Function Calling 模式） ---`);
      const message = await this._sendMessages(messages, tools);
      // 无 tool_calls：LLM 已给出最终答案
      if (!message.tool_calls?.length) {
        const finalAnswer = (message.content || '').trim();
        // 流式模式下 content 已实时输出，跳过重复打印
        if (!DEFAULT_STREAM) console.log(`🎉 最终答案: ${finalAnswer}`);
        return finalAnswer;
      }
      // 有 tool_calls：按 OpenAI 协议先追加 assistant 消息，再执行工具回传 tool 结果
      messages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.tool_calls,
      });
      const toolMessages = await this._handleToolCalls(message.tool_calls);
      messages.push(...toolMessages);
    }
    throw new Error(`[${this.name}] 已达最大步骤数 ${this.maxSteps}，流程终止。`);
  }

  /**
   * ReAct 文本模式（默认）：LLM 输出 Thought/Action 文本，代码解析 toolName[toolInput] 调工具
   */
  async _runWithTextParsing(question) {
    // 每次运行重置历史
    this.history = [];
    let currentStep = 0;
    while (currentStep < this.maxSteps) {
      currentStep++;
      console.log(`--- [${this.name}] 第 ${currentStep} 步 ---`);
      // 1. 格式化提示词
      const toolsDesc = this.toolRegistry
        ? this.toolRegistry.get_tools_description()
        : '暂无可用工具';
      const prompt = REACT_PROMPT_TEMPLATE
        .replace('{tools}', toolsDesc)
        .replace('{question}', question)
        .replace('{history}', this.history.join('\n'));
      // 2. 调 LLM 思考（纯 ReAct，不传 tools 参数）
      const message = await this._sendMessages([{ role: 'user', content: prompt }]);
      const content = message.content;
      if (!content) throw new Error('LLM 未能返回有效响应');
      // 3. 解析输出
      // 流式模式下 LLM 原文（Thought/Action/答案）已在生成中实时输出，
      // 跳过对内容本身的 console.log，仅保留 Observation/警告等代码侧结构化日志
      const streamed = DEFAULT_STREAM;
      const { thought, action } = this._parseOutput(content);
      if (thought) {
        if (!streamed) console.log(`Thought: ${thought}`);
        this.history.push(`Thought: ${thought}`);
      }
      if (!action) {
        // 容错：LLM 直接输出最终答案但未带 Action 前缀
        if (!streamed) console.log(`🎉 最终答案（LLM 直接输出）: ${content}`);
        return content;
      }
      // 4. 执行 Action
      if (action.startsWith('Finish')) {
        const finishMatch = action.match(/Finish\[(.*)\]/s);
        const finalAnswer = finishMatch ? finishMatch[1] : action;
        // 流式模式下 Finish[...] 原文已实时输出，跳过重复打印
        if (!streamed) console.log(`🎉 最终答案: ${finalAnswer}`);
        return finalAnswer;
      }
      const { toolName, toolInput } = this._parseAction(action);
      if (!toolName || toolInput === null) {
        console.log(`⚠️ 无效 Action 格式，跳过: ${action}`);
        continue;
      }
      if (!streamed) console.log(`Action: ${toolName}[${toolInput}]`);
      const args = this._parseToolInput(toolName, toolInput);
      // 调用真实工具
      const observation = this.toolRegistry
        ? await this.toolRegistry.execute_tool(toolName, args)
        : '错误：未启用工具';
      console.log(`Observation: ${observation}`);
      // 5. 记入历史
      this.history.push(`Action: ${action}`);
      this.history.push(`Observation: ${observation}`);
    }
    throw new Error(`[${this.name}] 已达最大步骤数 ${this.maxSteps}，流程终止。`);
  }
}

export default ReActAgent;
