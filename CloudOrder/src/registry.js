/**
 * 工具与技能的中央注册表。
 *
 * - tools:  单一函数工具（Function Calling 接口），内建 + 插件注册
 * - skills: 渐进式披露的技能包（SKILL.md + 附带脚本/资源），按需加载正文
 */
import fs from 'node:fs';
import path from 'node:path';
import { SKILLS_DIR } from './config.js';
import { createBuiltinTools } from './tools/index.js';
import { loadPlugins } from './plugins/loader.js';

/** 解析 SKILL.md 顶部的 YAML front matter（只支持简单的 key: value） */
export function parseFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[m[1]] = value;
  }
  return { data, body: text.slice(match[0].length) };
}

function firstParagraph(body) {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    return t.replace(/\s+/g, ' ');
  }
  return '';
}

/**
 * 扫描 skills/ 目录。
 * 支持两种布局：
 *   1) skills/<name>/SKILL.md      （推荐）
 *   2) skills/<name>.md
 */
export function loadSkills(dir = SKILLS_DIR) {
  const skills = new Map();
  if (!fs.existsSync(dir)) return skills;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    let file = null;
    let folder = null;
    if (entry.isDirectory()) {
      const candidate = path.join(dir, entry.name, 'SKILL.md');
      if (fs.existsSync(candidate)) {
        file = candidate;
        folder = path.join(dir, entry.name);
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      file = path.join(dir, entry.name);
      folder = null;
    }
    if (!file) continue;

    const raw = fs.readFileSync(file, 'utf8');
    const { data, body } = parseFrontMatter(raw);
    const name = data.name || path.basename(entry.name, path.extname(entry.name));
    const description = data.description || firstParagraph(body) || `技能 ${name}`;

    const resources = [];
    if (folder) {
      for (const sub of fs.readdirSync(folder, { withFileTypes: true })) {
        if (sub.name === 'SKILL.md') continue;
        resources.push(sub.isDirectory() ? `${sub.name}/` : sub.name);
      }
    }

    skills.set(name, {
      name,
      description,
      license: data.license,
      version: data.version,
      path: file,
      dir: folder,
      resources,
      body: body.trim(),
      length: body.trim().length
    });
  }
  return skills;
}

/** 按白名单过滤（"*" 或 ["a","b"]） */
function isEnabled(name, filter) {
  if (!filter || filter === '*') return true;
  if (Array.isArray(filter)) return filter.includes(name);
  return true;
}

export function createRegistry(config) {
  // 技能先加载，再注入工具，最后把「已启用技能」的引用交给 load_skill 使用
  const allSkills = loadSkills();
  const enabledSkills = new Map([...allSkills].filter(([n]) => isEnabled(n, config.enabledSkills)));
  const skillsRef = { current: enabledSkills };

  const tools = createBuiltinTools(config, skillsRef);

  const { plugins, diagnostics } = loadPlugins({
    config,
    register: (tool) => {
      if (tools.has(tool.name)) throw new Error(`工具名冲突: ${tool.name}`);
      tools.set(tool.name, tool);
    }
  });

  const enabledTools = new Map([...tools].filter(([n]) => isEnabled(n, config.enabledTools)));
  skillsRef.current = enabledSkills;

  return {
    tools: enabledTools,
    allToolNames: [...tools.keys()],
    skills: enabledSkills,
    plugins,
    diagnostics,
    getSkill: (name) => enabledSkills.get(name)
  };
}

/** 技能元数据注入系统提示（渐进式披露：只给名字和描述） */
export function buildSkillsPrompt(skills) {
  if (!skills.size) return '';
  const list = [...skills.values()]
    .map((s) => `- ${s.name}: ${s.description}`)
    .join('\n');
  return [
    '',
    '# 可用技能（Skills）',
    '下面是本机已安装的技能。技能的完整正文不会自动加载——当用户的请求与某个技能明显相关时，',
    '先用 load_skill 读取它的完整说明，再严格按照说明执行（说明里会告诉你需要用到哪些文件或命令）。',
    list
  ].join('\n');
}
