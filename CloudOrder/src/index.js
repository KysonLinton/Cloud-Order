#!/usr/bin/env node
/** CloudOrder（穿搭管家）入口：CLI / Web 两种运行方式 */
import process from 'node:process';
import { loadConfig, ensureDirs, hasApiKey } from './config.js';
import { createRegistry } from './registry.js';
import { Agent } from './agent.js';
import { createCliUi, runSetupWizard, runProfileWizard } from './ui/cli.js';
import * as profile from './profile.js';
import { color } from './utils.js';

const HELP = `
${color.bold('CloudOrder')} — 本地运行的轻量智能体（对话 + 工具 + 技能 + 插件）

用法:
  node src/index.js                 启动交互式对话
  node src/index.js --web           启动浏览器界面（默认 http://127.0.0.1:8787）
  node src/index.js -p "你的问题"    单次提问后退出
  node src/index.js --list-tools    列出所有工具
  node src/index.js --list-skills   列出所有技能
  node src/index.js --list-plugins  列出所有插件
  node src/index.js --check         检查配置与连通性
  node src/index.js --setup         重新运行配置向导

常用参数:
  --config <file>    指定配置文件
  --model <name>     覆盖模型名
  --base-url <url>   覆盖接口地址
  --workspace <dir>  覆盖工作区
  --no-stream        关闭流式输出
  --auto             自动批准所有工具（谨慎）

也可用环境变量:
  CLOUDORDER_API_KEY / CLOUDORDER_BASE_URL / CLOUDORDER_MODEL
  （OPENAI_API_KEY / OPENAI_BASE_URL 同样被识别）
`;

function parseArgv(argv) {
  const opts = { overrides: {}, flags: new Set(), positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--help':
      case '-h':
        opts.flags.add('help');
        break;
      case '--web':
        opts.flags.add('web');
        break;
      case '--check':
        opts.flags.add('check');
        break;
      case '--setup':
        opts.flags.add('setup');
        break;
      case '--auto':
        opts.overrides.autoApprove = true;
        break;
      case '--no-stream':
        opts.overrides.stream = false;
        break;
      case '--list-tools':
        opts.flags.add('list-tools');
        break;
      case '--list-skills':
        opts.flags.add('list-skills');
        break;
      case '--list-plugins':
        opts.flags.add('list-plugins');
        break;
      case '--reasoning':
        opts.overrides.showReasoning = true;
        break;
      case '--config':
        opts.configPath = next();
        break;
      case '--model':
        opts.overrides.model = next();
        break;
      case '--base-url':
        opts.overrides.baseUrl = next();
        break;
      case '--workspace':
      case '-w':
        opts.overrides.workspace = next();
        break;
      case '--prompt':
      case '-p':
        opts.flags.add('once');
        opts.positional.push(next());
        break;
      case '--port':
        opts.overrides.port = Number(next());
        break;
      default:
        if (a.startsWith('-')) {
          console.error(color.yellow(`未知参数: ${a}（用 --help 查看用法）`));
        } else {
          opts.positional.push(a);
        }
    }
  }
  return opts;
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgv(argv);

  if (opts.flags.has('help')) {
    console.log(HELP);
    return;
  }

  ensureDirs();
  const config = loadConfig({ configPath: opts.configPath, overrides: opts.overrides });

  // 单次提问也算 once 模式
  if (opts.positional.length && !opts.flags.has('web')) opts.flags.add('once');

  const registry = createRegistry(config);

  if (opts.flags.has('list-tools')) {
    console.log(color.bold(`\n工具 (${registry.tools.size})`));
    for (const [name, t] of registry.tools) {
      const src = t.plugin ? `plugin:${t.plugin}` : 'builtin';
      console.log(`  ${name.padEnd(16)} [${(t.risk || 'low').padEnd(6)} ${src}]  ${t.description.split('\n')[0]}`);
    }
    console.log('');
    return;
  }
  if (opts.flags.has('list-skills')) {
    console.log(color.bold(`\n技能 (${registry.skills.size})`));
    for (const [name, s] of registry.skills) {
      console.log(`  ${name.padEnd(20)} ${s.description}`);
    }
    console.log('');
    return;
  }
  if (opts.flags.has('list-plugins')) {
    console.log(color.bold(`\n插件 (${registry.plugins.length})`));
    for (const p of registry.plugins) {
      console.log(`  ${p.name.padEnd(16)} ${p.description}`);
      console.log(color.dim(`     工具: ${p.tools.join(', ') || '(无)'}`));
    }
    console.log('');
    return;
  }

  if (opts.flags.has('web')) {
    const { startWebServer } = await import('./ui/web.js');
    await startWebServer({ config, registry });
    return;
  }

  if (opts.flags.has('check')) {
    await checkConfig(config, registry);
    return;
  }

  const cli = createCliUi({ config, registry, agent: null });
  const agent = new Agent({ config, registry, ui: cli.ui });
  // cli 里需要 agent 引用处理 /new 等命令
  cli.agent = agent;

  if (!opts.flags.has('once')) cli.printBanner();

  const needsSetup = !config.configFileExists && !hasApiKey(config) && !opts.flags.has('once');
  if (opts.flags.has('setup') || needsSetup) {
    await runSetupWizard(config, cli);
    agent.reset();
  }

  // 首次运行：邀请填写个人档案（穿搭建议的依据）。直接回车可全部跳过。
  if (!opts.flags.has('once') && !profile.isProfileConfigured()) {
    const p = await offerProfileSetup({ cli, ask: cli.ask, line: cli.line });
    if (p?.configured) agent.reset();
  }

  if (opts.flags.has('once')) {
    const prompt = opts.positional.join(' ');
    agent.reset();
    agent.addUser(prompt);
    const result = await agent.run();
    if (result.error) {
      cli.close();
      process.exit(1);
    }
    const answer = (result.text || '').trim();
    if (!answer) cli.line(color.dim('(模型没有返回文本内容)'));
    process.stdout.write('\n');
    cli.close();
    return;
  }

  agent.reset();
  await conversationLoop({ agent, cli, config, registry });
}

async function conversationLoop({ agent, cli, config }) {
  let closed = false;
  cli.rl.on('close', () => {
    closed = true;
  });

  // Ctrl+C：第一次中断生成，第二次退出
  process.on('SIGINT', () => {
    if (agent.abort) {
      agent.stop();
      cli.line(color.dim('  (已中断生成)'));
    } else {
      cli.line(color.dim('\n再见。'));
      cli.close();
      process.exit(0);
    }
  });

  const { createSessionStore } = await import('./session.js');
  const store = createSessionStore();

  while (!closed) {
    const input = await new Promise((resolve) => {
      if (closed) return resolve(null);
      cli.rl.question(color.bold(color.blue('\n你 › ')), (a) => resolve(a));
    });
    if (input === null) break;
    const text = input.trim();
    if (!text) continue;

    if (text.startsWith('/')) {
      const handled = await cli.handleCommand(text);
      if (!handled) break;
      if (text.startsWith('/exit') || text.startsWith('/quit')) break;
      continue;
    }

    agent.addUser(text);
    store.append({ type: 'user', text });
    await agent.run();
    store.saveMessages(agent.history());
    process.stdout.write('\n');
  }

  store.close();
  cli.close();
}

async function offerProfileSetup({ ask, line }) {
  line('');
  line(color.bold(color.magenta('  第一次使用：先花一分钟填一下你的「档案」')));
  line(
    color.dim(
      '  穿搭管家会根据你的性别、年龄、体型、职业、常去场合、风格与颜色偏好、禁忌和尺码，给出更贴合你的建议。'
    )
  );
  line(color.dim('  档案仅保存在本地（.cloudorder/profile/profile.json），不会上传；随时可在网页版「档案」入口修改。'));
  const go = ((await ask('\n  现在填写吗？[Y/n]: ')) || 'y').trim().toLowerCase();
  if (go === 'n' || go === 'no') {
    line(color.dim('  好，跳过。想填时输入 /profile edit，或在网页版右上角「档案」入口填写。\n'));
    return null;
  }
  return await runProfileWizard({ ask, line });
}

async function checkConfig(config, registry) {
  console.log(color.bold('\n配置检查'));
  console.log(`  配置文件   ${config.configPath || color.yellow('(未找到 config.json，使用默认值)')}`);
  console.log(`  baseUrl    ${config.baseUrl}`);
  console.log(`  model      ${config.model}`);
  console.log(`  apiKey     ${config.apiKey ? `${config.apiKey.slice(0, 6)}****` : color.yellow('(空)')}`);
  console.log(`  工作区     ${config.workspace}`);
  console.log(`  档案       ${profile.isProfileConfigured() ? color.green('已填写') : color.yellow('未填写（运行 /profile edit 或网页版「档案」入口）')}`);
  console.log(`  评价飞轮   ${feedback.countFeedback() ? color.green(`已记录 ${feedback.countFeedback()} 条`) : color.yellow('暂无评价（推荐后我会请你评价）')}`);
  console.log(
    `  已加载     ${registry.tools.size} 个工具 / ${registry.skills.size} 个技能 / ${registry.plugins.length} 个插件`
  );

  console.log(color.bold('\n连通性测试'));
  try {
    const { chatCompletion } = await import('./llm.js');
    const t0 = Date.now();
    const res = await chatCompletion({
      config: { ...config, stream: false },
      messages: [{ role: 'user', content: '回复两个字：正常' }]
    });
    console.log(color.green(`  ✓ 模型响应成功（${Date.now() - t0}ms）：${res.content.trim().slice(0, 60)}`));
  } catch (err) {
    console.log(color.red(`  ✗ 失败：${err.message}`));
  }

  if (registry.diagnostics?.length) {
    const bad = registry.diagnostics.filter((d) => d.error);
    if (bad.length) {
      console.log(color.bold('\n插件诊断'));
      for (const d of bad) console.log(color.red(`  ✗ ${d.file}: ${d.error}`));
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(color.red(`\n出错：${err.message}`));
  if (process.env.CLOUDORDER_DEBUG || process.env.MINIAGENT_DEBUG) console.error(err.stack);
  process.exit(1);
});
