/**
 * 内置工具：记忆管理（封装 MemoryManager）
 * 让 Agent 通过 Function Calling 主动存/取长期记忆
 *
 * 支持操作：
 *   - add:        存储记忆（working/episodic/semantic）
 *   - search:     跨记忆类型检索
 *   - consolidate: 工作记忆→情景记忆整合
 *   - forget:     执行遗忘策略
 */
import { Tool } from '../base.js';
import { MemoryManager } from '../../memory/manager.js';

class MemoryTool extends Tool {
  /**
   * @param {object} [options]
   * @param {MemoryManager} [options.memoryManager] 注入外部 MemoryManager（可选）
   * @param {string} [options.userID]               用户ID
   */
  constructor({ memoryManager, userID = 'default_user' } = {}) {
    super({
      name: 'memory',
      description:
        '存储和检索长期记忆，支持短期(working)/长期(episodic/semantic)记忆管理。用户告知关键信息(姓名/偏好/计划/事件)时调用 add 存储；用户问"还记得...吗"时调用 search 检索。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'search', 'consolidate', 'forget'],
            description: '操作类型: add(存储) / search(检索) / consolidate(整合) / forget(遗忘)',
          },
          content: {
            type: 'string',
            description: 'add 时的记忆内容（单条信息，禁止把多条信息拼成一条）',
          },
          query: {
            type: 'string',
            description:
              "search 时的检索关键词，必须用具体关键词（如 '张三' 'TypeScript'）而非自然语言描述",
          },
          type: {
            type: 'string',
            enum: ['working', 'episodic', 'semantic'],
            description: '记忆类型，默认 working。语义/偏好→semantic；具体事件→working',
          },
          importance: {
            type: 'number',
            description:
              '重要性 0~1，默认 0.5。身份/长期偏好/明确计划取 0.8-0.9；具体事件取 0.5-0.7；寒暄取 0.2-0.3',
          },
        },
        required: ['action'],
      },
    });
    // 复用外部 MemoryManager 或自建
    this.memoryManager = memoryManager || new MemoryManager({ userID });
  }

  async _execute({ action, content = '', query = '', type = 'working', importance = 0.5 }) {
    const mm = this.memoryManager;
    switch (action) {
      case 'add':
        if (!content.trim()) return '错误：content 不能为空';
        return `已存储记忆: ${mm.add(content, type, {}, importance).id}`;
      case 'search': {
        const results = mm.search(query);
        if (!results.length) return '未检索到相关记忆';
        return JSON.stringify(
          results.map((r) => ({
            type: r.type,
            content: r.content,
            importance: r.importance,
          })),
          null,
          2
        );
      }
      case 'consolidate':
        return `已整合 ${mm.consolidate()} 条记忆`;
      case 'forget':
        return `已遗忘 ${mm.forget()} 条记忆`;
      default:
        return `未知操作: ${action}`;
    }
  }
}

export { MemoryTool };
export const memoryTool = new MemoryTool();
export default memoryTool;
