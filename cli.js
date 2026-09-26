/**
 * 命令行交互界面（CLI）
 * 启动后进入交互循环，输入问题 → 调度中心处理 → 输出答案
 * 支持命令：
 *   /help    查看帮助
 *   /tools   列出已注册工具
 *   /memory  查看记忆统计
 *   /exit    退出
 */
import readline from 'readline';
import { ToolRegistry } from './tools/registry.js';
import { MemoryManager } from './memory/manager.js';
import { AgentScheduler } from './scheduler/index.js';
import { agentTrace } from './core/agent-trace.js';

// 内置工具
import { calculatorTool } from './tools/builtin/calculator.js';
import { getWeatherTool } from './tools/builtin/get_weather.js';
import { todoTool } from './tools/builtin/todo.js';
import { noteTool } from './tools/builtin/note.js';
import { webSummaryTool } from './tools/builtin/web_summary.js';
import { MemoryTool } from './tools/builtin/memory_tool.js';

// 项目版本号
import pkg from './package.json' with { type: 'json' };

// 启动横幅
const BANNER = `
══════════════════════════════════════════════════════════
        个人助手 Agent v${pkg.version}                       
   ReAct + PlanAndSolve + Reflection + Memory + Tools       
══════════════════════════════════════════════════════════
`;

const HELP = `
可用命令：
  /help           查看帮助
  /tools          列出已注册工具
  /memory         查看记忆统计
  /trace          查看 Trace 统计（LLM/工具调用次数、Token、耗时）
  /clear          清屏
  /exit 或 /quit  退出
其他输入视为用户问题，由调度中心处理。
`;

/**
 * 初始化基础设施：工具注册中心 + 记忆管理器 + 调度中心
 */
function bootstrap() {
  // 1. 记忆管理器
  const memoryManager = new MemoryManager({ userID: 'cli_user' });

  // 2. 工具注册中心：注册 5 个内置工具 + memory 工具
  const toolRegistry = new ToolRegistry();
  toolRegistry.register_tool(calculatorTool);
  toolRegistry.register_tool(getWeatherTool);
  toolRegistry.register_tool(todoTool);
  toolRegistry.register_tool(noteTool);
  toolRegistry.register_tool(webSummaryTool);
  // memory 工具复用同一 MemoryManager，便于跨会话记忆联动
  toolRegistry.register_tool(new MemoryTool({ memoryManager }));

  // 3. 调度中心：三个 Agent 各自独立配置 maxSteps
  //    - ReAct 8 步：覆盖大多数多工具调用场景
  //    - PlanAndSolve 6 步：常见任务计划长度
  //    - Reflection 3 步：反思一般 3 轮收敛
  const scheduler = new AgentScheduler({
    toolRegistry,
    memoryManager,
    maxSteps: { react: 8, planAndSolve: 6, reflection: 3 },
    verbose: true,
  });

  return { memoryManager, toolRegistry, scheduler };
}

/**
 * 启动交互循环
 */
async function startCLI() {
  console.log(BANNER);

  // 启动时初始化基础设施（异常时退出）
  let ctx;
  try {
    ctx = bootstrap();
    console.log(`✅ 已加载 ${ctx.toolRegistry.list_names().length} 个工具: ${ctx.toolRegistry.list_names().join(', ')}`);
  } catch (err) {
    console.error(`\n❌ 初始化失败: ${err.message}`);
    console.error('提示：请先在项目根目录 .env 中配置 DEEPSEEK_API_KEY');
    process.exit(1);
  }

  console.log(HELP);
  console.log('请输入问题开始对话：\n');

  // 创建 readline 接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '👤 > ',
  });
  rl.prompt();

  rl.on('line', async (input) => {
    const text = input.trim();
    // 空行直接跳过
    if (!text) {
      rl.prompt();
      return;
    }

    // 命令处理
    if (text.startsWith('/')) {
      switch (text.toLowerCase()) {
        case '/help':
          console.log(HELP);
          break;
        case '/tools':
          console.log('\n已注册工具：');
          console.log(ctx.toolRegistry.get_tools_description());
          console.log('');
          break;
        case '/memory':
          console.log('\n记忆统计:', ctx.memoryManager.stats());
          console.log('');
          break;
        case '/trace':
          agentTrace.printSummary();
          console.log('');
          break;
        case '/clear':
          console.clear();
          break;
        case '/exit':
        case '/quit':
          console.log('👋 再见！');
          rl.close();
          process.exit(0);
          break; // 不可达但保留，保证 case 语法隔离
        default:
          console.log(`未知命令: ${text}\n输入 /help 查看帮助`);
      }
      rl.prompt();
      return;
    }

    // 普通问题：交给调度中心处理
    try {
      const { answer, streamed } = await ctx.scheduler.run(text);
      if (streamed) {
        // 流式模式：答案已在生成时实时输出（含 🤖 > 前缀，llm.js 流结束补换行），此处仅补空行排版
        console.log('');
      } else {
        console.log(`\n🤖 > ${answer}\n`);
      }
    } catch (err) {
      console.error(`\n❌ 执行出错: ${err.message}\n`);
    }
    rl.prompt();
  });

  // Ctrl+C / Ctrl+D 退出
  rl.on('SIGINT', () => {
    console.log('\n👋 再见！');
    process.exit(0);
  });
}

// 启动入口
startCLI().catch((err) => {
  console.error('❌ CLI 启动失败:', err.message);
  process.exit(1);
});
