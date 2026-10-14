/**
 * 配置加载：默认值 <- config.json <- 环境变量 <- 命令行覆盖
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SKILLS_DIR = path.join(ROOT, 'skills');
export const PLUGINS_DIR = path.join(ROOT, 'plugins');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = path.join(ROOT, '.mini-agent');
export const SESSION_DIR = path.join(DATA_DIR, 'sessions');

export const DEFAULTS = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.6,
  maxTokens: undefined,
  stream: true,
  maxSteps: 12,
  requestTimeoutMs: 180000,

  workspace: '.',
  allowOutsideWorkspace: false,
  commandTimeoutMs: 60000,
  outputLimit: 20000,

  autoApprove: false,
  autoApproveTools: [],

  enabledSkills: '*',
  enabledPlugins: '*',

  systemPrompt:
    '你是「穿搭管家」，一位懂场合、懂配色、懂身材比例的私人穿搭顾问。用户会和你聊自己的穿搭意愿：要去什么场合、天气如何、想要什么风格、衣柜里有哪些单品、有无预算或禁忌；你要在此基础上给出具体、可执行的建议。' +
    '工作方式：1) 先弄清关键信息（场合、天气/温度、风格偏好、可用单品、禁忌），信息不足时用一两句话确认，不要凭空假设；' +
    '2) 建议落到具体单品、颜色、版型与搭配顺序，通常给出 2-3 套方案，说明各自适合的场合与取舍理由；' +
    '3) 需要天气、潮流趋势或单品信息时，调用工具（访问网页、搜索）核实，不要编造；' +
    '4) 回答使用与用户相同的语言，简洁、准确、诚实；不确定时先查证而不是猜测。需要多步操作时先简短说明你的计划。'
};

/** 展开字符串中的 ${ENV_VAR} / $ENV_VAR 形式的环境变量引用 */
function expandEnv(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b) => {
    const key = a || b;
    return process.env[key] ?? '';
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`配置文件解析失败 ${file}: ${err.message}`);
  }
}

/** 剔除示例配置里的 "//" 注释字段 */
function stripComments(obj) {
  if (Array.isArray(obj)) return obj.map(stripComments);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('//')) continue;
      out[k] = stripComments(v);
    }
    return out;
  }
  return obj;
}

export function loadConfig({ configPath, overrides = {} } = {}) {
  const env = {};
  if (process.env.MINIAGENT_BASE_URL || process.env.OPENAI_BASE_URL) {
    env.baseUrl = process.env.MINIAGENT_BASE_URL || process.env.OPENAI_BASE_URL;
  }
  // 只认 MINIAGENT_API_KEY；OPENAI_API_KEY 仅在配置里没写 key 时才兜底，
  // 否则会把 OpenAI 的 Key 发到别家服务（如 DeepSeek）导致 401。
  const genericKey = process.env.MINIAGENT_API_KEY || process.env.OPENAI_API_KEY;
  if (process.env.MINIAGENT_MODEL) env.model = process.env.MINIAGENT_MODEL;
  if (process.env.MINIAGENT_STREAM) env.stream = process.env.MINIAGENT_STREAM !== '0';

  const candidates = [configPath, path.join(ROOT, 'config.json')].filter(Boolean);
  let file = {};
  let usedPath = null;
  for (const p of candidates) {
    const abs = path.resolve(p);
    const data = readJson(abs);
    if (data) {
      file = stripComments(data);
      usedPath = abs;
      break;
    }
  }

  const merged = { ...DEFAULTS, ...file, ...env, ...overrides };
  // key 优先级：命令行 > 配置文件 > 环境变量兜底
  if (!merged.apiKey) merged.apiKey = genericKey || '';
  merged.apiKey = expandEnv(merged.apiKey || '');
  merged.baseUrl = (merged.baseUrl || '').replace(/\/+$/, '');
  merged.workspace = path.resolve(ROOT, expandEnv(merged.workspace || '.'));
  merged.configPath = usedPath;
  merged.configFileExists = Boolean(usedPath);
  return merged;
}

export function saveConfig(config, file = path.join(ROOT, 'config.json')) {
  const { configPath, configFileExists, ...rest } = config;
  void configPath;
  void configFileExists;
  fs.writeFileSync(file, JSON.stringify(rest, null, 2), 'utf8');
  return file;
}

export function ensureDirs() {
  for (const dir of [DATA_DIR, SESSION_DIR, SKILLS_DIR, PLUGINS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 判断 apiKey 是否可用于真实请求（本地模型常不需要 key） */
export function hasApiKey(config) {
  if (config.apiKey) return true;
  return /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(config.baseUrl || '');
}
