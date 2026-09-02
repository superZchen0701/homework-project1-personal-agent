/**
 * ToolRegistry：工具注册中心
 * 统一管理工具的定义、描述、执行函数
 *
 * 采用单一容器设计（业界主流做法，同 LangChain/OpenAI SDK）：
 *   _tools: name -> { name, description, parameters, func }
 *
 * 支持两种注册方式：
 *   1) Tool 对象注册：适合复杂工具（完整 schema + 验证）
 *   2) 函数直接注册：适合简单工具（内部包装成标准 Tool 后复用 register_tool）
 */
export class ToolRegistry {
  constructor() {
    // 唯一容器：name -> { name, description, parameters, func }
    this._tools = {};
  }

  // 默认参数 schema：无参数工具的兜底描述
  static EMPTY_PARAMETERS = { type: 'object', properties: {} };

  /**
   * 注册标准 Tool 对象
   * @param {object} tool  { name, description, parameters, func }
   */
  register_tool(tool) {
    if (!tool || !tool.name || typeof tool.func !== 'function') {
      throw new Error(
        `无效的工具定义 '${tool?.name}': 需要 name(非空) 和 func(函数) 字段`
      );
    }
    if (this._tools[tool.name]) {
      console.log(`⚠️ 警告: 工具 '${tool.name}' 已存在，将被覆盖。`);
    }
    this._tools[tool.name] = tool;
    console.log(`✅ 工具 '${tool.name}' 已注册。`);
  }

  /**
   * 直接注册函数作为工具（简便方式）
   * 内部包装成标准 Tool 对象后复用 register_tool
   * @param {string} name
   * @param {string} description
   * @param {object} parameters  JSON Schema
   * @param {function} func
   */
  register_function(name, description, parameters, func) {
    this.register_tool({
      name,
      description,
      parameters: parameters || ToolRegistry.EMPTY_PARAMETERS,
      func,
    });
  }

  // 获取所有可用工具的格式化描述字符串（用于 ReAct 提示词）
  // 含完整参数 schema：文本模式下 LLM 必须知道每个工具的 JSON 参数格式，否则会瞎猜参数结构
  get_tools_description() {
    const descriptions = Object.values(this._tools).map((tool) => {
      const params = JSON.stringify(tool.parameters || ToolRegistry.EMPTY_PARAMETERS);
      return `- ${tool.name}: ${tool.description}\n  参数 schema（tool_input 必须是符合此 schema 的 JSON 对象字符串）: ${params}`;
    });
    return descriptions.length ? descriptions.join('\n') : '暂无可用工具';
  }

  /**
   * 转换为 OpenAI/DeepSeek Function Calling 所需的 tools 参数格式
   * @returns {Array} [{ type:'function', function:{ name, description, parameters } }]
   */
  get_tools_schemas() {
    return Object.values(this._tools).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || ToolRegistry.EMPTY_PARAMETERS,
      },
    }));
  }

  /**
   * 按名称执行工具
   * @param {string} name  工具名
   * @param {object} args  已解析的参数对象（调用方先 JSON.parse(tool.function.arguments)）
   * @returns {Promise<string>}  字符串结果，回传给 LLM 时 role:'tool' 的 content 必须为字符串
   */
  async execute_tool(name, args = {}) {
    const tool = this._tools[name];
    if (!tool) {
      return `错误: 未找到工具 '${name}'，可用工具: ${Object.keys(this._tools).join(', ')}`;
    }
    try {
      const result = await tool.func(args);
      // 非字符串结果序列化为字符串，保证 content 类型合法
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (err) {
      // 工具异常不中断 Agent 循环，把错误信息作为结果回传给 LLM 自行决策
      console.error(`❌ 执行工具 '${name}' 失败: ${err.message}`);
      return `工具 '${name}' 执行失败: ${err.message}`;
    }
  }

  // 获取所有已注册工具名
  list_names() {
    return Object.keys(this._tools);
  }
}

export default ToolRegistry;
