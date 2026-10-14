/**
 * 衣柜（Wardrobe）：本地衣物数据库。
 *
 * - 数据文件：.cloudorder/wardrobe/wardrobe.json（随 .cloudorder/ 一起被忽略，不入库）
 * - 图片目录：.cloudorder/wardrobe/images/
 * - 零依赖；供内建工具（src/tools/wardrobe.js）与 Web 界面（src/ui/web.js）共用。
 *
 * 初始状态为空：没有任何预置单品，全部由用户手动录入。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

export const WARDROBE_DIR = path.join(DATA_DIR, 'wardrobe');
export const WARDROBE_FILE = path.join(WARDROBE_DIR, 'wardrobe.json');
export const WARDROBE_IMAGE_DIR = path.join(WARDROBE_DIR, 'images');

/** 建议的类别（自由文本也可，界面下拉会用到） */
export const CATEGORIES = [
  '上衣',
  '衬衫',
  '针织/毛衣',
  '卫衣',
  '外套',
  '西装',
  '大衣',
  '羽绒服',
  '裤装',
  '裙装',
  '连衣裙',
  '鞋',
  '包',
  '配饰',
  '帽饰',
  '围巾',
  '其他'
];

export const SEASONS = ['春', '夏', '秋', '冬'];
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export function ensureWardrobeDirs() {
  fs.mkdirSync(WARDROBE_IMAGE_DIR, { recursive: true });
}

/** 把逗号/顿号/斜杠分隔的字符串或数组，统一成去重的字符串数组 */
function toArray(value) {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : String(value).split(/[,，、/|]+/);
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
}

function newId() {
  return `w_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

function readDb() {
  try {
    const data = JSON.parse(fs.readFileSync(WARDROBE_FILE, 'utf8'));
    return { items: Array.isArray(data?.items) ? data.items : [] };
  } catch (err) {
    if (err.code === 'ENOENT') return { items: [] };
    throw new Error(`衣柜数据解析失败：${err.message}`);
  }
}

function writeDb(db) {
  ensureWardrobeDirs();
  const tmp = `${WARDROBE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, WARDROBE_FILE);
}

/** 规范化用户输入的单品字段 */
function normalize(input = {}, base = {}) {
  const pick = (key, fallback) => (input[key] === undefined ? fallback : input[key]);
  const name = String(pick('name', base.name) ?? '').trim();
  const item = {
    name,
    category: String(pick('category', base.category) ?? '').trim(),
    colors: toArray(pick('colors', base.colors)),
    material: String(pick('material', base.material) ?? '').trim(),
    style: toArray(pick('style', base.style)),
    seasons: toArray(pick('seasons', base.seasons)).filter((s) => SEASONS.includes(s) || s),
    fit: String(pick('fit', base.fit) ?? '').trim(),
    brand: String(pick('brand', base.brand) ?? '').trim(),
    notes: String(pick('notes', base.notes) ?? '').trim(),
    tags: toArray(pick('tags', base.tags)),
    image: input.image !== undefined ? String(input.image || '') : String(base.image || ''),
    size: String(pick('size', base.size) ?? '').trim()
  };
  return item;
}

/** 保存 base64 dataURL 图片，返回相对引用（images/xxx.ext） */
export function saveImage(dataUrl) {
  const m = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('图片格式无效：需要 data:image/...;base64,... 形式');
  const mime = m[1].toLowerCase();
  const ext = IMAGE_EXT[mime];
  if (!ext) throw new Error(`不支持的图片类型：${mime}（仅支持 png/jpeg/webp/gif）`);
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new Error('图片内容为空');
  if (buf.length > 8 * 1024 * 1024) throw new Error('图片过大（上限 8MB）');
  ensureWardrobeDirs();
  const file = `${newId()}.${ext}`;
  fs.writeFileSync(path.join(WARDROBE_IMAGE_DIR, file), buf);
  return `images/${file}`;
}

export function deleteImage(ref) {
  if (!ref || !String(ref).startsWith('images/')) return;
  const name = path.basename(String(ref));
  const abs = path.join(WARDROBE_IMAGE_DIR, name);
  try {
    fs.unlinkSync(abs);
  } catch {
    /* 已不存在，忽略 */
  }
}

/** 列出全部单品（原始数据，界面用） */
export function listAll() {
  return readDb().items;
}

/** 按条件筛选：category / color / season / style / keyword */
export function listItems(filter = {}) {
  const kw = String(filter.keyword || filter.q || '').trim().toLowerCase();
  const cat = String(filter.category || '').trim();
  const color = String(filter.color || '').trim();
  const season = String(filter.season || '').trim();
  const style = String(filter.style || '').trim();
  const has = (arr, needle) => (Array.isArray(arr) ? arr.some((v) => String(v).includes(needle)) : false);
  return readDb()
    .items.filter((it) => {
      if (cat && !String(it.category || '').includes(cat)) return false;
      if (color && !has(it.colors, color)) return false;
      if (season && !has(it.seasons, season)) return false;
      if (style && !has(it.style, style)) return false;
      if (kw) {
        const hay = [it.name, it.category, it.material, it.fit, it.brand, it.notes, ...(it.colors || []), ...(it.style || []), ...(it.tags || [])]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function getItem(id) {
  return readDb().items.find((it) => it.id === id) || null;
}

/** 新增单品 */
export function addItem(input = {}) {
  const item = normalize(input);
  if (!item.name) throw new Error('单品名称（name）不能为空');
  const now = new Date().toISOString();
  const record = { id: newId(), ...item, createdAt: now, updatedAt: now };
  const db = readDb();
  db.items.push(record);
  writeDb(db);
  return record;
}

/** 修改单品（name 为空时沿用原名） */
export function updateItem(id, patch = {}) {
  const db = readDb();
  const idx = db.items.findIndex((it) => it.id === id);
  if (idx < 0) throw new Error(`未找到 id 为 ${id} 的单品`);
  const base = db.items[idx];
  const merged = normalize(patch, base);
  if (!merged.name) merged.name = base.name;
  const updated = { ...base, ...merged, id: base.id, createdAt: base.createdAt, updatedAt: new Date().toISOString() };
  db.items[idx] = updated;
  writeDb(db);
  return updated;
}

/** 删除单品（连同其图片） */
export function removeItem(id) {
  const db = readDb();
  const idx = db.items.findIndex((it) => it.id === id);
  if (idx < 0) throw new Error(`未找到 id 为 ${id} 的单品`);
  const [removed] = db.items.splice(idx, 1);
  writeDb(db);
  deleteImage(removed.image);
  return removed;
}

export function stats() {
  const items = listAll();
  const byCategory = {};
  for (const it of items) {
    const c = it.category || '未分类';
    byCategory[c] = (byCategory[c] || 0) + 1;
  }
  return { total: items.length, byCategory };
}

/** 把单品格式化成给模型阅读的一段文字 */
export function formatItem(it, { detail = false } = {}) {
  const bits = [`- [${it.id}] ${it.name || '未命名单品'}`];
  if (it.category) bits.push(`类别:${it.category}`);
  if (it.colors?.length) bits.push(`颜色:${it.colors.join('/')}`);
  if (it.material) bits.push(`材质:${it.material}`);
  if (it.style?.length) bits.push(`风格:${it.style.join('/')}`);
  if (it.seasons?.length) bits.push(`季节:${it.seasons.join('/')}`);
  if (it.fit) bits.push(`版型:${it.fit}`);
  if (it.size) bits.push(`尺码:${it.size}`);
  if (it.brand) bits.push(`品牌:${it.brand}`);
  if (detail && it.tags?.length) bits.push(`标签:${it.tags.join('/')}`);
  if (detail && it.notes) bits.push(`备注:${it.notes}`);
  let line = bits.join('　');
  if (it.image) line += `\n  图片: ![${it.name || '单品'}](/api/wardrobe/image/${path.basename(it.image)})`;
  return line;
}
