/**
 * 示例插件 2：Git 助手
 * 演示插件如何依赖 run_command 之外的 shell 能力：
 * 这里直接调用 child_process，并通过 config.workspace 限定作用域。
 */
import { execFile } from 'node:child_process';

function git(cwd, args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(stderr || err.message));
      resolve(stdout || stderr);
    });
  });
}

export default {
  name: 'git',
  description: 'Git 仓库常用操作：状态、最近提交、差异',
  systemPrompt: '你可以直接查看当前工作区 Git 仓库的状态、提交历史与变更差异。',

  tools: [
    {
      name: 'git_status',
      description: '查看工作区 Git 状态（当前分支与改动文件列表）。',
      parameters: { type: 'object', properties: {} },
      risk: 'low',
      safeByDefault: true,
      async run(_args, ctx) {
        const cwd = ctx?.config?.workspace ?? process.cwd();
        const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
        const status = (await git(cwd, ['status', '--short'])).trim();
        return `分支: ${branch}\n${status || '(工作区干净)'}`;
      }
    },
    {
      name: 'git_log',
      description: '查看最近的提交记录。',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'integer', description: '条数，默认 10' },
          oneline: { type: 'boolean', description: '是否单行显示，默认 true' }
        }
      },
      risk: 'low',
      safeByDefault: true,
      async run(args, ctx) {
        const cwd = ctx?.config?.workspace ?? process.cwd();
        const n = Math.min(Number(args.count) || 10, 100);
        const fmt = args.oneline === false ? ['--pretty=format:%h %an %ad %s', '--date=short'] : ['--oneline'];
        return (await git(cwd, ['log', `-n`, String(n), ...fmt])).trim() || '(无提交记录)';
      }
    },
    {
      name: 'git_diff',
      description: '查看未提交的改动差异。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '限定某个文件或目录' },
          staged: { type: 'boolean', description: '是否查看已暂存的改动' }
        }
      },
      risk: 'low',
      safeByDefault: true,
      async run(args, ctx) {
        const cwd = ctx?.config?.workspace ?? process.cwd();
        const argv = ['diff'];
        if (args.staged) argv.push('--staged');
        if (args.path) argv.push('--', String(args.path));
        const out = await git(cwd, argv);
        return out.trim() ? out : '(没有差异)';
      }
    }
  ]
};
