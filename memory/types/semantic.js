/**
 * 语义记忆（长期） - 抽象知识/概念/用户偏好
 * 高持久性，是 Agent 形成"知识体系"的核心
 */
import { BaseMemory } from '../base.js';

export class SemanticMemory extends BaseMemory {
  constructor(config = {}) {
    super(config);
    this.typeName = 'semantic';
  }

  add(item) {
    item.type = 'semantic';
    // 语义记忆去重（按内容精确匹配，避免重复存储）
    const exists = this.items.some((i) => i.content === item.content);
    if (!exists) this.items.push(item);
  }

  search(query, limit = 5) {
    // 语义记忆：按重要性 + 关键词匹配
    return this.items
      .filter((item) => this._match(item.content, query))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit)
      .map((item) => { item.touch(); return item; });
  }

  forget() {
    // 遗忘策略：仅遗忘重要性极低的记忆(低于0.1)
    const before = this.items.length;
    this.items = this.items.filter((item) => item.importance > 0.1);
    return before - this.items.length;
  }
}
