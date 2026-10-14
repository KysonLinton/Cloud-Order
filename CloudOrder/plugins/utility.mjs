/**
 * 示例插件 1：时间 / 计算 / 编码
 * 纯本地计算，不联网，适合作为插件模板。
 */
export default {
  name: 'utility',
  description: '本地实用工具：当前时间、四则运算、Base64 编解码',
  systemPrompt: '你还能获取本机当前时间、做算术计算、进行 Base64 编解码。',

  tools: [
    {
      name: 'now_time',
      description: '获取本机当前日期时间（含时区）。',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'IANA 时区名，如 Asia/Shanghai，默认取本机时区' }
        }
      },
      risk: 'low',
      safeByDefault: true,
      async run(args) {
        const tz = args.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const now = new Date();
        const fmt = new Intl.DateTimeFormat('zh-CN', {
          timeZone: tz,
          dateStyle: 'full',
          timeStyle: 'long'
        });
        return `${fmt.format(now)}  (${tz})\nUnix 时间戳: ${Math.floor(now.getTime() / 1000)}`;
      }
    },
    {
      name: 'calculate',
      description: '计算一个数学表达式，支持 + - * / % ** 与括号。例如 "(12+8)*3/7"。',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: '数学表达式' } },
        required: ['expression']
      },
      risk: 'low',
      safeByDefault: true,
      async run(args) {
        const expr = String(args.expression);
        if (!/^[\d\s+\-*/%().eE]+$/.test(expr)) {
          throw new Error('表达式包含不允许的字符，仅支持数字与 + - * / % ( ) .');
        }
        // 用 Function 构造仅含数字与运算符的表达式，已由上面的白名单限制
        const result = Function(`"use strict"; return (${expr});`)();
        if (typeof result !== 'number' || !Number.isFinite(result)) {
          throw new Error('计算结果不是有效数字');
        }
        return `${expr} = ${result}`;
      }
    },
    {
      name: 'base64_encode',
      description: '把文本编码为 Base64；decode=true 时反向解码。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '待处理文本' },
          decode: { type: 'boolean', description: 'true 表示 Base64 解码' }
        },
        required: ['text']
      },
      risk: 'low',
      safeByDefault: true,
      async run(args) {
        const text = String(args.text);
        return args.decode
          ? Buffer.from(text, 'base64').toString('utf8')
          : Buffer.from(text, 'utf8').toString('base64');
      }
    }
  ]
};
