/** 联网工具：网页抓取与搜索 */
import { truncate } from '../utils.js';

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function createWebTools(config) {
  const list = new Map();

  list.set('fetch_url', {
    name: 'fetch_url',
    description:
      '抓取一个网页或 HTTP 接口的内容，返回可读纯文本（HTML 会被转成文本）。适合查阅文档、获取接口数据。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整 URL，需包含 http(s)://' },
        raw: { type: 'boolean', description: '为 true 时返回原始响应体而不剥离 HTML' },
        max_chars: { type: 'integer', description: '最多返回字符数，默认 12000' }
      },
      required: ['url']
    },
    risk: 'low',
    safeByDefault: true,
    async run(args) {
      const url = String(args.url);
      if (!/^https?:\/\//i.test(url)) throw new Error('url 必须以 http:// 或 https:// 开头');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'MiniAgent/0.1 (+local)',
            Accept: 'text/html,application/json,text/plain,*/*'
          },
          redirect: 'follow'
        });
        const text = await res.text();
        const limit = Math.min(Number(args.max_chars) || 12000, config.outputLimit);
        const body =
          args.raw || /^\s*[[{]/.test(text) || /json/i.test(res.headers.get('content-type') || '')
            ? text
            : stripHtml(text);
        return `HTTP ${res.status} ${res.headers.get('content-type') || ''}\n\n${truncate(body, limit)}`;
      } catch (err) {
        throw new Error(`抓取失败: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
    }
  });

  list.set('web_search', {
    name: 'web_search',
    description:
      '通过搜索接口查询互联网信息，返回标题/链接/摘要列表。需要配置 searchApiKey（Tavily 或 Brave）才能使用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        count: { type: 'integer', description: '返回条数，默认 5' }
      },
      required: ['query']
    },
    risk: 'low',
    safeByDefault: true,
    async run(args) {
      const count = Math.min(Number(args.count) || 5, 10);
      const provider = config.searchProvider || (config.braveApiKey ? 'brave' : 'tavily');
      const key = provider === 'brave' ? config.braveApiKey : config.searchApiKey;
      if (!key) {
        throw new Error(
          '未配置搜索密钥。可在 config.json 中设置 "searchApiKey"（Tavily）或 "braveApiKey"（Brave Search）。'
        );
      }
      if (provider === 'brave') {
        const res = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=${count}`,
          { headers: { 'X-Subscription-Token': key, Accept: 'application/json' } }
        );
        if (!res.ok) throw new Error(`Brave 搜索失败: HTTP ${res.status}`);
        const json = await res.json();
        return (json.web?.results || [])
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${stripHtml(r.description || '')}`)
          .join('\n\n');
      }
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, query: args.query, max_results: count, search_depth: 'basic' })
      });
      if (!res.ok) throw new Error(`Tavily 搜索失败: HTTP ${res.status}`);
      const json = await res.json();
      return (json.results || [])
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content || ''}`)
        .join('\n\n');
    }
  });

  return list;
}
