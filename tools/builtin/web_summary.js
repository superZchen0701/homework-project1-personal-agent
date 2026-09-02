/**
 * 内置工具：网页摘要
 * 抓取指定 URL 的网页内容，调 LLM 生成结构化摘要
 * 流程：fetch HTML → 剥离脚本样式标签 → 提取纯文本 → LLM 摘要
 */
import { Tool } from '../base.js';
import { chatCompletion } from '../../core/llm.js';

// 截断到这个字符数，避免超出上下文窗口
const MAX_CONTENT_CHARS = 6000;

class WebSummaryTool extends Tool {
  constructor() {
    super({
      name: 'web_summary',
      description:
        '抓取指定 URL 的网页内容并生成摘要。用户给一个网址，返回该网页的核心内容摘要（约200字）',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '网页URL，必须以 http:// 或 https:// 开头',
          },
          focus: {
            type: 'string',
            description: '可选：希望摘要重点关注的方向，如 "价格" "技术方案"',
          },
        },
        required: ['url'],
      },
    });
  }

  async _execute({ url, focus = '' }) {
    if (!/^https?:\/\//i.test(url)) {
      return '错误：URL 必须以 http:// 或 https:// 开头';
    }
    let html;
    try {
      const resp = await fetch(url, {
        // 通用 UA，避免部分站点拦截默认 UA
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalAgent/1.0)' },
        // 避免无响应挂死
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return `抓取失败（HTTP ${resp.status}）`;
      // 统一 utf-8 解码（部分中文站点需显式声明）
      html = await resp.text();
    } catch (err) {
      return `抓取异常: ${err.message}`;
    }

    const text = this._extractText(html);
    if (!text.trim()) return '未提取到有效正文';

    // 截断保护上下文
    const truncated = text.slice(0, MAX_CONTENT_CHARS);
    const focusHint = focus ? `请重点聚焦：${focus}。` : '';

    const summary = await this._summarize(truncated, url, focusHint);
    return summary;
  }

  // 从 HTML 提取纯文本：剥脚本/样式/HTML 标签后折叠空白
  _extractText(html) {
    return html
      // 移除 script/style/noscript 等非正文标签整体
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, '')
      // 将块级标签转为换行，便于阅读
      .replace(/<(\/)?(p|div|br|h[1-6]|li|tr|td|th)\b[^>]*>/gi, '\n')
      // 去除剩余 HTML 标签
      .replace(/<[^>]+>/g, '')
      // 解码常见 HTML 实体
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // 折叠空白
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  // 调 LLM 生成摘要
  async _summarize(content, url, focusHint) {
    const prompt = `请对以下网页内容生成不超过 200 字的中文摘要。${focusHint}

网页URL: ${url}

网页内容:
${content}`;

    try {
      // 工具内部辅助 LLM 调用，关闭流式以免污染 Agent 主流程日志
      const completion = await chatCompletion(
        [{ role: 'user', content: prompt }],
        null,
        { stream: false }
      );
      const result = (completion.choices[0].message.content || '').trim();
      return result ? `【${url} 摘要】\n${result}` : '摘要为空';
    } catch (err) {
      return `摘要生成失败: ${err.message}`;
    }
  }
}

export const webSummaryTool = new WebSummaryTool();
export default webSummaryTool;
