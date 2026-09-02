/**
 * 情景记忆（长期） - 具体交互事件，按时间序列检索
 * 跨会话持久化，是 Agent "复盘学习" 的基础
 */
import { BaseMemory } from '../base.js';

export class EpisodicMemory extends BaseMemory {
  constructor(config = {}) {
    super(config);
    this.typeName = 'episodic';
  }

  add(item) {
    item.type = 'episodic';
    this.items.push(item);
    // 长期记忆无容量限制（教学版内存存储，生产环境可持久化到向量库）
  }

  search(query, limit = 5) {
    // 情景记忆：按时间倒序 + 关键词匹配
    return this.items
      .filter((item) => this._match(item.content, query))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((item) => { item.touch(); return item; });
  }

  forget() {
    // 遗忘策略：重要性低(低于0.3) + 长期未访问(超过7天)
    const now = Date.now();
    const staleThreshold = 7 * 24 * 60 * 60 * 1000; // 7 天
    const before = this.items.length;
    this.items = this.items.filter(
      (item) => item.importance > 0.3 || now - item.lastAccessedAt < staleThreshold
    );
    return before - this.items.length;
  }
}
