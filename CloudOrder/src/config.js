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
export const DATA_DIR = path.join(ROOT, '.cloudorder');
export const SESSION_DIR = path.join(DATA_DIR, 'sessions');
export const WARDROBE_DIR = path.join(DATA_DIR, 'wardrobe');
export const WARDROBE_IMAGE_DIR = path.join(WARDROBE_DIR, 'images');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const PROFILE_DIR = path.join(DATA_DIR, 'profile');
export const FEEDBACK_DIR = path.join(DATA_DIR, 'feedback');

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

  // 图片识别所用模型：留空表示沿用主模型（主模型必须支持图片输入，如 deepseek-chat / gpt-4o-mini / qwen-vl-*）
  visionModel: '',

  systemPrompt:
    '你是「穿搭管家」，一位懂场合、懂配色、懂身材比例的私人穿搭顾问。用户会和你聊自己的穿搭意愿：要去什么场合、天气如何、想要什么风格、有无预算或禁忌；你要结合用户的「衣柜」给出具体、可执行的建议。' +
    '工作方式：1) 只要用户想让你推荐/搭配具体衣物，就必须先用 wardrobe_list 查看「衣柜」里有哪些单品，并只能从衣柜中的单品里挑选搭配，绝不编造衣柜里没有的衣物；如果某套方案需要衣柜里没有的单品，要明确告诉用户「衣柜里缺 XX（可到衣柜入口添加）」，而不是假装它有。' +
    '2) 先弄清关键信息（场合、天气/温度、风格偏好、禁忌），信息不足时用一两句话确认，不要凭空假设；' +
    '3) 建议要落到具体单品、颜色、版型与搭配顺序，通常给出 2-3 套方案，说明各自适合的场合与取舍理由；' +
    '4) 需要天气时优先用 get_weather / get_weather_forecast 工具核实（可传城市名，无需密钥；未指定城市时可按本机 IP 自动定位，也可用 get_ip_location 先取坐标），需要潮流趋势或单品信息时可访问网页、搜索，不要编造；结合天气做穿搭决策时先加载 weather-dressing 技能；' +
    '5) 用户让你帮忙记录衣橱时，可用 wardrobe_add / wardrobe_update / wardrobe_remove 维护衣柜（修改、删除前先向用户确认）；用户发来衣物图片、或让你识别图片中衣服的材质/颜色/版型等参数时，用 analyze_image 工具（mode=clothing 会输出可直接录入衣柜的结构化字段），把识别结果先讲给用户确认，再决定是否调用 wardrobe_add 录入；' +
    '6) 推荐前先了解用户本人：用 profile_get 读取用户的「档案」（性别、年龄、体型、职业、常居城市、常去场合、风格与颜色偏好、禁忌、尺码等），让建议贴合他的身份与偏好；档案为空时，主动邀请用户花一分钟填写（网页版右上角「档案」入口），在用户填写之前不要假设他的性别、身材或偏好，也不要编造档案内容。用户当下在对话中的明确要求优先于档案；' +
    '7) 每次给出具体搭配建议后，用一两句话邀请用户评价（「这套满意吗？哪里想调整？」）；用户回应后用 feedback_add 记录满意度与改进建议（只记用户真实说的，不要编造），推荐前先用 feedback_list 读一次历史评价，命中「要避免」的做法不要重复、用户认可的做法优先沿用——这样你会越用越懂他；' +
    '8) 回答使用与用户相同的语言，简洁、准确、诚实；不确定时先查证而不是猜测。需要多步操作时先简短说明你的计划。'
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
  // 环境变量前缀：CLOUDORDER_* 为主，MINIAGENT_* 保留向后兼容；OPENAI_* 仅在未设置主前缀时兜底
  if (process.env.CLOUDORDER_BASE_URL || process.env.MINIAGENT_BASE_URL || process.env.OPENAI_BASE_URL) {
    env.baseUrl = process.env.CLOUDORDER_BASE_URL || process.env.MINIAGENT_BASE_URL || process.env.OPENAI_BASE_URL;
  }
  // 只认 CLOUDORDER_API_KEY / MINIAGENT_API_KEY；OPENAI_API_KEY 仅在配置文件里没写 key 时才兜底，
  // 否则会把 OpenAI 的 Key 发到别家服务（如 DeepSeek）导致 401。
  const genericKey = process.env.CLOUDORDER_API_KEY || process.env.MINIAGENT_API_KEY || process.env.OPENAI_API_KEY;
  if (process.env.CLOUDORDER_MODEL || process.env.MINIAGENT_MODEL) env.model = process.env.CLOUDORDER_MODEL || process.env.MINIAGENT_MODEL;
  if (process.env.CLOUDORDER_STREAM || process.env.MINIAGENT_STREAM) {
    env.stream = (process.env.CLOUDORDER_STREAM || process.env.MINIAGENT_STREAM) !== '0';
  }

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
  for (const dir of [DATA_DIR, SESSION_DIR, WARDROBE_DIR, WARDROBE_IMAGE_DIR, UPLOAD_DIR, PROFILE_DIR, FEEDBACK_DIR, SKILLS_DIR, PLUGINS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 判断 apiKey 是否可用于真实请求（本地模型常不需要 key） */
export function hasApiKey(config) {
  if (config.apiKey) return true;
  return /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(config.baseUrl || '');
}
