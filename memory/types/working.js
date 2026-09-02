/**
 * 工作记忆（短期） - 当前对话上下文
 * 容量有限，FIFO 淘汰，会话级生命周期
 */
import { BaseMemory } from '../base.js';

export class WorkingMemory extends BaseMemory {
  constructor(config = {}) {
    super(config);
    this.typeName = 'working';
    this.maxSize = config.maxSize || 50; // 默认 50 条
  }

  add(item) {
    item.type = 'working';
    this.items.push(item);
    // 超容量 FIFO 淘汰最早条目
    while (this.items.length > this.maxSize) this.items.shift();
  }

  search(query, limit = 5) {
    // 短期记忆：按时间倒序取最近 N 条匹配项
    return this.items
      .filter((item) => this._match(item.content, query))
      .slice(-limit)
      .reverse()
      .map((item) => { item.touch(); return item; });
  }

  forget() {
    // 工作记忆：不主动遗忘，由会话结束时 clear() 全量清理
    return 0;
  }

  // 会话结束时清理全部短期记忆
  clear() {
    this.items = [];
  }
}
