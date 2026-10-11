/**
 * 内建工具集合。每个工具的实现契约：
 *   name          工具名（模型可见）
 *   description   给模型看的说明，越精确越好
 *   parameters    JSON Schema
 *   run(args, ctx) 执行，返回字符串（或可被 JSON.stringify 的值）
 *   risk          'low' | 'medium' | 'high'
 *   requiresWorkspace  是否需要校验路径在工作区内
 *   safeByDefault 低风险时是否免确认
 *   targetPath(args)   权限检查用的目标路径
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { truncate } from '../utils.js';

/** 只读类工具 */
export function createReadTools(config) {
  const resolve = (p) => path.resolve(config.workspace, p);
  const list = new Map();

  list.set('read_file', {
    name: 'read_file',
    description:
      '读取文本文件内容。返回带行号的内容，便于后续精确编辑。支持 offset/limit 分页读取大文件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于工作区，或绝对路径）' },
        offset: { type: 'integer', description: '起始行号，从 1 开始' },
        limit: { type: 'integer', description: '最多读取行数，默认 800' }
      },
      required: ['path']
    },
    risk: 'low',
    safeByDefault: true,
    async run(args) {
      const abs = resolve(String(args.path));
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) throw new Error(`文件不存在: ${args.path}`);
      if (stat.isDirectory()) throw new Error(`${args.path} 是目录，请用 list_dir`);
      if (stat.size > 5 * 1024 * 1024) throw new Error('文件过大（>5MB），请分块读取');
      const raw = await fs.readFile(abs, 'utf8');
      const lines = raw.split(/\r?\n/);
      const offset = Math.max(1, Number(args.offset) || 1);
      const limit = Math.min(2000, Number(args.limit) || 800);
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      const width = String(offset + slice.length - 1).length;
      const numbered = slice
        .map((l, i) => `${String(offset + i).padStart(width, ' ')}| ${l}`)
        .join('\n');
      const more =
        offset - 1 + slice.length < lines.length
          ? `\n\n[文件共 ${lines.length} 行，已显示到第 ${offset - 1 + slice.length} 行]`
          : '';
      return truncate(numbered + more, config.outputLimit);
    }
  });

  list.set('list_dir', {
    name: 'list_dir',
    description: '列出目录下的文件与子目录（含大小），用于了解项目结构。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径，默认工作区根目录' },
        recursive: { type: 'boolean', description: '是否递归列出（最多 3 层）' }
      }
    },
    risk: 'low',
    safeByDefault: true,
    async run(args) {
      const root = resolve(String(args.path || '.'));
      const maxDepth = args.recursive ? 3 : 1;
      const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv']);
      const out = [];
      async function walk(dir, depth, prefix) {
        if (depth > maxDepth) return;
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (err) {
          out.push(`${prefix}[无法读取: ${err.message}]`);
          return;
        }
        entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        for (const e of entries) {
          if (skip.has(e.name)) {
            out.push(`${prefix}${e.name}/  (已跳过)`);
            continue;
          }
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            out.push(`${prefix}${e.name}/`);
            if (args.recursive) await walk(full, depth + 1, prefix + '  ');
          } else {
            const st = await fs.stat(full).catch(() => null);
            out.push(`${prefix}${e.name}  (${st ? formatSize(st.size) : '?'})`);
          }
        }
      }
      await walk(root, 1, '');
      return truncate(out.join('\n') || '(空目录)', config.outputLimit);
    }
  });

  list.set('search_files', {
    name: 'search_files',
    description: '在工作区内按文件名或文本内容搜索，返回命中行。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要查找的文本或正则' },
        path: { type: 'string', description: '搜索起点目录，默认工作区' },
        mode: { type: 'string', enum: ['content', 'filename'], description: '搜索模式，默认 content' },
        regex: { type: 'boolean', description: 'query 是否按正则解释' },
        include: { type: 'string', description: '文件名过滤，如 *.js' }
      },
      required: ['query']
    },
    risk: 'low',
    safeByDefault: true,
    async run(args) {
      const root = resolve(String(args.path || '.'));
      const mode = args.mode || 'content';
      const rx = args.regex ? new RegExp(String(args.query), 'i') : null;
      const needle = String(args.query).toLowerCase();
      const includeRx = args.include ? globToRx(String(args.include)) : null;
      const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', '.mini-agent']);
      const hits = [];
      const MAX_HITS = 200;

      async function walk(dir, depth) {
        if (hits.length >= MAX_HITS || depth > 6) return;
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (hits.length >= MAX_HITS) return;
          if (skip.has(e.name)) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            await walk(full, depth + 1);
            continue;
          }
          const rel = path.relative(config.workspace, full).replace(/\\/g, '/');
          if (includeRx && !includeRx.test(e.name)) continue;
          if (mode === 'filename') {
            if (matches(e.name, needle, rx)) hits.push(rel);
            continue;
          }
          const st = await fs.stat(full).catch(() => null);
          if (!st || st.size > 1024 * 1024) continue;
          const buf = await fs.readFile(full).catch(() => null);
          if (!buf) continue;
          if (buf.includes(0)) continue; // 二进制
          const lines = buf.toString('utf8').split(/\r?\n/);
          lines.forEach((line, i) => {
            if (hits.length >= MAX_HITS) return;
            if (matches(line, needle, rx)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 240)}`);
          });
        }
      }
      await walk(root, 1);
      if (!hits.length) return '未找到匹配项。';
      return truncate(hits.join('\n') + (hits.length >= MAX_HITS ? '\n...(结果已达上限)' : ''), config.outputLimit);
    }
  });

  return list;
}

function matches(text, needle, rx) {
  return rx ? rx.test(text) : text.toLowerCase().includes(needle);
}

function globToRx(glob) {
  const p = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${p}$`, 'i');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 写入类工具 */
export function createWriteTools(config) {
  const resolve = (p) => path.resolve(config.workspace, p);
  const list = new Map();

  list.set('write_file', {
    name: 'write_file',
    description: '创建或整体覆盖一个文本文件。父目录会自动创建。已有文件请优先用 edit_file 做局部修改。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '完整文件内容' }
      },
      required: ['path', 'content']
    },
    risk: 'medium',
    requiresWorkspace: true,
    targetPath: (a) => a.path,
    async run(args) {
      const abs = resolve(String(args.path));
      await fs.mkdir(path.dirname(abs), { recursive: true });
      const existed = await fs.stat(abs).then(() => true).catch(() => false);
      await fs.writeFile(abs, String(args.content ?? ''), 'utf8');
      return `${existed ? '已覆盖' : '已创建'} ${args.path}（${String(args.content ?? '').length} 字符）`;
    }
  });

  list.set('edit_file', {
    name: 'edit_file',
    description:
      '对文件做精确的查找替换。old_text 必须与文件内容完全一致（含缩进），且默认为唯一匹配。可一次提交多个 edits。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        edits: {
          type: 'array',
          description: '替换列表',
          items: {
            type: 'object',
            properties: {
              old_text: { type: 'string', description: '被替换的原文（需唯一）' },
              new_text: { type: 'string', description: '替换后的文本' }
            },
            required: ['old_text', 'new_text']
          }
        },
        replace_all: { type: 'boolean', description: '为 true 时替换所有匹配' }
      },
      required: ['path', 'edits']
    },
    risk: 'medium',
    requiresWorkspace: true,
    targetPath: (a) => a.path,
    async run(args) {
      const abs = resolve(String(args.path));
      let text = await fs.readFile(abs, 'utf8').catch(() => null);
      if (text === null) throw new Error(`文件不存在: ${args.path}`);
      const edits = Array.isArray(args.edits) ? args.edits : [];
      if (!edits.length) throw new Error('edits 不能为空');
      const applied = [];
      for (const edit of edits) {
        const oldText = String(edit.old_text ?? '');
        if (!oldText) throw new Error('old_text 不能为空');
        const count = text.split(oldText).length - 1;
        if (count === 0) {
          throw new Error(`未找到要替换的内容（第 ${applied.length + 1} 处）:\n${oldText.slice(0, 300)}`);
        }
        if (count > 1 && !args.replace_all) {
          throw new Error(
            `old_text 匹配到 ${count} 处，不唯一（第 ${applied.length + 1} 处）。请给出更多上下文，或设置 replace_all: true。`
          );
        }
        text = args.replace_all ? text.split(oldText).join(edit.new_text) : text.replace(oldText, edit.new_text);
        applied.push(oldText.slice(0, 60));
      }
      await fs.writeFile(abs, text, 'utf8');
      return `已完成 ${applied.length} 处修改：${args.path}`;
    }
  });

  return list;
}

/** 执行类工具 */
export function createExecTools(config) {
  const list = new Map();

  list.set('run_command', {
    name: 'run_command',
    description:
      '在当前系统上执行一条 shell 命令并返回输出。当前平台：Windows（PowerShell 语法）。' +
      '用于运行脚本、测试、构建、安装依赖、调用 CLI 等。不要用它做交互式操作。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        cwd: { type: 'string', description: '工作目录，默认为工作区根目录' },
        timeout_ms: { type: 'integer', description: '超时毫秒数' }
      },
      required: ['command']
    },
    risk: 'high',
    requiresWorkspace: true,
    targetPath: (a) => a.cwd,
    async run(args, ctx) {
      const isWin = process.platform === 'win32';
      const shellBin = isWin ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWin ? ['-NoProfile', '-NonInteractive', '-Command', String(args.command)] : ['-lc', String(args.command)];
      const cwd = path.resolve(config.workspace, args.cwd || '.');
      const timeoutMs = Math.min(Number(args.timeout_ms) || config.commandTimeoutMs, 600000);

      return await new Promise((resolve) => {
        const started = Date.now();
        const child = spawn(shellBin, shellArgs, {
          cwd,
          windowsHide: true,
          env: { ...process.env, NO_COLOR: '1' }
        });
        let out = '';
        let err = '';
        let done = false;
        const finish = (tag) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const ms = Date.now() - started;
          const body = [out && `--- stdout ---\n${out}`, err && `--- stderr ---\n${err}`]
            .filter(Boolean)
            .join('\n');
          resolve(
            truncate(
              `${body || '(无输出)'}\n--- 退出码 ${tag}，耗时 ${ms}ms ---`,
              config.outputLimit
            )
          );
        };
        const timer = setTimeout(() => {
          child.kill();
          err += `\n[命令超时 ${timeoutMs}ms，已终止]`;
          finish('timeout');
        }, timeoutMs);

        child.stdout.on('data', (d) => {
          out += d.toString();
        });
        child.stderr.on('data', (d) => {
          err += d.toString();
        });
        child.on('error', (e) => {
          err += String(e.message);
          finish('-1');
        });
        child.on('close', (code) => finish(String(code)));
        ctx?.signal?.addEventListener('abort', () => {
          child.kill();
          finish('aborted');
        });
      });
    }
  });

  return list;
}
