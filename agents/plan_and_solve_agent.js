/**
 * PlanAndSolve Agent 实现
 * 先让 LLM 输出步骤计划，再逐步执行
 *
 * 设计要点：
 * - Planner：把问题拆成 JavaScript 字符串数组（可解析）
 * - Executor：按计划逐步执行，维护历史结果
 * - 工具支持：在每个执行步骤中，若 LLM 选择调用工具，走 ReAct 单步循环
 */
import Agent from '../core/agent.js';
import { DEFAULT_STREAM } from '../core/llm.js';

const PLANNER_PROMPT = `你是一个顶级的AI规划专家。你的任务是将用户提出的复杂问题分解成一个由多个简单步骤组成的行动计划。
请确保计划中的每个步骤都是一个独立的、可执行的子任务，并且严格按照逻辑顺序排列。
你的输出必须是一个JavaScript字符串数组（标准 JSON 可解析的字符串数组），其中每个元素都是一个描述子任务的字符串。

问题: {question}

请严格按照以下格式输出你的计划，\`\`\`javascript 与 \`\`\` 作为前后缀是必要的：
\`\`\`javascript
["步骤1", "步骤2", "步骤3", ...]
\`\`\`
`;

const EXECUTOR_PROMPT = `你是一位顶级的AI执行专家。你的任务是严格按照给定的计划，一步步地解决问题。
你将收到原始问题、完整的计划、以及到目前为止已经完成的步骤和结果。
请你专注于解决"当前步骤"，并仅输出该步骤的最终答案，不要输出任何额外的解释或对话。

# 原始问题:
{question}

# 完整计划:
{plan}

# 历史步骤与结果:
{history}

# 当前步骤:
{current_step}

请仅输出针对"当前步骤"的回答:
`;

class PlanAndSolveAgent extends Agent {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'PlanAndSolveAgent' });
  }

  // 规划阶段：解析 LLM 输出的字符串数组
  async _plan(question) {
    const prompt = PLANNER_PROMPT.replace('{question}', question);
    console.log(`--- [${this.name}] 正在生成计划 ---`);
    const message = await this._sendMessages([{ role: 'user', content: prompt }]);
    const content = (message.content || '').trim();
    // 流式模式下计划内容已实时输出，仅打摘要避免重复
    if (DEFAULT_STREAM) {
      console.log('✅ 计划已生成（内容已实时输出）');
    } else {
      console.log(`✅ 计划已生成：\n${content}`);
    }
    try {
      // 优先匹配 ```javascript 代码块
      const blockMatch = content.match(/```(?:javascript|json)?\s*([\s\S]*?)```/);
      const planContent = blockMatch ? blockMatch[1].trim() : content;
      const plan = JSON.parse(planContent).map((item) => item.toString());
      if (!Array.isArray(plan) || plan.length === 0) throw new Error('计划为空或非数组');
      return plan;
    } catch (err) {
      console.error('计划格式错误:', err.message);
      return [];
    }
  }

  // 执行阶段：按计划逐步执行
  async _execute(question, plan) {
    let history = '';
    let content = '';
    console.log(`--- [${this.name}] 正在执行计划 ---`);
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      console.log(`\n-> [${this.name}] 步骤 ${i + 1}/${plan.length}：${step}`);
      const prompt = EXECUTOR_PROMPT
        .replace('{question}', question)
        .replace('{plan}', plan.map((s, idx) => `${idx + 1}. ${s}`).join('\n'))
        .replace('{history}', history || '无')
        .replace('{current_step}', step);
      const message = await this._sendMessages([{ role: 'user', content: prompt }]);
      content = message.content || '';
      history += `步骤 ${i + 1}: ${step}\n结果: ${content}\n\n`;
      // 流式模式下步骤结果已实时输出，仅打进度避免重复
      if (DEFAULT_STREAM) {
        console.log(`✅ 步骤 ${i + 1} 已完成（结果已实时输出）`);
      } else {
        console.log(`✅ 步骤 ${i + 1} 已完成，结果: ${content}`);
      }
    }
    return content;
  }

  async run(question) {
    console.log(`\n--- [${this.name}] 开始处理问题 ---\n问题: ${question}`);
    const plan = await this._plan(question);
    if (plan.length === 0) {
      throw new Error('规划器生成的计划为空，无法解决问题。');
    }
    const result = await this._execute(question, plan);
    return result;
  }
}

export default PlanAndSolveAgent;
