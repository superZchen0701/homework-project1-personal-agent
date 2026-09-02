/**
 * MemoryItem：标准化记忆项 - 记忆系统的最小数据单元
 */
export class MemoryItem {
  /**
   * @param {object} options
   * @param {string} options.content     记忆内容文本
   * @param {string} options.type        working / episodic / semantic
   * @param {object} [options.metadata] 附加元数据（用户ID、轮次、来源等）
   * @param {number} [options.importance=0.5] 重要性 0~1
   */
  constructor({ content, type, metadata = {}, importance = 0.5 }) {
    this.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; // 唯一ID
    this.content = content;
    this.type = type;
    this.metadata = metadata;
    this.importance = importance;
    this.createdAt = Date.now();
    this.lastAccessedAt = Date.now();
    this.accessCount = 0;
  }

  // 记录一次访问（用于"久未访问"遗忘判断）
  touch() {
    this.lastAccessedAt = Date.now();
    this.accessCount++;
  }
}

/**
 * BaseMemory：记忆基类
 * 定义 5 个认知阶段接口：编码→存储→检索→整合(在Manager)→遗忘
 * 子类只需实现 add / search / forget
 */
export class BaseMemory {
  constructor(config = {}) {
    this.config = config;
    this.items = [];
  }

  // 编码：构造 MemoryItem，不存储
  encode(content, metadata = {}, importance = 0.5) {
    return new MemoryItem({
      content,
      type: this.typeName,
      metadata,
      importance,
    });
  }

  add(/* item */) {
    throw new Error('子类必须实现 add()');
  }

  search(/* query, limit */) {
    throw new Error('子类必须实现 search()');
  }

  forget() {
    throw new Error('子类必须实现 forget()');
  }

  /**
   * 通用关键词匹配（教学版，零外部依赖）
   * 1) 整段包含（最快路径，LLM 用精确关键词时命中）
   * 2) 不命中 → 分词 + 中文 n-gram 滑窗辅助匹配
   * 生产环境可替换为向量相似度
   * @param {string} text  待检索文本
   * @param {string} query 查询关键词
   * @returns {boolean}
   */
  _match(text, query) {
    if (!query) return true;
    const t = String(text).toLowerCase();
    const q = String(query).toLowerCase();
    // 1) 整段包含
    if (t.includes(q)) return true;
    // 2) 按标点/空白拆 token
    const rawTokens = q
      .split(/[\s,，。、;；:：.!?？！""'()'（）\[\]【】\-—_\/]+/)
      .filter((tk) => tk.length >= 1);
    if (!rawTokens.length) return false;
    // 3) 对中文 token 生成 2~min(len,4) 字 n-gram 辅助匹配
    const isChinese = (s) => /[\u4e00-\u9fa5]/.test(s);
    const ngramsOf = (s) => {
      const grams = new Set();
      for (let n = 2; n <= Math.min(s.length, 4); n++) {
        for (let i = 0; i <= s.length - n; i++) grams.add(s.slice(i, i + n));
      }
      return [...grams];
    };
    for (const tk of rawTokens) {
      if (t.includes(tk)) return true;
      if (isChinese(tk) && tk.length >= 2) {
        for (const gram of ngramsOf(tk)) {
          if (t.includes(gram)) return true;
        }
      }
    }
    return false;
  }
}
