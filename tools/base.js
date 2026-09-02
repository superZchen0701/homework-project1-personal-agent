/**
 * Tool 工具基类
 * 标准化工具对象结构，便于在 ToolRegistry 中统一管理
 *
 * 标准结构：
 *   - name:        工具名（唯一标识，LLM 通过此名调用）
 *   - description: 给 LLM 看的用途说明（影响 LLM 何时选择此工具）
 *   - parameters:  JSON Schema 描述参数
 *   - func:         实际执行的 JS 函数（可为 async），参数为解析后的 args 对象
 *
 * 子类只需在构造函数中设置 name/description/parameters 并实现 _execute(args)
 */
export class Tool {
  constructor({ name, description, parameters, func }) {
    if (!name) throw new Error('Tool 必须提供 name');
    this.name = name;
    this.description = description || '';
    this.parameters = parameters || { type: 'object', properties: {} };
    // func 可由子类实现 _execute，也可直接传入
    this.func = func || this._execute.bind(this);
  }

  // 子类覆盖：执行工具逻辑，返回字符串或可序列化值
  async _execute(/* args */) {
    throw new Error(`Tool '${this.name}' 必须实现 _execute() 或在构造时传入 func`);
  }
}

export default Tool;
