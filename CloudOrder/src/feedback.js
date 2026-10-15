/**
 * 用户反馈（Feedback）：把「推荐 → 评价 → 偏好」串成闭环的本地数据层。
 *
 * - 数据文件：.cloudorder/feedback/feedback.json（随 .cloudorder/ 一起被忽略，不入库）
 * - 零依赖；供内建工具（src/tools/feedback.js）、CLI / Web 界面、系统提示共用
 *
 * 飞轮：每次给出搭配推荐后，请用户评价「是否满意 + 改进建议」，
 * 用工具/界面记录下来；再把历史评价提炼成偏好，注入系统提示（也供 feedback_list 读取），
 * 从而让后续的穿搭建议越来越贴合用户。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

export const FEEDBACK_DIR = path.join(DATA_DIR, 'feedback');
export const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback.json');

/** 满意度选项（CLI / 网页 / 工具共用，保证三处一致） */
export const RATINGS = [
  { key: 'satisfied', label: '满意', icon: '👍', score: 3 },
  { key: 'neutral', label: '一般', icon: '🤔', score: 2 },
  { key: 'unsatisfied', label: '不满意', icon: '👎', score: 1 }
];

const RATING_KEYS = RATINGS.map((r) => r.key);

/** 常见说法 → 规范 key（容忍中文、表情、数字） */
const ALIASES = {
  satisfied: ['satisfied', '满意', '很满意', '喜欢', '不错', '可以', '挺好', '好', '棒', '👍', 'ok', 'yes', 'y', '3'],
  neutral: ['neutral', '一般', '还行', '凑合', '一般般', '就那样', '🤔', '2'],
  unsatisfied: ['unsatisfied', '不满意', '不喜欢', '不好', '不行', '差', '不行吧', '失望', '👎', 'no', 'n', '1']
};

const TEXT_LIMIT = 2000;

/** 把各种写法的满意度归一到 satisfied / neutral / unsatisfied；无法识别返回 '' */
export function normalizeRating(value) {
  if (value === undefined || value === null) return '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  if (RATING_KEYS.includes(raw)) return raw;
  for (const key of RATING_KEYS) {
    if (ALIASES[key].includes(raw)) return key;
  }
  // 中文长句里包含「不满意」这类词时也能识别
  for (const key of RATING_KEYS) {
    if (ALIASES[key].some((a) => a.length > 1 && raw.includes(a))) return key;
  }
  return '';
}

export function ratingMeta(key) {
  return RATINGS.find((r) => r.key === key) || { key: '', label: key || '未评级', icon: '•', score: 0 };
}

/** 把逗号/顿号/斜杠分隔的字符串或数组，统一成去重的字符串数组 */
function toArray(value) {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : String(value).split(/[,，、/|]+/);
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
}

function cut(text, n = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** MM-DD（跨年时带上年份） */
function shortDate(iso) {
  const s = String(iso || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return '未知时间';
  const today = new Date().toISOString().slice(0, 10);
  return s.slice(0, 4) === today.slice(0, 4) ? s.slice(5, 10) : s.slice(0, 10);
}

function newId() {
  return `f_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

function ensureDir() {
  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
}

function readDb() {
  try {
    const data = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
    return { items: Array.isArray(data?.items) ? data.items : [] };
  } catch (err) {
    if (err.code === 'ENOENT') return { items: [] };
    throw new Error(`用户反馈解析失败：${err.message}`);
  }
}

function writeDb(db) {
  ensureDir();
  const tmp = `${FEEDBACK_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, FEEDBACK_FILE);
}

/** 规范化一条反馈记录 */
function normalize(input = {}, base = {}) {
  const pick = (key, fallback) => (input[key] === undefined ? fallback : input[key]);
  return {
    rating: normalizeRating(pick('rating', base.rating)) || normalizeRating(base.rating) || '',
    outfit: cut(pick('outfit', base.outfit), 600),
    scenario: cut(pick('scenario', base.scenario), 120),
    suggestion: String(pick('suggestion', base.suggestion) ?? '').trim().slice(0, TEXT_LIMIT),
    liked: toArray(pick('liked', base.liked)),
    disliked: toArray(pick('disliked', base.disliked)),
    tags: toArray(pick('tags', base.tags)),
    source: String(pick('source', base.source) ?? 'chat').trim() || 'chat'
  };
}

/** 读取全部反馈（按时间倒序，最新在前；附带 label/icon 便于展示） */
export function listFeedback(filter = {}) {
  const rating = normalizeRating(filter.rating);
  const limit = Number(filter.limit) > 0 ? Number(filter.limit) : 0;
  let items = readDb().items;
  if (rating) items = items.filter((it) => it.rating === rating);
  items = [...items].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (limit) items = items.slice(0, limit);
  return items.map((it) => ({ ...it, ...ratingMeta(it.rating) }));
}

export function getFeedback(id) {
  const it = readDb().items.find((x) => x.id === id);
  return it ? { ...it, ...ratingMeta(it.rating) } : null;
}

/**
 * 新增一条评价。
 * 至少要有满意度或改进建议之一，否则视为无效。
 */
export function addFeedback(input = {}) {
  const rec = normalize(input);
  if (!rec.rating && !rec.suggestion && !rec.outfit) {
    throw new Error('至少要提供满意度（satisfied/neutral/unsatisfied）或改进建议（suggestion）');
  }
  if (!rec.rating) rec.rating = 'neutral';
  const record = { id: newId(), ...rec, createdAt: new Date().toISOString() };
  const db = readDb();
  db.items.push(record);
  // 只保留最近 500 条，避免文件无限增长
  if (db.items.length > 500) db.items = db.items.slice(-500);
  writeDb(db);
  return { ...record, ...ratingMeta(record.rating) };
}

/** 删除单条评价 */
export function removeFeedback(id) {
  const db = readDb();
  const idx = db.items.findIndex((x) => x.id === id);
  if (idx < 0) throw new Error(`未找到 id 为 ${id} 的评价记录`);
  const [removed] = db.items.splice(idx, 1);
  writeDb(db);
  return removed;
}

/** 清空全部评价（回到飞轮未启动状态） */
export function clearFeedback() {
  try {
    fs.unlinkSync(FEEDBACK_FILE);
  } catch {
    /* 不存在则忽略 */
  }
}

export function countFeedback() {
  return readDb().items.length;
}

/**
 * 统计 + 归纳。
 * 归纳是确定性的（不做二次模型调用）：直接引用用户原话，避免编造偏好。
 */
export function summarize(items = readDb().items) {
  const byRating = { satisfied: 0, neutral: 0, unsatisfied: 0 };
  const tags = new Map();
  for (const it of items) {
    if (byRating[it.rating] !== undefined) byRating[it.rating]++;
  }
  const desc = [...items].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const rated = byRating.satisfied + byRating.neutral + byRating.unsatisfied;
  const satisfiedRate = rated ? Math.round((byRating.satisfied / rated) * 100) : 0;

  const changes = [];
  for (const it of desc) {
    if (it.rating === 'satisfied') continue;
    const text = it.suggestion || it.outfit;
    if (!text) continue;
    changes.push({
      at: it.createdAt,
      rating: it.rating,
      text,
      scenario: it.scenario || '',
      outfit: it.outfit || ''
    });
    if (changes.length >= 5) break;
  }

  const likes = [];
  for (const it of desc) {
    if (it.rating !== 'satisfied') continue;
    const text = it.suggestion || it.outfit;
    if (!text) continue;
    likes.push({ at: it.createdAt, text, outfit: it.outfit || '' });
    if (likes.length >= 5) break;
  }

  // 用户在「不满意 / 一般」里标记过的雷点，按出现频次排序
  for (const it of items) {
    if (it.rating === 'satisfied') continue;
    for (const w of [...(it.disliked || []), ...(it.tags || [])]) {
      tags.set(w, (tags.get(w) || 0) + 1);
    }
  }
  const painPoints = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);

  return {
    total: items.length,
    byRating,
    rated,
    satisfiedRate,
    lastAt: desc[0]?.createdAt || '',
    changes,
    likes,
    painPoints
  };
}

/** 单条评价格式化成一行（工具输出用） */
export function formatFeedbackLine(it) {
  const meta = ratingMeta(it.rating);
  const bits = [`[${shortDate(it.createdAt)}]`, `${meta.icon} ${meta.label}`];
  if (it.scenario) bits.push(`场合:${it.scenario}`);
  if (it.outfit) bits.push(`本次:${cut(it.outfit, 60)}`);
  if (it.suggestion) bits.push(`建议:${cut(it.suggestion, 80)}`);
  if (it.tags?.length) bits.push(`标签:${it.tags.join('/')}`);
  return bits.join('　');
}

/** 多条评价格式化成多行文本（工具输出用） */
export function formatFeedbackText(items = listFeedback()) {
  if (!items.length) return '（还没有任何评价记录）';
  return items.map((it) => `- ${formatFeedbackLine(it)}`).join('\n');
}

/** 归纳结果格式化成多行文本（工具输出 / 界面展示用） */
export function formatSummaryText(items = readDb().items) {
  const s = summarize(items);
  if (!s.total) return '还没有评价记录，飞轮尚未启动。';
  const lines = [
    `评价共 ${s.total} 条：${RATINGS.map((r) => `${r.label} ${s.byRating[r.key]}`).join(' · ')}（满意率 ${s.satisfiedRate}%）`
  ];
  if (s.painPoints.length) lines.push(`用户标记过的雷点：${s.painPoints.join('、')}`);
  if (s.changes.length) {
    lines.push('用户希望改进 / 要避免的点：');
    for (const c of s.changes) lines.push(`  - [${shortDate(c.at)} ${ratingMeta(c.rating).label}] ${cut(c.text, 100)}`);
  }
  if (s.likes.length) {
    lines.push('用户认可的要点：');
    for (const l of s.likes) lines.push(`  - [${shortDate(l.at)}] ${cut(l.text, 100)}`);
  }
  return lines.join('\n');
}

/**
 * 生成注入系统提示的「用户反馈」段落；没有任何评价时返回空串（不占 token）。
 * 只放最近几条原始反馈 + 统计，让模型自己判断，避免过度加工。
 */
export function formatFeedbackForPrompt() {
  const items = readDb().items;
  if (!items.length) return '';
  const s = summarize(items);
  const lines = [
    `用户已对最近的推荐做过 ${s.total} 次评价：${RATINGS.map((r) => `${r.label} ${s.byRating[r.key]}`).join(' · ')}（满意率 ${s.satisfiedRate}%）。`
  ];
  if (s.painPoints.length) lines.push(`- 用户标记过的雷点：${s.painPoints.join('、')}`);
  if (s.changes.length) {
    lines.push('- 用户希望改进 / 应当避免的点：');
    for (const c of s.changes) lines.push(`  · [${shortDate(c.at)} ${ratingMeta(c.rating).label}] ${cut(c.text, 80)}`);
  }
  if (s.likes.length) {
    lines.push('- 用户认可的做法：');
    for (const l of s.likes) lines.push(`  · [${shortDate(l.at)}] ${cut(l.text, 80)}`);
  }
  lines.push(
    '- 请在推荐时把这些历史反馈当成偏好依据：命中「应当避免」的做法不要重复；「认可」的做法可以沿用、优先考虑。' +
      '当次对话中用户的明确要求仍然优先于历史反馈。'
  );
  return ['# 用户反馈（往次推荐评价）', ...lines].join('\n');
}
