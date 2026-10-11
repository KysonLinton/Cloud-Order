/** 通用工具函数 */
import path from 'node:path';

/** 目标路径是否位于 base 之内 */
export function insideWorkspace(base, target) {
  const rel = path.relative(base, target);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 把绝对路径显示为相对工作区的短路径 */
export function prettyPath(workspace, abs) {
  const rel = path.relative(workspace, abs);
  return rel && !rel.startsWith('..') ? rel.replace(/\\/g, '/') : abs;
}

/** 截断过长文本（保留头尾） */
export function truncate(text, limit = 20000) {
  const str = String(text ?? '');
  if (str.length <= limit) return str;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  return `${str.slice(0, head)}\n\n...[已截断 ${str.length - limit} 字符]...\n\n${str.slice(-tail)}`;
}

/** ANSI 颜色（Windows 10+ 终端与 VS Code 均支持） */
const useColor = process.env.NO_COLOR ? false : true;
const wrap = (code) => (s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : String(s));

export const color = {
  dim: wrap('2'),
  bold: wrap('1'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90')
};

export function nowStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
