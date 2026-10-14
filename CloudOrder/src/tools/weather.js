/**
 * 天气工具：查询指定城市的实时天气与多日预报。
 *
 * 数据源（均免密钥）：
 *   1. Open-Meteo（主）：https://api.open-meteo.com  + 中文地理编码 geocoding-api.open-meteo.com
 *   2. wttr.in（兜底）：https://wttr.in  仅用于实时天气
 *
 * 不需要 API Key，直接可用。
 */
const GEO_API = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const WWTR_CURRENT = (q) => `https://wttr.in/${encodeURIComponent(q)}?format=j1&lang=zh`;

/** WMO 天气代码 -> 中文描述 */
const WMO = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '米雪',
  80: '阵雨',
  81: '中阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '强阵雪',
  95: '雷阵雨',
  96: '雷阵雨伴小冰雹',
  99: '雷阵雨伴大冰雹'
};

const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

function weatherText(code) {
  return WMO[Number(code)] || `天气代码 ${code}`;
}

/** 判断是否为「会下」的天气代码 */
function isWet(code) {
  const c = Number(code);
  return (c >= 51 && c <= 67) || (c >= 71 && c <= 77) || (c >= 80 && c <= 86) || c >= 95;
}

function windDir(deg) {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return '';
  return DIRS[Math.round((Number(deg) % 360) / 45) % 8];
}

function round(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  return Number(Number(n).toFixed(digits));
}

async function httpJson(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CloudOrder/0.1 (+local)', Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 城市名 -> 坐标（Open-Meteo 地理编码，中文优先） */
async function geocode(name, timeoutMs) {
  const url = `${GEO_API}?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`;
  const json = await httpJson(url, timeoutMs);
  const hit = json?.results?.[0];
  if (!hit) throw new Error(`找不到城市「${name}」，请换用更常见的名称或直接给出经纬度`);
  const label = [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ');
  return {
    name: hit.name,
    label,
    latitude: hit.latitude,
    longitude: hit.longitude,
    country: hit.country || '',
    admin1: hit.admin1 || '',
    timezone: hit.timezone || ''
  };
}

/** 解析定位参数：优先经纬度，否则按城市名地理编码 */
async function resolveLocation(args, timeoutMs) {
  const hasCoords = args.latitude !== undefined && args.longitude !== undefined;
  if (hasCoords) {
    const lat = Number(args.latitude);
    const lon = Number(args.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error('latitude / longitude 必须是数字');
    }
    return { name: args.city ? String(args.city) : `${lat}, ${lon}`, label: args.city ? String(args.city) : `${lat}, ${lon}`, latitude: lat, longitude: lon, timezone: 'auto' };
  }
  const city = String(args.city || args.location || '').trim();
  if (!city) throw new Error('请提供 city（城市名），或同时提供 latitude 与 longitude');
  return await geocode(city, timeoutMs);
}

function formatCurrent(loc, cur, daily) {
  const lines = [];
  lines.push(`【实时天气】${loc.label}`);
  lines.push(
    `  ${weatherText(cur.weather_code)}　气温 ${round(cur.temperature_2m, 1)}°C` +
      (cur.apparent_temperature !== undefined ? `（体感 ${round(cur.apparent_temperature, 1)}°C）` : '')
  );
  const extra = [];
  if (cur.relative_humidity_2m !== undefined) extra.push(`湿度 ${round(cur.relative_humidity_2m)}%`);
  if (cur.cloud_cover !== undefined) extra.push(`云量 ${round(cur.cloud_cover)}%`);
  if (cur.precipitation !== undefined) extra.push(`当前降水 ${round(cur.precipitation, 1)}mm`);
  if (cur.wind_speed_10m !== undefined) {
    extra.push(
      `风 ${windDir(cur.wind_direction_10m)} ${round(cur.wind_speed_10m)}km/h` +
        (cur.wind_gusts_10m !== undefined ? `（阵风 ${round(cur.wind_gusts_10m)}km/h）` : '')
    );
  }
  if (extra.length) lines.push(`  ${extra.join('，')}`);
  if (daily?.temperature_2m_max?.[0] !== undefined) {
    lines.push(
      `  今日 ${round(daily.temperature_2m_min?.[0], 1)}°C ~ ${round(daily.temperature_2m_max[0], 1)}°C` +
        (daily.precipitation_probability_max?.[0] !== undefined
          ? `，降水概率 ${round(daily.precipitation_probability_max[0])}%`
          : '') +
        (daily.uv_index_max?.[0] !== undefined ? `，紫外线指数 ${round(daily.uv_index_max[0], 1)}` : '')
    );
  }
  if (cur.time) lines.push(`  观测时间：${cur.time}`);
  const hint = clothingHint(cur, daily);
  if (hint) lines.push(hint);
  return lines.join('\n');
}

/** 由天气数据派生一条穿衣提示，供穿搭场景直接参考 */
function clothingHint(cur, daily) {
  const t = Number(cur?.temperature_2m);
  const feels = Number(cur?.apparent_temperature ?? t);
  const bits = [];
  if (Number.isFinite(feels)) {
    let level;
    if (feels < 0) level = '严寒：厚羽绒/棉服 + 保暖内层 + 帽子围巾手套';
    else if (feels < 8) level = '寒冷：厚外套/羽绒 + 毛衣或抓绒内层';
    else if (feels < 15) level = '偏冷：夹克/风衣 + 长袖，早晚加件薄外套';
    else if (feels < 22) level = '温和：长袖或薄卫衣 + 长裤，可叠穿';
    else if (feels < 28) level = '温暖：短袖/薄衬衫 + 单层长裤或裙装';
    else level = '炎热：短袖薄款、透气面料，注意散热与补水';
    bits.push(level);
  }
  const wet =
    isWet(cur?.weather_code) ||
    Number(cur?.precipitation || 0) > 0 ||
    Number(daily?.precipitation_probability_max?.[0] ?? 0) >= 40;
  if (wet) bits.push('有降水可能：带伞、选防泼水鞋、避免长下摆' );
  const uv = Number(daily?.uv_index_max?.[0]);
  if (Number.isFinite(uv) && uv >= 6) bits.push('紫外线强：建议帽子/墨镜/防晒' );
  const wind = Number(cur?.wind_speed_10m);
  if (Number.isFinite(wind) && wind >= 30) bits.push('风较大：选防风机能外套，避免过轻薄的裙摆/围巾' );
  if (!bits.length) return '';
  return `  穿衣提示：${bits.join('；')}`;
}

function formatForecast(loc, daily, days) {
  const lines = [`【多日预报】${loc.label}`];
  const n = Math.min(days, daily?.time?.length || 0);
  for (let i = 0; i < n; i++) {
    const code = daily.weather_code?.[i];
    const mini = round(daily.temperature_2m_min?.[i], 1);
    const maxi = round(daily.temperature_2m_max?.[i], 1);
    const pop = daily.precipitation_probability_max?.[i];
    const wind = daily.wind_speed_10m_max?.[i];
    const uv = daily.uv_index_max?.[i];
    const bits = [`${mini}~${maxi}°C`, weatherText(code)];
    if (daily.apparent_temperature_min?.[i] !== undefined) {
      bits.push(`体感 ${round(daily.apparent_temperature_min[i], 1)}~${round(daily.apparent_temperature_max[i], 1)}°C`);
    }
    if (pop !== undefined && pop !== null) bits.push(`降水概率 ${round(pop)}%`);
    if (daily.precipitation_sum?.[i] !== undefined) bits.push(`降水量 ${round(daily.precipitation_sum[i], 1)}mm`);
    if (wind !== undefined && wind !== null) bits.push(`最大风速 ${round(wind)}km/h`);
    if (uv !== undefined && uv !== null) bits.push(`紫外线 ${round(uv, 1)}`);
    lines.push(`  ${daily.time[i]}：${bits.join('，')}`);
  }
  return lines.join('\n');
}

/** wttr.in 兜底：仅实时天气 */
async function wttrCurrent(query, timeoutMs) {
  const json = await httpJson(WWTR_CURRENT(query), timeoutMs);
  const c = json?.current_condition?.[0];
  if (!c) throw new Error('wttr.in 未返回实时天气');
  const area = json.nearest_area?.[0];
  const place = area
    ? [area.areaName?.[0]?.value, area.country?.[0]?.value].filter(Boolean).join(', ')
    : query;
  const parts = [`${c.temp_C}°C（体感 ${c.FeelsLikeC}°C）`, c.lang_zh?.[0]?.value || c.weatherDesc?.[0]?.value];
  if (c.humidity) parts.push(`湿度 ${c.humidity}%`);
  if (c.windspeedKmph) parts.push(`风速 ${c.windspeedKmph}km/h`);
  if (c.precipMM && Number(c.precipMM) > 0) parts.push(`降水 ${c.precipMM}mm`);
  return `【实时天气】(wttr.in 兜底) ${place}\n  ${parts.filter(Boolean).join('，')}`;
}

export function createWeatherTools(config) {
  const list = new Map();
  const timeoutMs = Math.min(config.requestTimeoutMs || 20000, 30000);

  list.set('get_weather', {
    name: 'get_weather',
    description:
      '查询某个城市（或经纬度）的当前天气与今日概况：温度、体感温度、天气现象、湿度、风、降水、今日温度区间、紫外线指数。' +
      '用于「今天冷不冷」「出门要不要带伞」「适合穿什么」等需要真实天气的场景。无需 API Key。',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名，如「北京」「上海」「杭州」，支持中文/英文' },
        latitude: { type: 'number', description: '纬度（与 longitude 一起使用时优先于 city）' },
        longitude: { type: 'number', description: '经度' }
      }
    },
    risk: 'low',
    safeByDefault: true,
    async run(args) {
      const loc = await resolveLocation(args, timeoutMs);
      try {
        const url =
          `${FORECAST_API}?latitude=${loc.latitude}&longitude=${loc.longitude}` +
          '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day' +
          '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max' +
          '&forecast_days=1&timezone=auto';
        const json = await httpJson(url, timeoutMs);
        return `${formatCurrent(loc, json.current, json.daily)}\n\n数据源：Open-Meteo`;
      } catch (err) {
        try {
          return `${await wttrCurrent(loc.name, timeoutMs)}\n\n(Open-Meteo 失败：${err.message}，已切换兜底数据源)`;
        } catch (err2) {
          throw new Error(`查询天气失败：${err.message}；兜底源也失败：${err2.message}`);
        }
      }
    }
  });

  list.set('get_weather_forecast', {
    name: 'get_weather_forecast',
    description:
      '查询某个城市未来几天的天气预报（默认 3 天，最多 16 天）：每天的最高/最低温、天气现象、降水概率、风速、紫外线。' +
      '用于「这周出差穿什么」「周末去郊游要不要带外套」等需要未来天气的场景。无需 API Key。',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名，如「北京」「成都」' },
        days: { type: 'integer', description: '预报天数，1-16，默认 3' },
        latitude: { type: 'number', description: '纬度（可选，需与 longitude 成对）' },
        longitude: { type: 'number', description: '经度（可选）' }
      }
    },
    risk: 'low',
    safeByDefault: true,
    async run(args) {
      const days = Math.max(1, Math.min(Number(args.days) || 3, 16));
      const loc = await resolveLocation(args, timeoutMs);
      const url =
        `${FORECAST_API}?latitude=${loc.latitude}&longitude=${loc.longitude}` +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset' +
        `&forecast_days=${days}&timezone=auto`;
      const json = await httpJson(url, timeoutMs);
      return `${formatForecast(loc, json.daily, days)}\n\n数据源：Open-Meteo`;
    }
  });

  list.set('geocode_city', {
    name: 'geocode_city',
    description: '把城市名解析为经纬度与时区，用于确认城市是否存在、或在提供经纬度前先核对位置。',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名' },
        count: { type: 'integer', description: '返回候选数量，默认 3' }
      },
      required: ['city']
    },
    risk: 'low',
    safeByDefault: true,
    async run(args) {
      const count = Math.max(1, Math.min(Number(args.count) || 3, 10));
      const url = `${GEO_API}?name=${encodeURIComponent(String(args.city))}&count=${count}&language=zh&format=json`;
      const json = await httpJson(url, timeoutMs);
      const results = json?.results || [];
      if (!results.length) return `未找到城市「${args.city}」。`;
      return results
        .map(
          (r) =>
            `- ${[r.name, r.admin1, r.country].filter(Boolean).join(', ')}` +
            `　纬度 ${r.latitude}，经度 ${r.longitude}，时区 ${r.timezone || '未知'}`
        )
        .join('\n');
    }
  });

  return list;
}

export { weatherText, isWet };
