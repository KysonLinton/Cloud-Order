/**
 * 插件（Plugins）加载器。
 *
 * 一个插件就是一个 .mjs（或 .js / .cjs）文件，默认导出一个对象：
 *
 *   export default {
 *     name: 'weather',
 *     description: '查询天气',
 *     tools: [
 *       {
 *         name: 'get_weather',
 *         description: '查询某城市当前天气',
 *         parameters: { type:'object', properties:{ city:{type:'string'} }, required:['city'] },
 *         risk: 'low',
 *         safeByDefault: true,
 *         async run(args, ctx) { return '晴天 25°C' }
 *       }
 *     ],
 *     systemPrompt: '你还能查询天气。',   // 可选：追加到系统提示
 *     setup(ctx) {}                        // 可选：加载时调用一次
 *   }
 *
 * ctx = { config, workspace, log, fetch, env }
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PLUGINS_DIR } from '../config.js';
import { color } from '../utils.js';

// createRequire 允许同步加载 ESM（Node >= 22.12 原生支持 require(esm)）
const require = createRequire(import.meta.url);

function normalizeTool(raw, pluginName) {
  const problems = [];
  if (!raw || typeof raw !== 'object') problems.push('工具定义必须是对象');
  else {
    if (!raw.name) problems.push('缺少 name');
    if (!raw.description) problems.push('缺少 description');
    if (typeof raw.run !== 'function') problems.push('缺少 run() 函数');
  }
  if (problems.length) {
    throw new Error(`插件 ${pluginName} 中工具定义无效: ${problems.join('; ')}`);
  }
  return {
    risk: 'medium',
    parameters: { type: 'object', properties: {} },
    ...raw,
    plugin: pluginName
  };
}

/**
 * 同步扫描并加载插件目录。
 * @returns {{plugins: Array, diagnostics: Array<{file:string, tools?:string[], error?:string}>}}
 */
export function loadPlugins({ config, register, dir = PLUGINS_DIR }) {
  const plugins = [];
  const diagnostics = [];

  if (!fs.existsSync(dir)) return { plugins, diagnostics };

  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(mjs|cjs|js)$/.test(f) && !f.startsWith('_') && f !== 'loader.js');

  for (const file of files) {
    const abs = path.join(dir, file);
    let plugin;
    try {
      const mod = require(abs);
      plugin = mod?.default ?? mod;
    } catch (err) {
      const hint = /require\(\) of ES Module|ERR_REQUIRE_ESM/.test(String(err.message))
        ? '（需要 Node 22.12+ 才能直接 require .mjs 插件，请升级 Node）'
        : '';
      diagnostics.push({ file, error: `加载失败: ${err.message}${hint}` });
      console.error(color.red(`✗ 插件加载失败 ${file}: ${err.message}${hint}`));
      continue;
    }

    if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) {
      diagnostics.push({ file, error: '默认导出必须是一个对象' });
      console.error(color.red(`✗ 插件 ${file} 的默认导出不是对象`));
      continue;
    }

    const name = plugin.name || path.basename(file, path.extname(file));
    const ctx = {
      config,
      workspace: config.workspace,
      log: (...a) => console.log(color.dim(`[${name}]`), ...a),
      fetch,
      env: process.env
    };

    try {
      plugin.setup?.(ctx);
    } catch (err) {
      diagnostics.push({ file, error: `setup 失败: ${err.message}` });
      console.error(color.red(`✗ 插件 ${name} setup 失败: ${err.message}`));
      continue;
    }

    const toolNames = [];
    for (const raw of plugin.tools || []) {
      try {
        const tool = normalizeTool(raw, name);
        register(tool);
        toolNames.push(tool.name);
      } catch (err) {
        diagnostics.push({ file, error: err.message });
        console.error(color.red(`✗ ${err.message}`));
      }
    }

    plugins.push({
      name,
      description: plugin.description || '',
      file: abs,
      tools: toolNames,
      systemPrompt: plugin.systemPrompt || ''
    });
    diagnostics.push({ file, tools: toolNames });
  }

  return { plugins, diagnostics };
}
