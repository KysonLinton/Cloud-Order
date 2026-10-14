/**
 * 地理位置工具：按本机公网 IP 获取大致地理位置。
 *
 * 数据源（均免密钥）：
 *   1. ipwho.is（主，支持 lang=zh）
 *   2. ipinfo.io（兜底）
 *
 * 说明：基于公网出口 IP 定位，精度为「城市」级，不代表设备 GPS 位置；
 *       若本机走了代理/VPN，结果会是出口节点的位置。
 */
const IPWHOIS = 'https://ipwho.is/';
const IPINFO = 'https://ipinfo.io/json';
const REVERSE_GEOCODE = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

async function httpJson(url, timeoutMs = 15000) {
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

/**
 * 按公网 IP 定位。返回统一的定位对象，供 get_ip_location 与天气工具复用。
 * @returns {Promise<{ip:string, city:string, region:string, country:string, latitude:number, longitude:number, timezone:string, isp:string, label:string, source:string}>}
 */
export async function locateByIp(timeoutMs = 15000) {
  try {
    const j = await httpJson(`${IPWHOIS}?lang=zh`, timeoutMs);
    if (j && j.success !== false && j.latitude !== undefined) {
      const label = [j.city, j.region, j.country].filter(Boolean).join(', ') || j.ip;
      return {
        ip: j.ip || '未知',
        city: j.city || '',
        region: j.region || '',
        country: j.country || '',
        latitude: j.latitude,
        longitude: j.longitude,
        timezone: j.timezone?.id || '',
        isp: j.connection?.isp || j.connection?.org || '',
        label,
        source: 'ipwho.is'
      };
    }
    throw new Error('ipwho.is 返回无效数据');
  } catch (err) {
    // 兜底：ipinfo.io
    const j = await httpJson(IPINFO, timeoutMs);
    if (!j || !j.loc) throw new Error(`IP 定位失败：${err.message}`);
    const [lat, lon] = String(j.loc).split(',').map(Number);
    const label = [j.city, j.region, j.country].filter(Boolean).join(', ') || j.ip;
    return {
      ip: j.ip || '未知',
      city: j.city || '',
      region: j.region || '',
      country: j.country || '',
      latitude: lat,
      longitude: lon,
      timezone: j.timezone || '',
      isp: j.org || '',
      label,
      source: 'ipinfo.io'
    };
  }
}

/** 反向地理编码：经纬度 -> 省/市/区县（BigDataCloud，免密钥，zh-Hans） */
export async function reverseGeocode(lat, lon, timeoutMs = 15000) {
  const url =
    `${REVERSE_GEOCODE}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&localityLanguage=zh-Hans`;
  const j = await httpJson(url, timeoutMs);
  if (!j) return null;
  return {
    country: j.countryName || '',
    countryCode: j.countryCode || '',
    province: j.principalSubdivision || '',
    provinceCode: j.principalSubdivisionCode || '',
    city: j.city || '',
    locality: j.locality || '',
    postcode: j.postcode || ''
  };
}

/**
 * 汇总「位置 + 当前天气」，供 Web 首页模块使用。
 * 位置精确到市/区级，天气为当日实时 + 今日温区。
 * @param {{timeoutMs?:number}} [opts]
 */
export async function locateBrief(opts = {}) {
  const timeoutMs = Math.min(opts.timeoutMs || 15000, 30000);
  const loc = await locateByIp(timeoutMs);
  const [geo, weather] = await Promise.all([
    reverseGeocode(loc.latitude, loc.longitude, timeoutMs).catch(() => null),
    (async () => {
      const { fetchWeatherSummary } = await import('./weather.js');
      return await fetchWeatherSummary({
        latitude: loc.latitude,
        longitude: loc.longitude,
        city: loc.city,
        timeoutMs
      });
    })().catch((err) => ({ error: `天气获取失败：${err.message}` }))
  ]);

  // 拼一个尽量完整的「市 · 区」标签（去重，如「北京市, 北京市」压缩为「北京市」）
  const parts = [geo?.province, geo?.city, geo?.locality].filter(Boolean);
  const dedup = parts.filter((v, i) => parts.indexOf(v) === i);
  const shortLabel = dedup.length ? dedup.join(' · ') : loc.label;

  return {
    ip: loc.ip,
    latitude: loc.latitude,
    longitude: loc.longitude,
    timezone: loc.timezone,
    isp: loc.isp,
    source: loc.source,
    city: geo?.city || loc.city || '',
    district: geo?.locality || '',
    province: geo?.province || loc.region || '',
    country: geo?.country || loc.country || '',
    countryCode: geo?.countryCode || '',
    label: shortLabel,
    weather,
    updatedAt: new Date().toISOString()
  };
}

export function createLocationTools(config) {
  const list = new Map();
  const timeoutMs = Math.min(config.requestTimeoutMs || 15000, 30000);

  list.set('get_ip_location', {
    name: 'get_ip_location',
    description:
      '根据本机公网 IP 获取大致地理位置：城市、地区、国家、经纬度、时区、运营商。' +
      '用于「我在哪」「我这边天气怎么样」「不用我说城市，按我的位置来」等场景；' +
      '拿到的经纬度可直接传给 get_weather / get_weather_forecast。' +
      '注意：基于出口 IP，精度为城市级；若走了代理/VPN，结果会是出口节点所在位置。无法获得 GPS 级定位。',
    parameters: {
      type: 'object',
      properties: {
        // 预留：后续可支持指定 IP 查询
        ip: { type: 'string', description: '可选：查询指定 IP 的位置；留空则查询本机公网 IP' }
      }
    },
    risk: 'low',
    safeByDefault: true,
    async run(args) {
      const loc = await locateByIp(timeoutMs);
      const detailed = await reverseGeocode(loc.latitude, loc.longitude, timeoutMs).catch(() => null);
      void args;
      const region = detailed?.locality || detailed?.city || loc.city;
      const label = [loc.city, region, loc.country].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
      return [
        `【IP 定位】${label || loc.label}`,
        `  IP：${loc.ip}`,
        `  坐标：纬度 ${loc.latitude}，经度 ${loc.longitude}`,
        region ? `  城市 / 区县：${loc.city || detailed?.city || '-'} / ${region}` : '',
        loc.timezone ? `  时区：${loc.timezone}` : '',
        loc.isp ? `  运营商：${loc.isp}` : '',
        `  数据源：${loc.source}${detailed ? ' + BigDataCloud 反向地理编码' : ''}`,
        '  （基于公网出口 IP，精度为城市/区级；若使用代理/VPN，结果可能是出口节点位置）'
      ]
        .filter(Boolean)
        .join('\n');
    }
  });

  return list;
}
