/**
 * 内置工具：计算器
 * 计算数学表达式并返回结果
 * 安全：仅允许数字和运算符，过滤危险字符
 */
import { Tool } from '../base.js';

class CalculatorTool extends Tool {
  constructor() {
    super({
      name: 'calculator',
      description: '计算数学表达式并返回结果，如 3*7、(1+2)*3',
      parameters: {
        type: 'object',
        properties: {
          expr: {
            type: 'string',
            description: '数学表达式，仅支持数字与 + - * / % ( ) ，如 (1+2)*3',
          },
        },
        required: ['expr'],
      },
    });
  }

  async _execute({ expr }) {
    if (typeof expr !== 'string' || !expr.trim()) {
      return '错误：表达式为空';
    }
    // 仅允许数字、空格和运算符，防注入
    if (!/^[\d\s+\-*/%.()]+$/.test(expr)) {
      return `错误：表达式含非法字符 '${expr}'`;
    }
    try {
      // 用 Function 构造函数计算（已白名单校验，可信任）
      const result = new Function(`"use strict"; return (${expr});`)();
      if (typeof result !== 'number' || !Number.isFinite(result)) {
        return `${expr} = 结果无效`;
      }
      return `${expr} = ${result}`;
    } catch (err) {
      return `计算失败: ${err.message}`;
    }
  }
}

export const calculatorTool = new CalculatorTool();
export default calculatorTool;
