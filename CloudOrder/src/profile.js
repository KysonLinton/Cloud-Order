/**
 * 用户档案（Profile）：本地存储用户的基本信息与穿搭偏好。
 *
 * - 数据文件：.cloudorder/profile/profile.json（随 .cloudorder/ 一起被忽略，不入库）
 * - 零依赖；供内建工具（src/tools/profile.js）、CLI / Web 界面、系统提示共用
 *
 * 档案是「穿搭管家」给出建议的重要依据：性别、年龄、身高体重、体型、职业、
 * 常居城市、常去场合、风格与颜色偏好、禁忌、预算、尺码等。
 * 初始为空——首次启动时由向导引导填写，之后可随时在网页版「我的档案」中修改。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const PROFILE_DIR = path.join(DATA_DIR, 'profile');
export const PROFILE_FILE = path.join(PROFILE_DIR, 'profile.json');

/**
 * 可编辑字段的元数据（CLI 向导与网页表单共用，保证两处字段一致）。
 * type: text | list（逗号分隔的数组）| textarea
 */
export const FORM_FIELDS = [
  { key: 'gender', label: '性别', type: 'text', placeholder: '男 / 女 / 不便透露' },
  { key: 'age', label: '年龄', type: 'text', placeholder: '如 28' },
  { key: 'height', label: '身高（cm）', type: 'text', placeholder: '如 178' },
  { key: 'weight', label: '体重（kg）', type: 'text', placeholder: '如 70' },
  { key: 'bodyType', label: '体型', type: 'text', placeholder: '偏瘦 / 标准 / 偏壮 / 高个 / 娇小' },
  { key: 'occupation', label: '职业 / 身份', type: 'text', placeholder: '如 大学生 / 产品经理' },
  { key: 'city', label: '常居城市', type: 'text', placeholder: '如 北京（用于按天气给建议）' },
  { key: 'scenarios', label: '常去场合', type: 'list', placeholder: '逗号分隔，如 通勤, 约会, 健身' },
  { key: 'styles', label: '风格偏好', type: 'list', placeholder: '逗号分隔，如 简约, 通勤, 复古' },
  { key: 'favColors', label: '常穿的颜色', type: 'list', placeholder: '逗号分隔，如 黑, 白, 藏青' },
  { key: 'avoidColors', label: '不喜欢的颜色', type: 'list', placeholder: '逗号分隔，可留空' },
  { key: 'topSize', label: '上衣尺码', type: 'text', placeholder: '如 M / 170/92A' },
  { key: 'bottomSize', label: '裤装尺码', type: 'text', placeholder: '如 30 / L' },
  { key: 'shoeSize', label: '鞋码', type: 'text', placeholder: '如 42 / 39' },
  { key: 'budget', label: '预算档位', type: 'text', placeholder: '平价 / 中等 / 不限' },
  { key: 'avoid', label: '其他禁忌 / 不喜欢', type: 'textarea', placeholder: '如 不穿紧身、不露腿、对羊毛过敏' },
  { key: 'notes', label: '补充说明', type: 'textarea', placeholder: '其他想让我知道的（如身高偏高、肩宽、需要久站）' }
];

const LIST_KEYS = FORM_FIELDS.filter((f) => f.type === 'list').map((f) => f.key);
const TEXT_KEYS = FORM_FIELDS.filter((f) => f.type !== 'list').map((f) => f.key);

/** 把逗号/顿号/斜杠分隔的字符串或数组，统一成去重的字符串数组 */
function toArray(value) {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : String(value).split(/[,，、/|]+/);
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
}

/** 规范化任意输入为完整档案对象（缺失字段补默认值） */
function normalize(input = {}) {
  const out = {
    configured: Boolean(input.configured),
    updatedAt: String(input.updatedAt || '')
  };
  for (const key of TEXT_KEYS) out[key] = String(input[key] ?? '').trim();
  for (const key of LIST_KEYS) out[key] = toArray(input[key]);
  return out;
}

function hasAnyValue(profile) {
  return TEXT_KEYS.some((k) => profile[k]) || LIST_KEYS.some((k) => profile[k].length);
}

function ensureDir() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

/** 读取档案（文件不存在时返回空的默认档案） */
export function readProfile() {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`用户档案解析失败：${err.message}`);
  }
  return normalize(data);
}

/** 写入档案（原子写，避免半截文件） */
function writeProfile(profile) {
  ensureDir();
  const tmp = `${PROFILE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(profile, null, 2), 'utf8');
  fs.renameSync(tmp, PROFILE_FILE);
}

/**
 * 合并保存档案（只覆盖传入的字段，其余保持不变）。
 * 只要有任何字段非空，就把档案标记为「已填写」。
 * @returns {object} 保存后的完整档案
 */
export function saveProfile(patch = {}) {
  const base = readProfile();
  const merged = normalize({ ...base, ...patch });
  merged.configured = hasAnyValue(merged) || base.configured;
  merged.updatedAt = new Date().toISOString();
  writeProfile(merged);
  return merged;
}

/** 删除档案文件（回到未填写状态） */
export function clearProfile() {
  try {
    fs.unlinkSync(PROFILE_FILE);
  } catch {
    /* 不存在则忽略 */
  }
}

/** 是否已填写档案 */
export function isProfileConfigured() {
  return readProfile().configured === true;
}

/** 把档案格式化成多行文本（不含标题），供工具输出与提示注入共用 */
export function formatProfileText(profile = readProfile()) {
  const s = (k) => profile[k];
  const lines = [];
  const basic = [
    s('gender') && `性别 ${s('gender')}`,
    s('age') && `年龄 ${s('age')}`,
    s('height') && `身高 ${s('height')}`,
    s('weight') && `体重 ${s('weight')}`,
    s('bodyType') && `体型 ${s('bodyType')}`
  ].filter(Boolean);
  if (basic.length) lines.push(`- 基本信息：${basic.join('　')}`);
  if (s('occupation')) lines.push(`- 职业/身份：${s('occupation')}`);
  if (s('city')) lines.push(`- 常居城市：${s('city')}`);
  if (profile.scenarios.length) lines.push(`- 常去场合：${profile.scenarios.join('、')}`);
  if (profile.styles.length) lines.push(`- 风格偏好：${profile.styles.join('、')}`);
  if (profile.favColors.length) lines.push(`- 常穿颜色：${profile.favColors.join('、')}`);
  if (profile.avoidColors.length) lines.push(`- 不喜欢的颜色：${profile.avoidColors.join('、')}`);
  if (s('avoid')) lines.push(`- 禁忌与不喜欢：${s('avoid')}`);
  if (s('budget')) lines.push(`- 预算档位：${s('budget')}`);
  const sizes = [
    s('topSize') && `上衣 ${s('topSize')}`,
    s('bottomSize') && `裤装 ${s('bottomSize')}`,
    s('shoeSize') && `鞋 ${s('shoeSize')}`
  ].filter(Boolean);
  if (sizes.length) lines.push(`- 尺码：${sizes.join(' / ')}`);
  if (s('notes')) lines.push(`- 补充：${s('notes')}`);
  return lines.join('\n');
}

/** 生成注入系统提示的「用户档案」段落；未填写时返回空串 */
export function formatProfileForPrompt() {
  const profile = readProfile();
  if (!profile.configured) return '';
  const body = formatProfileText(profile);
  if (!body) return '';
  return [
    '# 用户档案（Profile）',
    '用户主动填写的个人资料与穿搭偏好，是推荐搭配的重要依据（当次对话中的具体要求优先于档案）：',
    body
  ].join('\n');
}
