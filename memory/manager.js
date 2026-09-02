/**
 * MemoryManager：记忆管理器
 * 统一调度 5 阶段认知流程：编码→存储→检索→整合→遗忘
 * 跨三种记忆类型（working/episodic/semantic）协同工作
 *
 * 设计要点：
 * - 编码+存储：add() 同时完成（构造 MemoryItem + 入对应记忆容器）
 * - 检索：跨记忆类型，综合排序（重要性优先，再按访问时间）
 * - 整合：把重要的工作记忆固化为情景记忆（短期→长期）
 * - 遗忘：各记忆类型按自身策略清理
 */
import { MemoryItem } from './base.js';
import { WorkingMemory } from './types/working.js';
import { EpisodicMemory } from './types/episodic.js';
import { SemanticMemory } from './types/semantic.js';

export class MemoryManager {
  /**
   * @param {object} [params]
   * @param {string} [params.userID='default_user']
   * @param {boolean} [params.enableWorking=true]
   * @param {boolean} [params.enableEpisodic=true]
   * @param {boolean} [params.enableSemantic=true]
   */
  constructor(params = {}) {
    const {
      userID = 'default_user',
      enableWorking = true,
      enableEpisodic = true,
      enableSemantic = true,
    } = params;

    this.userID = userID;
    this.memory_types = {};

    if (enableWorking) this.memory_types.working = new WorkingMemory();
    if (enableEpisodic) this.memory_types.episodic = new EpisodicMemory();
    if (enableSemantic) this.memory_types.semantic = new SemanticMemory();
  }

  // 阶段1+2：编码 + 存储
  add(content, type = 'working', metadata = {}, importance = 0.5) {
    const memory = this.memory_types[type];
    if (!memory) {
      throw new Error(
        `未知记忆类型: '${type}'，可用: ${Object.keys(this.memory_types).join(', ')}`
      );
    }
    const item = memory.encode(content, metadata, importance);
    memory.add(item);
    return item;
  }

  // 阶段3：检索（跨记忆类型）
  search(query, types = ['working', 'episodic', 'semantic'], limit = 5) {
    const results = [];
    for (const t of types) {
      const memory = this.memory_types[t];
      if (memory) results.push(...memory.search(query, limit));
    }
    // 综合排序：重要性优先，其次按访问时间
    const sorted = results
      .sort((a, b) => b.importance - a.importance || b.lastAccessedAt - a.lastAccessedAt)
      .slice(0, limit);

    // 降级兜底：精确匹配空时，返回 Top-N 高 importance 记忆给 LLM 参考
    if (sorted.length === 0) {
      const fallback = [];
      for (const t of types) {
        const memory = this.memory_types[t];
        if (memory) fallback.push(...memory.items);
      }
      return fallback
        .sort((a, b) => b.importance - a.importance || b.lastAccessedAt - a.lastAccessedAt)
        .slice(0, limit)
        .map((item) => { item.touch(); return item; });
    }
    return sorted;
  }

  // 阶段4：整合 - 把重要的工作记忆固化为情景记忆（对标人类记忆固化）
  consolidate() {
    const working = this.memory_types.working;
    const episodic = this.memory_types.episodic;
    if (!working || !episodic) return 0;

    let count = 0;
    for (const item of working.items) {
      // 重要性 ≥ 0.6 的短期记忆固化为长期情景记忆
      if (item.importance >= 0.6) {
        const consolidated = new MemoryItem({
          content: item.content,
          type: 'episodic',
          metadata: { ...item.metadata, consolidatedFrom: 'working' },
          importance: item.importance,
        });
        episodic.add(consolidated);
        count++;
      }
    }
    console.log(`[MemoryManager] 整合完成：${count} 条工作记忆 → 情景记忆`);
    return count;
  }

  // 阶段5：遗忘 - 删除不重要或过时的信息
  forget() {
    let total = 0;
    for (const memory of Object.values(this.memory_types)) {
      if (memory.forget) {
        const removed = memory.forget() || 0;
        total += removed;
      }
    }
    console.log(`[MemoryManager] 遗忘完成：清理 ${total} 条低价值记忆`);
    return total;
  }

  // 会话结束清理（仅短期工作记忆）
  clearSession() {
    if (this.memory_types.working) {
      this.memory_types.working.clear();
      console.log('[MemoryManager] 工作记忆会话清理完成');
    }
  }

  // 观测：打印各类型记忆统计
  stats() {
    const stats = {};
    for (const [type, memory] of Object.entries(this.memory_types)) {
      stats[type] = memory.items.length;
    }
    return stats;
  }
}

export default MemoryManager;
