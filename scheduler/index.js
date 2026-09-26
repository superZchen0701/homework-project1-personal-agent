/**
 * Agent 调度中心
 * 1. 调用 LLM 判断用户问题复杂度（complex / simple）
 * 2. 复杂问题走"三范式混合"：
 *    - PlanAndSolve 做骨架：规划全局步骤
 *    - 每步用 ReAct 执行：动态调工具完成当前子任务
 *    - 关键节点用 Reflection 把关：对产出做反思+优化
 * 3. 简单问题直接走 ReAct 循环即可
 */
import ReActAgent from '../agents/react_agent.js';
import PlanAndSolveAgent from '../agents/plan_and_solve_agent.js';
import ReflectionAgent from '../agents/reflection_agent.js';
import { chatCompletion, DEFAULT_STREAM } from '../core/llm.js';

// 复杂度判断提示词：让 LLM 输出 complex / simple 之一
const CLASSIFY_PROMPT = `你是一个任务复杂度分类器。判断用户问题属于"复杂"还是"简单"。

复杂问题的特征（满足任一即可）：
- 需要多步骤规划（如：先查询A，再结合B，最后生成C）
- 需要跨多个工具协作（如：查询天气+计算+生成文案）
- 包含"先...再...然后..."等多阶段流程
- 需要分析与综合判断

简单问题的特征：
- 单一明确任务（如：算个表达式、查一个城市天气、记一条待办）
- 不需要多阶段流程
- 直接调用一个工具或直接回答即可

仅输出一行：complex 或 simple，不要附加任何说明。

用户问题: {question}
`;

class AgentScheduler {
  /**
   * @param {object} options
   * @param {object} options.toolRegistry       ToolRegistry 实例
   * @param {object} [options.memoryManager]    MemoryManager 实例
   * @param {number|object} [options.maxSteps]  各 Agent 的最大步数
   *   - 数字：三个 Agent 共用该值
   *   - 对象：{ react=6, planAndSolve=6, reflection=3 } 分别配置
   * @param {boolean} [options.verbose=true]    是否打印调度过程日志
   */
  constructor({ toolRegistry, memoryManager = null, maxSteps, verbose = true } = {}) {
    this.toolRegistry = toolRegistry;
    this.memoryManager = memoryManager;
    this.verbose = verbose;

    // 规范化 maxSteps：数字形式 → 三个 Agent 共用；对象形式 → 各自取值，缺省走默认
    const DEFAULTS = { react: 6, planAndSolve: 6, reflection: 3 };
    const steps = typeof maxSteps === 'number'
      ? { ...DEFAULTS, react: maxSteps, planAndSolve: maxSteps, reflection: maxSteps }
      : { ...DEFAULTS, ...(maxSteps || {}) };
    this.maxSteps = steps;

    // 复用三大范式 Agent 实例（各自独立配置 maxSteps）
    this.reactAgent = new ReActAgent({
      toolRegistry,
      memoryManager,
      maxSteps: steps.react,
      name: 'ReAct',
    });
    this.planAndSolveAgent = new PlanAndSolveAgent({
      toolRegistry,
      memoryManager,
      maxSteps: steps.planAndSolve,
      name: 'PlanAndSolve',
    });
    this.reflectionAgent = new ReflectionAgent({
      toolRegistry,
      memoryManager,
      maxSteps: steps.reflection,
      name: 'Reflection',
    });
  }

  _log(...args) {
    if (this.verbose) console.log(...args);
  }

  /**
   * 调用 LLM 判断问题复杂度
   * @param {string} question
   * @returns {Promise<'complex'|'simple'>}
   */
  async _classifyComplexity(question) {
    const prompt = CLASSIFY_PROMPT.replace('{question}', question);
    try {
      // 分类器无需流式打印（避免污染调度日志），显式 stream:false 覆盖全局开关
      const completion = await chatCompletion(
        [{ role: 'user', content: prompt }],
        null,
        { stream: false, traceLabel: 'scheduler._classifyComplexity' }
      );
      const answer = (completion.choices[0].message.content || '').trim().toLowerCase();
      // 兼容 LLM 偶发输出变体
      if (/complex|复杂/.test(answer)) return 'complex';
      if (/simple|简单/.test(answer)) return 'simple';
      // 未识别，按简单处理（避免无谓的资源消耗）
      this._log(`⚠️ 复杂度判断未识别: '${answer}'，默认按 simple 处理`);
      return 'simple';
    } catch (err) {
      // 失败兜底：按简单处理
      this._log(`⚠️ 复杂度判断异常: ${err.message}，默认按 simple 处理`);
      return 'simple';
    }
  }

  /**
   * 入口：根据问题复杂度选择路径
   * @param {string} question
   * @returns {Promise<{answer: string, streamed: boolean}>}
   *   answer      最终答案文本
   *   streamed    答案是否已在生成时流式实时输出（true 时调用方不应再重复打印 answer）
   */
  async run(question) {
    this._log(`\n========== [Scheduler] 收到问题 ==========`);
    this._log(`👤 用户: ${question}`);

    // 1. 复杂度判断
    const complexity = await this._classifyComplexity(question);
    this._log(`🧭 [Scheduler] 复杂度判定: ${complexity}`);

    if (complexity === 'simple') {
      // 2. 简单问题：直接走 ReAct
      // 流式开启时 ReAct 内的最终答案已实时输出（streamed: true），关闭时交调用方打印
      this._log(`\n🚀 [Scheduler] 简单问题 → 直接走 ReAct 循环`);
      const answer = await this.reactAgent.run(question);
      return { answer, streamed: DEFAULT_STREAM };
    }

    // 3. 复杂问题：三范式混合
    this._log(`\n🎯 [Scheduler] 复杂问题 → 走三范式混合（Plan→ReAct→Reflection）`);
    return await this._runHybrid(question);
  }

  /**
   * 三范式混合执行
   * 流程：
   *   1. PlanAndSolve 拿到全局步骤计划
   *   2. 每个步骤用 ReAct 执行（带工具）
   *   3. 每步产出交给 Reflection 把关（如需优化则优化）
   *   4. 汇总最终答案
   */
  async _runHybrid(question) {
    // 1. 规划阶段（复用 PlanAndSolveAgent 的 _plan 方法，仅取计划不执行）
    this._log(`\n========== [Scheduler] 阶段 1: PlanAndSolve 生成全局计划 ==========`);
    const plan = await this.planAndSolveAgent._plan(question);
    if (!plan.length) {
      // 规划失败兜底：直接走 ReAct（流式标记同简单问题路径）
      this._log(`⚠️ 规划失败，降级走 ReAct`);
      const answer = await this.reactAgent.run(question);
      return { answer, streamed: DEFAULT_STREAM };
    }

    // 逐步执行 + 反思把关
    const stepResults = [];
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      this._log(`\n========== [Scheduler] 阶段 2.${i + 1}: ReAct 执行步骤 ==========`);
      this._log(`📋 步骤: ${step}`);
      // 构造子问题：把原始问题 + 上下文 + 当前步骤一起给 ReAct
      const context = stepResults.length
        ? `已完成步骤与结果：\n${stepResults
            .map((r, idx) => `${idx + 1}. ${plan[idx]}\n   结果: ${r}`)
            .join('\n')}\n`
        : '无';
      const subQuestion = `原始任务: ${question}\n\n历史上下文:\n${context}\n\n当前步骤: ${step}\n\n请完成当前步骤。`;

      // 2. ReAct 执行当前步骤
      const stepResult = await this.reactAgent.run(subQuestion);
      stepResults.push(stepResult);
    }

    // 3. 关键节点 Reflection 把关（仅最后一步）
    // 中间步骤多为工具调用的事实性产出，反思只会引入噪音（实测曾把正确的工具结果"优化"成"无法获取数据"）；
    // 最后一步是综合产出，把关价值最大。上下文带全部步骤结果，避免 Reflection 与工具事实脱节。
    this._log(`\n========== [Scheduler] 阶段 3: Reflection 把关 ==========`);
    const fullContext = plan
      .map((s, idx) => `步骤 ${idx + 1}: ${s}\n产出: ${stepResults[idx] || '（无）'}`)
      .join('\n\n');
    const lastStep = plan[plan.length - 1];
    const reflectionTask = `原始任务: ${question}\n\n全部已完成步骤与结果（数据来自真实工具调用）:\n${fullContext}\n\n当前步骤: ${lastStep}\n\n待审查的产出:\n${stepResults[stepResults.length - 1]}\n\n请审查并按需优化该步骤产出。若已最优，直接输出原产出。`;
    const refined = await this.reflectionAgent.run(reflectionTask);
    stepResults[stepResults.length - 1] = refined;

    // 4. 最终汇总：把所有步骤结果交给 LLM 综合成最终答案
    this._log(`\n========== [Scheduler] 阶段 4: 汇总最终答案 ==========`);
    const summaryPrompt = `你是一个任务汇总专家。用户提出了一个复杂任务，已被拆解为多个步骤执行。
请根据各步骤的产出，综合输出对原始任务的最终回答（自然语言，可直接给用户）。

# 原始任务
${question}

# 各步骤计划与产出
${plan
  .map((s, idx) => `步骤 ${idx + 1}: ${s}\n产出: ${stepResults[idx] || '（无）'}`)
  .join('\n\n')}

请直接输出最终回答:`;

    try {
      // 最终汇总：该调用产出即面向用户的最终答案，跟随全局流式开关
      // 流式开启时：先打 🤖 > 前缀，答案在生成中实时输出（全流程唯一一次打印）
      // 流式关闭时：答案随返回值交调用方（CLI）打印
      const streamed = DEFAULT_STREAM;
      if (streamed) process.stdout.write('\n🤖 > ');
      const completion = await chatCompletion(
        [{ role: 'user', content: summaryPrompt }],
        null,
        {
          ...(streamed ? {} : { stream: false }),
          traceLabel: 'scheduler.summarize',
        }
      );
      const answer = completion.choices[0].message.content || stepResults.join('\n\n');
      return { answer, streamed };
    } catch (err) {
      // 汇总失败兜底：直接拼接各步骤产出（非流式，交调用方打印）
      this._log(`⚠️ 汇总失败: ${err.message}，降级为步骤产出拼接`);
      return { answer: stepResults.join('\n\n'), streamed: false };
    }
  }
}

export { AgentScheduler };
export default AgentScheduler;
