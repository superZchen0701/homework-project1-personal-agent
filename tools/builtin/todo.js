/**
 * 内置工具：待办管理
 * 增删改查用户待办事项，内存存储（教学版）
 * 操作：add(增) / list(查) / complete(标记完成) / delete(删)
 */
import { Tool } from '../base.js';

class TodoTool extends Tool {
  constructor() {
    super({
      name: 'todo',
      description:
        '管理用户待办事项，支持增删改查。操作: add(新增待办) / list(列出全部) / complete(标记完成) / delete(删除)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'list', 'complete', 'delete'],
            description: '操作类型',
          },
          title: {
            type: 'string',
            description: 'add 时的待办标题',
          },
          id: {
            type: 'number',
            description: 'complete/delete 时的待办ID',
          },
        },
        required: ['action'],
      },
    });
    // 待办存储：{ id, title, done, createdAt }
    // 底部单例导出保证进程内共享；作为实例属性便于封装与测试隔离
    this.todos = [];
    this.todoId = 0;
  }

  async _execute({ action, title, id }) {
    switch (action) {
      case 'add': {
        if (!title || !title.trim()) return '错误：title 不能为空';
        const todo = { id: ++this.todoId, title: title.trim(), done: false, createdAt: Date.now() };
        this.todos.push(todo);
        return `已新增待办 #${todo.id}: ${todo.title}`;
      }
      case 'list': {
        if (!this.todos.length) return '当前没有待办事项';
        return this.todos
          .map((t) => `${t.done ? '[x]' : '[ ]'} #${t.id} ${t.title}`)
          .join('\n');
      }
      case 'complete': {
        const t = this.todos.find((x) => x.id === id);
        if (!t) return `错误：未找到待办 #${id}`;
        if (t.done) return `待办 #${id} 已经完成`;
        t.done = true;
        return `已标记待办 #${id} 完成: ${t.title}`;
      }
      case 'delete': {
        const idx = this.todos.findIndex((x) => x.id === id);
        if (idx < 0) return `错误：未找到待办 #${id}`;
        const [removed] = this.todos.splice(idx, 1);
        return `已删除待办 #${removed.id}: ${removed.title}`;
      }
      default:
        return `未知操作: ${action}`;
    }
  }
}

export const todoTool = new TodoTool();
export default todoTool;
