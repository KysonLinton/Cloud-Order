/** 终端交互界面 */
import readline from 'node:readline';
import { color } from '../utils.js';
import { saveConfig } from '../config.js';

export function createCliUi({ config, registry, agent }) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdout.isTTY });
  let streaming = false;

  const write = (s) => process.stdout.write(s);
  const line = (s = '') => write(`${s}\n`);

  // 流式输出时脚注：显示「思考中…」
  function statusSpinner(text) {
    if (!process.stdout.isTTY) return () => {};
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const id = setInterval(() => {
      write(`\r${color.dim(`${frames[i++ % frames.length]} ${text}`)}`);
    }, 90);
    return () => {
      clearInterval(id);
      write(`\r${' '.repeat(text.length + 4)}\r`);
    };
  }

  async function ask(question) {
    return await new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
  }

  const ui = {
    onAssistantDelta(chunk) {
      if (!streaming) {
        streaming = true;
        write(`\n${color.green('● ')}`);
      }
      write(chunk);
    },
    onAssistantMessage() {
      if (streaming) {
        write('\n');
        streaming = false;
      }
    },
    onReasoning(chunk) {
      if (config.showReasoning) write(color.dim(chunk));
    },
    onToolStart({ name, args }) {
      if (streaming) {
        write('\n');
        streaming = false;
      }
      line(color.dim(`  ⚙ ${name} ${summarizeArgs(args)}`));
    },
    onToolEnd({ name, ok, output }) {
      const head = String(output).split('\n').slice(0, 3).join('\n');
      const icon = ok ? color.dim('  ✓') : color.red('  ✗');
      line(`${icon} ${color.dim(head.slice(0, 300))}${String(output).length > 300 ? color.dim(' …') : ''}`);
      if (!ok) line(color.dim(`  (${name} 调用失败，模型将自行调整)`));
    },
    onNotice({ level, text }) {
      const tag = level === 'warn' ? color.yellow('!') : color.dim('i');
      line(`${tag} ${text}`);
    },
    onError(err) {
      line(color.red(`\n请求失败：${err.message}\n`));
    },

    /** 工具审批 */
    async requestApproval({ tool, args, risk, notes }) {
      if (streaming) {
        write('\n');
        streaming = false;
      }

      // 非交互环境（管道、CI、-p 单次模式）：无法询问，默认拒绝并说明原因
      if (!process.stdin.isTTY) {
        line(color.yellow(`  ⚠ 跳过 ${tool.name}：非交互模式无法确认。`));
        line(color.dim('  如需自动执行请加 --auto 参数，或在 config.json 中设置 autoApproveTools。'));
        return false;
      }

      line('');
      line(color.yellow('┌─ 需要确认 ') + color.dim(`(风险: ${risk})`));
      line(color.yellow('│ ') + color.bold(tool.name));
      for (const [k, v] of Object.entries(args)) {
        const val = typeof v === 'string' ? (v.length > 400 ? `${v.slice(0, 400)}…` : v) : JSON.stringify(v);
        line(color.yellow('│ ') + color.dim(`${k}: `) + String(val).replace(/\n/g, '\n│   '));
      }
      for (const n of notes || []) line(color.yellow('│ ') + color.red(`注意: ${n}`));
      line(color.yellow('└─ ') + color.dim('[y] 允许一次  [a] 本次会话全部允许  [n] 拒绝'));
      const answer = (await ask('  选择: ')).toLowerCase();
      if (answer === 'a' || answer === 'always') {
        if (!Array.isArray(config.autoApproveTools)) config.autoApproveTools = [];
        config.autoApproveTools.push(tool.name);
        line(color.dim(`  已记住：本次会话内 ${tool.name} 不再询问`));
        return true;
      }
      return answer === 'y' || answer === 'yes' || answer === '' ? true : false;
    }
  };

  /** 处理斜杠命令；返回 true 表示已处理（不发送给模型） */
  async function handleCommand(input) {
    const [cmd, ...rest] = input.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd) {
      case 'help':
      case '?':
        printHelp();
        return true;
      case 'tools': {
        line(color.bold('\n可用工具：'));
        for (const [name, t] of registry.tools) {
          line(`  ${color.cyan(name)}  ${color.dim(`[${t.risk || 'low'}${t.plugin ? `, ${t.plugin}` : ', builtin'}]`)}\n      ${t.description.split('\n')[0].slice(0, 100)}`);
        }
        line(color.dim('\n输入 /tool <名字> {"参数":...} 可直接手工调用'));
        return true;
      }
      case 'tool': {
        const [name, ...jsonParts] = (arg || '').split(/\s+/);
        if (!registry.tools.has(name)) {
          line(color.red(`没有工具 ${name}`));
          return true;
        }
        let args = {};
        const rawArgs = jsonParts.join(' ');
        if (rawArgs) {
          try {
            args = JSON.parse(rawArgs);
          } catch {
            line(color.red('参数必须是合法 JSON'));
            return true;
          }
        }
        const tool = registry.tools.get(name);
        try {
          const out = await tool.run(args, { config, workspace: config.workspace, fetch, ui });
          line(String(out));
        } catch (err) {
          line(color.red(`执行失败: ${err.message}`));
        }
        return true;
      }
      case 'skills': {
        if (!registry.skills.size) {
          line(color.dim('\n没有安装技能。把技能文件夹（含 SKILL.md）放进 skills/ 目录即可。'));
          return true;
        }
        line(color.bold('\n已安装技能：'));
        for (const [name, s] of registry.skills) {
          line(`  ${color.magenta(name)}  ${color.dim(`(${s.length} 字)`)}\n      ${s.description}`);
        }
        return true;
      }
      case 'skill': {
        const s = registry.getSkill(arg);
        if (!s) {
          line(color.red(`没有技能 ${arg}`));
          return true;
        }
        line(color.bold(`\n# ${s.name}\n`) + color.dim(s.description) + '\n');
        line(s.body);
        return true;
      }
      case 'plugins': {
        if (!registry.plugins.length) {
          line(color.dim('\n没有安装插件。把 .mjs 文件放进 plugins/ 目录即可。'));
          return true;
        }
        line(color.bold('\n已安装插件：'));
        for (const p of registry.plugins) {
          line(`  ${color.cyan(p.name)}  ${p.description}\n      ${color.dim(`工具: ${p.tools.join(', ') || '(无)'}`)}`);
        }
        return true;
      }
      case 'model': {
        if (!arg) {
          line(`当前模型: ${color.bold(config.model)}  @ ${config.baseUrl}`);
          return true;
        }
        config.model = arg;
        line(color.dim(`已切换为 ${arg}（如需持久化请写进 config.json）`));
        return true;
      }
      case 'workspace': {
        if (!arg) {
          line(`工作区: ${config.workspace}`);
          return true;
        }
        config.workspace = arg;
        agent.reset();
        line(color.dim(`工作区已改为 ${arg}，会话已重置`));
        return true;
      }
      case 'auto': {
        config.autoApprove = arg !== 'off';
        line(color.yellow(`自动批准（含高风险操作）已${config.autoApprove ? '开启' : '关闭'}`));
        return true;
      }
      case 'reasoning': {
        config.showReasoning = !config.showReasoning;
        line(color.dim(`推理过程显示已${config.showReasoning ? '开启' : '关闭'}`));
        return true;
      }
      case 'new':
      case 'reset': {
        agent.reset();
        line(color.dim('已开始新会话（系统提示已按最新技能/插件重建）'));
        return true;
      }
      case 'save': {
        const { saveConfig } = await import('../config.js');
        const file = saveConfig(config);
        line(color.dim(`配置已写入 ${file}`));
        return true;
      }
      case 'config': {
        const mask = (v) => (typeof v === 'string' && v.length > 8 ? `${v.slice(0, 4)}****` : v);
        const safe = { ...config, apiKey: mask(config.apiKey) };
        line(JSON.stringify(safe, null, 2));
        return true;
      }
      case 'exit':
      case 'quit':
      case 'q':
        return false;
      default:
        line(color.red(`未知命令 /${cmd}，输入 /help 查看帮助`));
        return true;
    }
  }

  function printHelp() {
    line(color.bold('\n命令：'));
    const rows = [
      ['/help', '显示帮助'],
      ['/tools', '列出所有工具'],
      ['/tool <名> <json>', '手工调用一个工具'],
      ['/skills', '列出已安装技能'],
      ['/skill <名>', '查看技能完整内容'],
      ['/plugins', '列出已安装插件'],
      ['/model [名]', '查看或临时切换模型'],
      ['/workspace [路径]', '查看或切换工作区'],
      ['/auto [off]', '开关自动批准（谨慎）'],
      ['/reasoning', '显示/隐藏模型推理过程'],
      ['/new', '开始新会话'],
      ['/config', '查看当前有效配置'],
      ['/save', '把当前配置写入 config.json'],
      ['/exit', '退出']
    ];
    const w = Math.max(...rows.map((r) => r[0].length));
    for (const [a, b] of rows) line(`  ${color.cyan(a.padEnd(w))}  ${b}`);
    line(color.dim('\n提示：直接输入问题即可对话；模型会自动决定是否调用工具。'));
  }

  function printBanner() {
    line('');
    line(color.bold(color.magenta('  穿搭管家')) + color.dim('  本地智能体 · 对话 + 工具 + 技能 + 插件'));
    line(color.dim(`  模型   ${config.model} @ ${config.baseUrl}`));
    line(color.dim(`  工作区 ${config.workspace}`));
    line(
      color.dim(
        `  已加载 ${registry.tools.size} 个工具 · ${registry.skills.size} 个技能 · ${registry.plugins.length} 个插件`
      )
    );
    if (config.autoApprove) line(color.yellow('  ⚠ 自动批准已开启：工具将在无确认的情况下执行'));
    line(color.dim('  输入 /help 查看命令，/exit 退出\n'));
  }

  return { ui, rl, handleCommand, printBanner, ask, line, close: () => rl.close() };
}

function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    let s = typeof v === 'string' ? v : JSON.stringify(v);
    if (s.length > 120) s = `${s.slice(0, 120)}…`;
    parts.push(`${k}=${s.replace(/\n/g, '\\n')}`);
  }
  return parts.join(' ');
}

/** 首次运行向导：没有配置文件时引导填写 */
export async function runSetupWizard(config, { ask, line }) {
  line(color.bold(color.yellow('\n首次运行：需要配置一个模型服务。')));
  line(color.dim('支持任何 OpenAI 兼容接口（OpenAI / DeepSeek / 通义 / Kimi / Ollama ...）\n'));

  const presets = {
    1: { label: 'DeepSeek（推荐，性价比高）', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    2: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    3: { label: '通义千问（DashScope 兼容模式）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    4: { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
    5: { label: 'Ollama（本地，无需 API Key）', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', apiKey: 'ollama' },
    6: { label: '自定义', baseUrl: '', model: '' }
  };
  for (const [k, v] of Object.entries(presets)) line(`  ${color.cyan(k)}) ${v.label}`);
  const choice = (await ask('\n请选择 [1-6]，直接回车用 1: ')) || '1';
  const preset = presets[choice] ?? presets[1];

  let baseUrl = preset.baseUrl;
  let model = preset.model;
  let apiKey = preset.apiKey || '';

  if (choice === '6' || !baseUrl) {
    baseUrl = (await ask('接口地址 baseUrl（需以 /v1 之类结尾）: ')).trim();
    model = (await ask('模型名 model: ')).trim() || 'gpt-4o-mini';
  } else {
    const override = (await ask(`接口地址 [回车使用 ${baseUrl}]: `)).trim();
    if (override) baseUrl = override;
    const m = (await ask(`模型名 [回车使用 ${model}]: `)).trim();
    if (m) model = m;
  }

  if (!apiKey) {
    apiKey = (await ask('API Key（输入后回车；本地模型可直接回车）: ')).trim();
  }

  config.baseUrl = baseUrl.replace(/\/+$/, '');
  config.model = model;
  config.apiKey = apiKey;

  const save = ((await ask('\n是否保存到 config.json? [Y/n]: ')) || 'y').toLowerCase();
  if (save !== 'n') {
    const { saveConfig } = await import('../config.js');
    const file = saveConfig(config);
    line(color.dim(`已保存: ${file}`));
    line(color.yellow('提示：也可以改用环境变量，例如 set DEEPSEEK_API_KEY=... 并在 config.json 中写 "apiKey": "${DEEPSEEK_API_KEY}"'));
  }
  line('');
  return config;
}

export { saveConfig };
