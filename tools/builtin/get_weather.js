/**
 * 内置工具：天气查询
 * 调用 wttr.in 免费 API（无需 key），返回指定城市的当前天气
 * 文档：https://github.com/chubin/wttr.in
 */
import { Tool } from '../base.js';

class GetWeatherTool extends Tool {
  constructor() {
    super({
      name: 'get_weather',
      description: '获取指定城市的当前天气情况，用户需提供城市名',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: '城市名，例如: 北京、上海、San Francisco',
          },
        },
        required: ['location'],
      },
    });
  }

  async _execute({ location }) {
    if (!location) return '错误：缺少城市名';
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=zh`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        return `${location}: 天气查询失败（HTTP ${resp.status}）`;
      }
      const data = await resp.json();
      const cur = data.current_condition?.[0];
      if (!cur) return `${location}: 未获取到天气数据`;
      const temp = cur.temp_C;
      // 优先取中文描述，兜底英文
      const desc = cur.lang_zh?.[0]?.value || cur.weatherDesc?.[0]?.value || '未知';
      const humidity = cur.humidity;
      const windSpeed = cur.windspeedKmph;
      return `${location}: ${desc}，温度${temp}°C，湿度${humidity}%，风速${windSpeed}km/h`;
    } catch (err) {
      return `${location}: 天气查询异常: ${err.message}`;
    }
  }
}

export const getWeatherTool = new GetWeatherTool();
export default getWeatherTool;
