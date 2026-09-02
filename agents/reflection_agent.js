/**
 * Reflection Agent 实现
 * 执行 → 反思 → 优化 迭代循环
 *
 * 设计要点：
 * - 引入短期记忆：存储每轮 execution/reflection 记录，为下一轮反思提供完整上下文
 * - 通用化：通过 task 描述指定任意领域，与具体业务解耦
 * - 收敛检测：LLM 输出 "无需改进" 等变体即提前结束
 */
import Agent from '../core/agent.js';
import { DEFAULT_STREAM } from '../core/llm.js';

// 初始执行提示词（通用化，由 task 描述具体领域与产出格式）
const INITIAL_PROMPT = `你是一位资深任务执行专家。请根据以下要求完成任务。
你的产出必须严格符合 task 描述的领域规范与输出格式要求。

要求: {task}

请直接输出结果，不要包含任何额外的解释。
`;

// 反思提示词（聚焦产出质量与方案优劣，与具体领域无关）
// 含"事实纪律"：产出中的工具返回数据是当前环境最权威的事实，禁止伪改进
const REFLECT_PROMPT = `你是一位极其严格的质量评审专家，对产出的质量有极致的要求。
你的任务是审查以下产出，并专注于找出其在方案优劣与执行质量上的主要瓶颈。

# 原始任务:
{task}

# 待审查的产出:
\`\`\`
{output}
\`\`\`

**审查纪律（必须遵守）**：
1. 产出中的事实性数据（天气、计算结果、工具返回的任何信息）来自已执行工具的真实返回，是当前环境下能获得的最权威数据。除非原始任务明确要求，禁止提出以下"伪改进"：
   - 要求标注数据来源、时间戳、API 名称
   - 以"无法获取实时数据"为由否定已有的工具返回结果，或建议用户自行查询
   - 建议接入外部系统、联网能力等当前环境不具备的东西
2. 仅当产出存在以下**真实问题**时才提出改进：答非所问、遗漏任务明确要求的内容、表述与工具结果矛盾、格式混乱影响理解。
3. 若产出正确反映了工具结果并完成原始任务，必须回答"无需改进"。

请直接输出你的反馈，不要包含任何额外的解释。
`;

// 优化提示词（根据反馈迭代优化产出）
const REFINE_PROMPT = `你是一位资深任务执行专家。你正在根据一位质量评审专家的反馈来优化你的产出。

# 原始任务:
{task}

# 你上一轮尝试的产出:
{last_output_attempt}
评审员的反馈：
{feedback}

**优化纪律**：
- 只针对评审员指出的真实问题进行修改
- 产出中来自工具返回的事实性数据（天气、计算结果等）必须原样保留，不得删除、替换或降级为"无法获取"
- 优化只允许：补全任务遗漏的要求、修正与工具结果矛盾的表述、改善格式可读性

请根据评审员的反馈，生成一个优化后的新版本产出。
你的产出必须严格符合 task 描述的领域规范与输出格式要求。
请直接输出优化后的结果，不要包含任何额外的解释。
`;

class ReflectionAgent extends Agent {
  constructor(options = {}) {
    super({
      ...options,
      // 反思一般 3 轮收敛
      maxSteps: options.maxSteps || 3,
      name: options.name || 'ReflectionAgent',
    });
    // 简易短期记忆：records = [{ type, content }]
    this.records = [];
  }

  // 向短期记忆追加一条记录
  _addRecord(type, content) {
    this.records.push({ type, content });
  }

  // 获取最近一次 execution 产出
  _getLastExecution() {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].type === 'execution') return this.records[i].content;
    }
    return '';
  }

  // 把记忆轨迹序列化为文本，供反思/优化提示词使用
  _getTrajectory() {
    return this.records
      .map((r) =>
        r.type === 'execution'
          ? `--- 上一轮尝试 (产出) ---\n${r.content}`
          : `--- 评审员反馈 ---\n${r.content}`
      )
      .join('\n\n');
  }

  async run(task) {
    console.log(`\n--- [${this.name}] 开始处理任务 ---\n任务: ${task}`);
    // 1. 初始执行
    console.log(`\n--- [${this.name}] 正在进行初始尝试 ---`);
    const initialPrompt = INITIAL_PROMPT.replace('{task}', task);
    let lastOutput = await this._sendMessages([{ role: 'user', content: initialPrompt }])
      .then((m) => m.content || '');
    this._addRecord('execution', lastOutput);

    // 2. 迭代循环：反思 → 优化
    for (let i = 0; i < this.maxSteps; i++) {
      console.log(`\n--- [${this.name}] 第 ${i + 1}/${this.maxSteps} 轮迭代 ---`);
      // 2.1 反思
      console.log('\n-> 正在进行反思...');
      const reflectPrompt = REFLECT_PROMPT
        .replace('{task}', task)
        .replace('{output}', lastOutput);
      const feedback = await this._sendMessages([{ role: 'user', content: reflectPrompt }])
        .then((m) => m.content || '');
      this._addRecord('reflection', feedback);

      // 2.2 收敛检测：LLM 输出 "无需改进" 等变体即结束
      if (/无[需须]改进|不需[要]?改进|已(达到)?最优|已足够好/.test(feedback)) {
        console.log('\n✅ 反思认为产出已无需改进，任务完成。');
        break;
      }

      // 2.3 优化
      console.log('\n-> 正在进行优化...');
      const refinePrompt = REFINE_PROMPT
        .replace('{task}', task)
        .replace('{last_output_attempt}', lastOutput)
        .replace('{feedback}', feedback);
      lastOutput = await this._sendMessages([{ role: 'user', content: refinePrompt }])
        .then((m) => m.content || '');
      this._addRecord('execution', lastOutput);
    }

    // 流式模式下最终产出已在生成中实时输出，跳过重复打印
    console.log(`\n--- [${this.name}] 任务完成 ---`);
    if (!DEFAULT_STREAM) console.log(`最终产出:\n${lastOutput}`);
    return lastOutput;
  }
}

export default ReflectionAgent;
