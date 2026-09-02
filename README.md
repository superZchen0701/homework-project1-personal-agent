# homework-project1-personal-agent

AI Agent 开发转型30天学习计划作业项目 —— 个人助手 Agent

基于 DeepSeek（OpenAI 兼容协议）实现的个人助手 Agent，整合 **ReAct / PlanAndSolve / Reflection 三大范式** + **Function Calling** + **记忆系统** + **工具注册中心** + **调度中心**，并提供 CLI 交互界面。

## 目录结构

```bash
homework-project1-personal-agent/
├── agents/                       # 三大范式实现
│   ├── react_agent.js            # ReAct：Thought→Action→Observation 循环
│   ├── plan_and_solve_agent.js   # PlanAndSolve：先规划再执行
│   └── reflection_agent.js       # Reflection：执行-反思-优化迭代
├── core/                         # 核心基础设施
│   ├── agent.js                  # Agent 基类（统一 LLM 调用 + 工具结果回传）
│   ├── llm.js                    # LLM 统一接口（封装 DeepSeek/OpenAI SDK）
│   └── message.js                # 消息构造 + Token 估算
├── memory/                       # 记忆系统
│   ├── base.js                   # MemoryItem + BaseMemory 基类
│   ├── manager.js                # MemoryManager：编码→存储→检索→整合→遗忘
│   └── types/                    # 三种记忆类型
│       ├── working.js            # 工作记忆（短期，FIFO）
│       ├── episodic.js           # 情景记忆（长期，按时间）
│       └── semantic.js          # 语义记忆（长期，按重要性）
├── tools/                        # 工具系统
│   ├── base.js                   # Tool 基类
│   ├── registry.js              # ToolRegistry 工具注册中心
│   └── builtin/                  # 内置工具
│       ├── calculator.js         # 计算器
│       ├── get_weather.js        # 天气查询（wttr.in）
│       ├── todo.js               # 待办管理
│       ├── note.js               # 笔记管理（标签）
│       ├── web_summary.js        # 网页摘要（fetch+LLM 摘要）
│       └── memory_tool.js        # 记忆存取工具（封装 MemoryManager）
├── scheduler/
│   └── index.js                  # 调度中心：复杂度判断 + 三范式混合
├── cli.js                        # CLI 交互入口
├── reference/                    # 参考代码（Day2-Day5 学习笔记）
├── .env.example                  # 环境变量示例
├── package.json
└── README.md
```

## 核心特性

### 1. 三大 Agent 范式

| 范式 | 文件 | 核心思想 |
|---|---|---|
| **ReAct** | `agents/react_agent.js` | Thought→Action→Observation 循环；LLM 输出文本决策，代码解析工具调用 |
| **PlanAndSolve** | `agents/plan_and_solve_agent.js` | 先让 LLM 输出步骤计划，再逐步执行 |
| **Reflection** | `agents/reflection_agent.js` | 执行→反思→优化迭代，含收敛检测 |

### 2. 调度中心（`scheduler/index.js`）

调度流程：

```bash
用户问题 → LLM 复杂度判断
            ├── simple  → ReAct 单循环
            └── complex → 三范式混合
                  1) PlanAndSolve 做骨架：规划全局步骤
                  2) 每步用 ReAct 执行：动态调工具完成子任务
                  3) 关键节点用 Reflection 把关：对产出做反思+优化
                  4) 汇总生成最终答案
```

### 3. 记忆系统（`memory/`）

- **工作记忆（Working）**：会话级短期，FIFO 淘汰，默认 50 条
- **情景记忆（Episodic）**：长期，按时间序列检索，7 天未访问+低重要性遗忘
- **语义记忆（Semantic）**：长期，按重要性排序，仅清理重要性<0.1
- **5 阶段认知流程**：编码→存储→检索→整合→遗忘
- **跨类型检索**：综合排序（重要性优先，再按访问时间），含降级兜底
- **Agent 可通过 memory 工具主动存/取记忆**

### 4. 5 个内置工具

| 工具 | 功能 | 说明 |
|---|---|---|
| `calculator` | 数学计算 | 白名单防注入，仅允许数字与运算符 |
| `get_weather` | 天气查询 | 调用 [wttr.in](https://github.com/chubin/wttr.in) 免费 API，无需 key |
| `todo` | 待办管理 | 增删查改，内存存储 |
| `note` | 笔记管理 | 按标签存储与检索 |
| `web_summary` | 网页摘要 | 抓取 URL → 剥脚本样式 → LLM 摘要 |

（额外提供 `memory` 工具封装 MemoryManager，供 Agent 在对话中自主存取记忆）

## 快速开始

### 1. 环境要求

- Node.js ≥ 18（使用原生 `fetch`、`AbortSignal.timeout`）
- pnpm ≥ 9（或 npm/yarn，但需自行替换命令）

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置 API Key

复制环境变量示例文件并填入 DeepSeek API Key（注册 [platform.deepseek.com](https://platform.deepseek.com) 获取）：

```bash
cp .env.example .env
# 编辑 .env，写入 DEEPSEEK_API_KEY=你的key
```

`.env` 文件内容示例：

```
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxx
```

### 4. 启动 CLI

```bash
pnpm start
```

启动后会看到欢迎横幅与可用工具列表，然后进入交互循环：

```
══════════════════════════════════════════════════════════
        个人助手 Agent v1.0.0                              
   ReAct + PlanAndSolve + Reflection + Memory + Tools     
══════════════════════════════════════════════════════════
✅ 已加载 6 个工具: calculator, get_weather, todo, note, web_summary, memory

请输入问题开始对话：

👤 >
```

## CLI 命令

| 命令 | 作用 |
|---|---|
| `/help` | 查看帮助 |
| `/tools` | 列出已注册工具 |
| `/memory` | 查看记忆统计 |
| `/clear` | 清屏 |
| `/exit` `/quit` | 退出 |
| 其他输入 | 作为用户问题交给调度中心处理 |

## 使用示例

### 示例 1：简单问题（直接走 ReAct）

```
👤 > 算一下 (15 + 28) * 3 / 2 等于多少

🧭 [Scheduler] 复杂度判定: simple
🚀 [Scheduler] 简单问题 → 直接走 ReAct 循环
--- [ReAct] 第 1 步 ---
Thought: 需要计算 (15 + 28) * 3 / 2，调用 calculator 工具
Action: calculator[{"expr":"(15+28)*3/2"}]
Observation: (15+28)*3/2 = 64.5
🎉 最终答案: (15+28)*3/2 = 64.5

🤖 > (15+28)*3/2 = 64.5
```

### 示例 2：多工具复杂问题（三范式混合）

```
👤 > 帮我查一下北京天气，再算 365*24 等于多少
......
🤖 > 北京：晴，温度25°C，湿度45%，风速8km/h；365*24 = 8760
```

### 示例 3：复杂问题（三范式混合）

```
👤 > 查北京天气，如果温度低于20度建议穿外套，否则建议短袖。然后帮我加一条待办：明天根据天气结果决定穿搭，再把这个建议写进笔记标签为"穿搭"

🧭 [Scheduler] 复杂度判定: complex
🎯 [Scheduler] 复杂问题 → 走三范式混合
========== [Scheduler] 阶段 1: PlanAndSolve 生成全局计划 ==========
✅ 计划：["查询北京当前天气","根据温度生成穿搭建议","新增待办事项","写入笔记"]
========== [Scheduler] 阶段 2.1: ReAct 执行步骤 ==========
📋 步骤: 查询北京当前天气
🔧 [Tool] get_weather({"location":"北京"}) → 北京：晴，温度25°C，湿度45%...
========== [Scheduler] 阶段 3.2: Reflection 把关 ==========
... (反思并优化产出)
========== [Scheduler] 阶段 4: 汇总最终答案 ==========

🤖 > 已为您完成所有任务：
1. 北京当前天气：晴，25°C
2. 温度高于20度，建议穿短袖
3. 已新增待办 #1：明天根据天气结果决定穿搭
4. 已新增笔记 #1 标签[穿搭]：根据天气结果决定穿搭
```

### 示例 4：记忆存取

```
👤 > 我叫张三，请记住

🤖 > 好的，张三，已经记下了。

👤 > /memory
记忆统计: { working: 0, episodic: 0, semantic: 1 }

👤 > 你还记得我叫什么吗？

🤖 > 你叫张三。
```

### 示例 5：网页摘要

```
👤 > 帮我摘要一下这个网页 https://github.com/datawhalechina/hello-agents

🤖 > 【https://github.com/datawhalechina/hello-agents 摘要】
该项目是 Datawhale 团队的 AI Agent 开发教程仓库...
```

## 工作原理

### 工具调用模式：ReAct 文本模式（实际使用）

本项目运行时统一采用 **ReAct 文本模式**：所有 Agent 调 LLM 时均不传 `tools` 参数，LLM 用 `Thought/Action` 文本输出决策，由代码解析 `toolName[toolInput]` 调用工具（见 `agents/react_agent.js` 的 `_parseAction`）。

采用文本模式的原因：

1. **避免双重触发**：若同时传 `tools` 又在提示词中要求 Thought/Action 格式，模型可能在原生 Function Calling 通道与文本通道间摇摆，行为分裂
2. **行为可控、调试方便**：提示词完全掌控决策格式，对模型无 Function Calling 能力要求

Function Calling 基础设施已就绪，可通过 `.env` 全局开关启用（默认关闭）：

```bash
# .env
ENABLE_FUNCTION_CALLING=true
```

开启后 ReAct Agent 自动切换为原生 Function Calling 循环：`ToolRegistry.get_tools_schemas()` 输出标准 tools schema 传给 API，LLM 返回 `tool_calls` 由 `Agent._handleToolCalls()` 统一执行并以 `role:'tool'` 回传结果。

也可在构造 Agent 时用 `useFunctionCalling` 选项覆盖全局开关：

```javascript
new ReActAgent({ toolRegistry, useFunctionCalling: true });
```

### 三范式混合策略

调度中心的核心设计：

1. **PlanAndSolve 做骨架**：先用 Planner 把复杂问题拆成步骤数组，输出可解析的 JavaScript 字符串数组
2. **每步用 ReAct 执行**：把"原始问题+上下文+当前步骤"组合成子问题，让 ReAct 在子任务粒度上动态调工具
3. **关键节点用 Reflection 把关**：每 2 步及最后一步，把产出交给 Reflection 反思+优化
4. **最后汇总**：所有步骤结果交给 LLM 综合成自然语言答案

每个阶段都有兜底降级（规划失败→直接 ReAct、汇总失败→拼接产出），保证流程不中断。

## 开发与扩展

### 新增工具

1. 在 `tools/builtin/` 下新建文件，继承 `Tool` 基类：

```javascript
import { Tool } from '../base.js';

class MyTool extends Tool {
  constructor() {
    super({
      name: 'my_tool',
      description: '工具描述（给 LLM 看）',
      parameters: {
        type: 'object',
        properties: { /* ... */ },
        required: ['arg1'],
      },
    });
  }

  async _execute({ arg1 }) {
    return `结果: ${arg1}`;
  }
}

export const myTool = new MyTool();
```

2. 在 `cli.js` 启动时注册：

```javascript
import { myTool } from './tools/builtin/my_tool.js';
toolRegistry.register_tool(myTool);
```

### 切换 LLM

修改 `core/llm.js` 中的 `baseURL` 和 `apiKey` 即可切换到任意 OpenAI 兼容 API（如 OpenAI 官方、Moonshot、通义千问等）。

### 调整 Agent 步数

构造时传 `maxSteps`：

```javascript
const scheduler = new AgentScheduler({
  toolRegistry,
  memoryManager,
  maxSteps: { react: 6, planAndSolve: 6, reflection: 3 },   // ReAct/PlanAndSolve/Reflection 最大循环步数
});
```

## 参考

- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents) 第七章 构建你的 Agent 框架

## License

MIT
