/**
 * 内置工具：笔记管理
 * 按标签存储/检索用户笔记，内存存储（教学版）
 * 操作：add(新增笔记) / get(按标签查询) / list(列出全部标签) / delete(删除)
 */
import { Tool } from '../base.js';

class NoteTool extends Tool {
  constructor() {
    super({
      name: 'note',
      description:
        '管理用户笔记，支持按标签存储/检索。操作: add(新增) / get(按标签查询) / list(列出所有标签) / delete(按ID删除)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'get', 'list', 'delete'],
            description: '操作类型',
          },
          content: {
            type: 'string',
            description: 'add 时的笔记内容',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'add 时的标签数组，如 ["工作","会议"]',
          },
          tag: {
            type: 'string',
            description: 'get 时的查询标签（匹配任一标签即返回）',
          },
          id: {
            type: 'number',
            description: 'delete 时的笔记ID',
          },
        },
        required: ['action'],
      },
    });
    // 笔记存储：{ id, content, tags, createdAt }
    // 底部单例导出保证进程内共享；作为实例属性便于封装与测试隔离
    this.notes = [];
    this.noteId = 0;
  }

  async _execute({ action, content, tags = [], tag, id }) {
    switch (action) {
      case 'add': {
        if (!content || !content.trim()) return '错误：content 不能为空';
        const note = { id: ++this.noteId, content: content.trim(), tags, createdAt: Date.now() };
        this.notes.push(note);
        return `已新增笔记 #${note.id} 标签[${tags.join(',') || '无'}]`;
      }
      case 'get': {
        if (!tag) return '错误：tag 不能为空';
        const hits = this.notes.filter((n) => n.tags.includes(tag));
        if (!hits.length) return `没有标签为 '${tag}' 的笔记`;
        return hits.map((n) => `#${n.id} [${n.tags.join(',')}] ${n.content}`).join('\n');
      }
      case 'list': {
        const allTags = [...new Set(this.notes.flatMap((n) => n.tags))];
        if (!allTags.length) return '当前没有笔记';
        return `所有标签: ${allTags.join(', ')}`;
      }
      case 'delete': {
        const idx = this.notes.findIndex((n) => n.id === id);
        if (idx < 0) return `错误：未找到笔记 #${id}`;
        const [removed] = this.notes.splice(idx, 1);
        return `已删除笔记 #${removed.id}: ${removed.content.slice(0, 30)}...`;
      }
      default:
        return `未知操作: ${action}`;
    }
  }
}

export const noteTool = new NoteTool();
export default noteTool;
