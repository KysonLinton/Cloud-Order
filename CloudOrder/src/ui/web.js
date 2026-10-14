/**
 * 零依赖 Web 界面：静态页面 + SSE 流式对话 + 工具审批。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PUBLIC_DIR, WARDROBE_IMAGE_DIR } from '../config.js';
import { Agent } from '../agent.js';
import { color } from '../utils.js';
import { locateBrief } from '../tools/location.js';
import * as wardrobe from '../wardrobe.js';

export async function startWebServer({ config, registry }) {
  const port = Number(config.port || 8787);
  const agent = new Agent({ config, registry, ui: {} });
  agent.reset();

  /** 待审批请求：id -> resolve */
  const pendingApprovals = new Map();
  /** 每个请求的 SSE 响应对象 */
  let activeSse = null;

  function send(type, payload = {}) {
    if (!activeSse || activeSse.writableEnded) return;
    activeSse.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  }

  // 把审批与流式事件桥接到 SSE
  agent.ui = {
    onAssistantDelta: (c) => send('delta', { text: c }),
    onReasoning: (c) => send('reasoning', { text: c }),
    onToolStart: ({ name, args }) => send('tool_start', { name, args }),
    onToolEnd: ({ name, ok, output }) => send('tool_end', { name, ok, output }),
    onNotice: ({ level, text }) => send('notice', { level, text }),
    onError: (err) => send('error', { message: err.message }),
    requestApproval: async ({ tool, args, risk, notes }) => {
      const id = crypto.randomUUID();
      send('approval', { id, tool: tool.name, args, risk, notes });
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingApprovals.delete(id);
          resolve(false);
        }, 5 * 60 * 1000);
        pendingApprovals.set(id, (v) => {
          clearTimeout(timer);
          pendingApprovals.delete(id);
          resolve(v);
        });
      });
    }
  };

  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8'
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return serveFile(path.join(PUBLIC_DIR, 'index.html'), res, mime);
    }

    if (req.method === 'GET' && url.pathname === '/api/info') {
      return json(res, {
        model: config.model,
        baseUrl: config.baseUrl,
        workspace: config.workspace,
        autoApprove: config.autoApprove,
        tools: [...registry.tools.values()].map((t) => ({ name: t.name, description: t.description, risk: t.risk, plugin: t.plugin })),
        skills: [...registry.skills.values()].map((s) => ({ name: s.name, description: s.description })),
        plugins: registry.plugins.map((p) => ({ name: p.name, description: p.description, tools: p.tools }))
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/location-weather') {
      try {
        const data = await locateBrief({ timeoutMs: Math.min(config.requestTimeoutMs || 15000, 20000) });
        return json(res, data);
      } catch (err) {
        return json(res, { error: `定位/天气获取失败：${err.message}` }, 502);
      }
    }

    // ---- 衣柜（Wardrobe）----
    if (url.pathname === '/api/wardrobe' || url.pathname.startsWith('/api/wardrobe/')) {
      return handleWardrobe(req, res, url);
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        return json(res, { error: 'body 必须是 JSON' }, 400);
      }
      const text = String(payload.text || '').trim();
      if (!text) return json(res, { error: 'text 不能为空' }, 400);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      activeSse = res;

      const keepAlive = setInterval(() => send('ping'), 15000);

      try {
        agent.addUser(text);
        const started = Date.now();
        const result = await agent.run();
        send('done', { text: result.text || '', steps: result.steps, ms: Date.now() - started, stopped: result.stopped });
      } catch (err) {
        send('error', { message: err.message });
      } finally {
        clearInterval(keepAlive);
        activeSse = null;
        res.end();
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/approve') {
      const body = await readBody(req);
      const { id, approved } = JSON.parse(body || '{}');
      const resolve = pendingApprovals.get(id);
      if (resolve) {
        resolve(Boolean(approved));
        send('notice', { level: 'info', text: approved ? '已批准' : '已拒绝' });
      }
      return json(res, { ok: Boolean(resolve) });
    }

    if (req.method === 'POST' && url.pathname === '/api/stop') {
      agent.stop();
      return json(res, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      agent.reset();
      return json(res, { ok: true });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const file = path.join(PUBLIC_DIR, url.pathname.slice(1));
      if (!file.startsWith(PUBLIC_DIR)) return json(res, { error: 'forbidden' }, 403);
      return serveFile(file, res, mime);
    }

    json(res, { error: 'not found' }, 404);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const addr = `http://127.0.0.1:${port}`;
  console.log('');
  console.log(color.bold(color.magenta('  穿搭管家 Web')) + color.dim(` 已启动: ${addr}`));
  console.log(color.dim(`  模型 ${config.model} · 工作区 ${config.workspace}`));
  console.log(color.dim(`  工具 ${registry.tools.size} · 技能 ${registry.skills.size} · 插件 ${registry.plugins.length}`));
  console.log(color.dim('  在浏览器打开上面的地址即可对话。Ctrl+C 停止服务。\n'));

  // 尝试自动打开浏览器（失败不影响运行）
  if (process.platform === 'win32') {
    import('node:child_process').then(({ exec }) => {
      exec(`start "" "${addr}"`, { shell: 'cmd.exe' }, () => {});
    });
  }
}

function serveFile(file, res, mime) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function json(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/** 衣柜接口：列表 / 新增 / 修改 / 删除 / 图片读取 */
async function handleWardrobe(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  // /api/wardrobe            -> parts: ['api','wardrobe']
  // /api/wardrobe/:id        -> parts: ['api','wardrobe','<id>']
  // /api/wardrobe/image/:file-> parts: ['api','wardrobe','image','<file>']
  const sub = parts[2];

  // 图片：GET /api/wardrobe/image/<file>
  if (sub === 'image') {
    if (req.method !== 'GET') return json(res, { error: 'method not allowed' }, 405);
    const file = path.basename(parts.slice(3).join('/') || '');
    const abs = path.join(WARDROBE_IMAGE_DIR, file);
    if (!abs.startsWith(WARDROBE_IMAGE_DIR) || !file) return json(res, { error: 'forbidden' }, 403);
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
    return serveFile(abs, res, types);
  }

  try {
    // 列表
    if (req.method === 'GET' && !sub) {
      return json(res, {
        items: wardrobe.listAll(),
        stats: wardrobe.stats(),
        categories: wardrobe.CATEGORIES,
        seasons: wardrobe.SEASONS
      });
    }

    // 新增
    if (req.method === 'POST' && !sub) {
      const body = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        return json(res, { error: 'body 必须是 JSON' }, 400);
      }
      let image = '';
      if (payload.image && String(payload.image).startsWith('data:')) {
        image = wardrobe.saveImage(String(payload.image));
      }
      const item = wardrobe.addItem({ ...payload, image });
      return json(res, { ok: true, item }, 201);
    }

    // 修改
    if (req.method === 'PUT' && sub) {
      const id = decodeURIComponent(sub);
      const body = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        return json(res, { error: 'body 必须是 JSON' }, 400);
      }
      const patch = { ...payload };
      if (payload.image && String(payload.image).startsWith('data:')) {
        patch.image = wardrobe.saveImage(String(payload.image));
      } else if (payload.image === null || payload.image === '') {
        // 显式清除图片
        const old = wardrobe.getItem(id);
        if (old?.image) wardrobe.deleteImage(old.image);
        patch.image = '';
      } else {
        delete patch.image;
      }
      const item = wardrobe.updateItem(id, patch);
      return json(res, { ok: true, item });
    }

    // 删除
    if (req.method === 'DELETE' && sub) {
      const removed = wardrobe.removeItem(decodeURIComponent(sub));
      return json(res, { ok: true, removed: removed.id });
    }

    return json(res, { error: 'not found' }, 404);
  } catch (err) {
    return json(res, { error: err.message }, 400);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20e6) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
