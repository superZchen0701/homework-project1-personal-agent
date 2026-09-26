# homework-project1-personal-agent

AI Agent development 30-day transition learning plan assignment project — Personal Assistant Agent

A personal assistant Agent built on DeepSeek (OpenAI-compatible protocol), integrating the **ReAct / PlanAndSolve / Reflection three paradigms** + **Function Calling** + **Memory System** + **Tool Registry** + **Scheduler**, with a CLI interactive interface.

## Project Structure

```bash
homework-project1-personal-agent/
├── agents/                       # Three paradigm implementations
│   ├── react_agent.js            # ReAct: Thought→Action→Observation loop
│   ├── plan_and_solve_agent.js   # PlanAndSolve: plan first, then execute
│   └── reflection_agent.js       # Reflection: execute-reflect-refine iteration
├── core/                         # Core infrastructure
│   ├── agent.js                  # Agent base class (unified LLM calls + tool result handling)
│   ├── llm.js                    # Unified LLM interface (wraps DeepSeek/OpenAI SDK)
│   └── message.js                # Message construction + token estimation
├── memory/                       # Memory system
│   ├── base.js                   # MemoryItem + BaseMemory base classes
│   ├── manager.js                # MemoryManager: encode→store→retrieve→consolidate→forget
│   └── types/                    # Three memory types
│       ├── working.js            # Working memory (short-term, FIFO)
│       ├── episodic.js           # Episodic memory (long-term, by time)
│       └── semantic.js           # Semantic memory (long-term, by importance)
├── tools/                        # Tool system
│   ├── base.js                   # Tool base class
│   ├── registry.js               # ToolRegistry tool registration center
│   └── builtin/                  # Built-in tools
│       ├── calculator.js         # Calculator
│       ├── get_weather.js        # Weather query (wttr.in)
│       ├── todo.js               # Todo management
│       ├── note.js               # Note management (tags)
│       ├── web_summary.js        # Web page summary (fetch + LLM summarization)
│       └── memory_tool.js        # Memory access tool (wraps MemoryManager)
├── scheduler/
│   └── index.js                  # Scheduler: complexity classification + three-paradigm hybrid
├── cli.js                        # CLI entry point
├── .env.example                  # Environment variable example
├── package.json
└── README.md
```

## Key Features

### 1. Three Agent Paradigms

| Paradigm | File | Core Idea |
|---|---|---|
| **ReAct** | `agents/react_agent.js` | Thought→Action→Observation loop; LLM outputs text decisions, code parses tool calls |
| **PlanAndSolve** | `agents/plan_and_solve_agent.js` | LLM first outputs a step-by-step plan, then executes step by step |
| **Reflection** | `agents/reflection_agent.js` | Execute→reflect→refine iteration with convergence detection |

### 2. Scheduler (`scheduler/index.js`)

Scheduling flow:

```bash
User question → LLM complexity classification
            ├── simple  → ReAct single loop
            └── complex → Three-paradigm hybrid
                  1) PlanAndSolve as the skeleton: plan global steps
                  2) Each step executed by ReAct: dynamically call tools to complete subtasks
                  3) Key checkpoints reviewed by Reflection: reflect on and refine outputs
                  4) Aggregate to generate the final answer
```

### 3. Memory System (`memory/`)

- **Working Memory**: session-level short-term, FIFO eviction, default 50 entries
- **Episodic Memory**: long-term, retrieved by time series; forgotten after 7 days without access + low importance
- **Semantic Memory**: long-term, sorted by importance; only entries with importance < 0.1 are cleaned up
- **5-stage cognitive pipeline**: encode→store→retrieve→consolidate→forget
- **Cross-type retrieval**: composite ranking (importance first, then access time), with fallback
- **The Agent can actively store/retrieve memories via the memory tool**

### 4. Five Built-in Tools

| Tool | Function | Notes |
|---|---|---|
| `calculator` | Math calculation | Whitelist protection against injection; only numbers and operators allowed |
| `get_weather` | Weather query | Uses the free [wttr.in](https://github.com/chubin/wttr.in) API, no key required |
| `todo` | Todo management | Add/delete/query/update, in-memory storage |
| `note` | Note management | Store and retrieve by tags |
| `web_summary` | Web page summary | Fetch URL → strip scripts/styles → LLM summarization |

(An additional `memory` tool wraps the MemoryManager, allowing the Agent to store/retrieve memories autonomously in conversation.)

## Quick Start

### 1. Requirements

- Node.js ≥ 18 (uses native `fetch` and `AbortSignal.timeout`)
- pnpm ≥ 9 (or npm/yarn, but you need to replace the commands accordingly)

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure API Key

Copy the environment variable example file and fill in your DeepSeek API key (obtain one at [platform.deepseek.com](https://platform.deepseek.com)):

```bash
cp .env.example .env
# Edit .env and set DEEPSEEK_API_KEY=your_key
```

Example `.env` file content:

```
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxx
```

### 4. Start the CLI

```bash
pnpm start
```

After startup, you will see the welcome banner and the loaded tool list, then enter the interactive loop:

```
══════════════════════════════════════════════════════════
        Personal Assistant Agent v1.0.0
   ReAct + PlanAndSolve + Reflection + Memory + Tools
══════════════════════════════════════════════════════════
✅ Loaded 6 tools: calculator, get_weather, todo, note, web_summary, memory

Please enter your question to start:

👤 >
```

## CLI Commands

| Command | Purpose |
|---|---|
| `/help` | Show help |
| `/tools` | List registered tools |
| `/memory` | Show memory statistics |
| `/clear` | Clear the screen |
| `/exit` `/quit` | Exit |
| Other input | Treated as a user question and handled by the scheduler |

## Usage Examples

### Example 1: Simple Question (ReAct directly)

```
👤 > Calculate (15 + 28) * 3 / 2

🧭 [Scheduler] Complexity: simple
🚀 [Scheduler] Simple question → ReAct loop directly
--- [ReAct] Step 1 ---
Thought: Need to calculate (15 + 28) * 3 / 2, calling the calculator tool
Action: calculator[{"expr":"(15+28)*3/2"}]
Observation: (15+28)*3/2 = 64.5
🎉 Final answer: (15+28)*3/2 = 64.5

🤖 > (15+28)*3/2 = 64.5
```

### Example 2: Multi-tool Question (Three-paradigm hybrid)

```
👤 > Check the weather in Beijing, then calculate 365*24
......
🤖 > Beijing: sunny, temperature 25°C, humidity 45%, wind speed 8km/h; 365*24 = 8760
```

### Example 3: Complex Question (Three-paradigm hybrid)

```
👤 > Check the weather in Beijing; if the temperature is below 20 degrees suggest a coat, otherwise suggest a T-shirt. Then add a todo: decide what to wear tomorrow based on the weather result, and write this suggestion into a note tagged "outfit"

🧭 [Scheduler] Complexity: complex
🎯 [Scheduler] Complex question → three-paradigm hybrid
========== [Scheduler] Phase 1: PlanAndSolve generates the global plan ==========
✅ Plan: ["Query the current weather in Beijing","Generate outfit advice based on temperature","Add a todo item","Write into notes"]
========== [Scheduler] Phase 2.1: ReAct executes the step ==========
📋 Step: Query the current weather in Beijing
🔧 [Tool] get_weather({"location":"Beijing"}) → Beijing: sunny, temperature 25°C, humidity 45%...
========== [Scheduler] Phase 3: Reflection checkpoint ==========
... (reflect on and refine the output)
========== [Scheduler] Phase 4: Aggregate the final answer ==========

🤖 > All tasks completed:
1. Current weather in Beijing: sunny, 25°C
2. Temperature above 20 degrees, T-shirt suggested
3. Todo #1 added: decide what to wear tomorrow based on the weather result
4. Note #1 added with tag [outfit]: decide what to wear based on the weather result
```

### Example 4: Memory Storage and Retrieval

```
👤 > My name is Zhang San, please remember it

🤖 > Sure, Zhang San, I've noted it down.

👤 > /memory
Memory stats: { working: 0, episodic: 0, semantic: 1 }

👤 > Do you remember my name?

🤖 > Your name is Zhang San.
```

### Example 5: Web Page Summary

```
👤 > Summarize this web page for me: https://github.com/datawhalechina/hello-agents

🤖 > [https://github.com/datawhalechina/hello-agents Summary]
This project is an AI Agent development tutorial repository by the Datawhale team...
```

## How It Works

### Tool Calling Mode: ReAct Text Mode (in use)

This project consistently uses **ReAct text mode** at runtime: all Agents call the LLM without passing a `tools` parameter. The LLM outputs decisions as `Thought/Action` text, and the code parses `toolName[toolInput]` to invoke tools (see `_parseAction` in `agents/react_agent.js`).

Reasons for choosing text mode:

1. **Avoids double triggering**: if `tools` is passed while the prompt also requires the Thought/Action format, the model may waver between the native Function Calling channel and the text channel, leading to inconsistent behavior
2. **Controllable behavior, easy debugging**: the prompt fully controls the decision format, with no Function Calling capability requirements on the model

The Function Calling infrastructure is ready and can be enabled globally via a `.env` switch (disabled by default):

```bash
# .env
ENABLE_FUNCTION_CALLING=true
```

When enabled, the ReAct Agent automatically switches to the native Function Calling loop: `ToolRegistry.get_tools_schemas()` outputs standard tools schema passed to the API, and the LLM's returned `tool_calls` are executed uniformly by `Agent._handleToolCalls()` with results passed back as `role:'tool'`.

You can also override the global switch via the `useFunctionCalling` option when constructing an Agent:

```javascript
new ReActAgent({ toolRegistry, useFunctionCalling: true });
```

### Three-paradigm Hybrid Strategy

Core design of the scheduler:

1. **PlanAndSolve as the skeleton**: the Planner first breaks the complex question into a step array, outputting a parseable JavaScript string array
2. **Each step executed by ReAct**: combine "original question + context + current step" into a sub-question, letting ReAct dynamically call tools at sub-task granularity
3. **Key checkpoints reviewed by Reflection**: the final step's output is handed to Reflection for review and refinement (with full context of all completed steps so that reflection stays consistent with tool facts)
4. **Final aggregation**: all step results are handed to the LLM to synthesize a natural-language answer

Every phase has fallback degradation (planning failure → ReAct directly; aggregation failure → concatenate outputs) to keep the pipeline from breaking.

## Development & Extension

### Adding a New Tool

1. Create a new file under `tools/builtin/`, extending the `Tool` base class:

```javascript
import { Tool } from '../base.js';

class MyTool extends Tool {
  constructor() {
    super({
      name: 'my_tool',
      description: 'Tool description (for the LLM)',
      parameters: {
        type: 'object',
        properties: { /* ... */ },
        required: ['arg1'],
      },
    });
  }

  async _execute({ arg1 }) {
    return `Result: ${arg1}`;
  }
}

export const myTool = new MyTool();
```

2. Register it in `cli.js` at startup:

```javascript
import { myTool } from './tools/builtin/my_tool.js';
toolRegistry.register_tool(myTool);
```

### Switching LLM Providers

Modify `baseURL` and `apiKey` in `core/llm.js` to switch to any OpenAI-compatible API (OpenAI official, Moonshot, Qwen, etc.).

### Adjusting Agent Step Limits

Pass `maxSteps` when constructing:

```javascript
const scheduler = new AgentScheduler({
  toolRegistry,
  memoryManager,
  maxSteps: { react: 6, planAndSolve: 6, reflection: 3 },   // Max loop steps for ReAct/PlanAndSolve/Reflection
});
```

## Reference

- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents) Chapter 7: Build Your Own Agent Framework

## License

MIT
