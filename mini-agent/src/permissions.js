/**
 * 权限层：所有可能产生影响的操作在执行前都要经过这里。
 *
 * 判定顺序：
 *   1) 硬性规则（破坏性命令、越界路径）→ 直接拒绝
 *   2) 自动放行（autoApprove / autoApproveTools / safeByDefault 工具）→ 不打扰用户
 *   3) 其余 → 交给上层确认（CLI 询问 / Web 点击）
 */
import path from 'node:path';
import { insideWorkspace } from './utils.js';

/** glob 匹配，支持 * 和 **（大小写不敏感，/ 与 \ 等价） */
export function globMatch(pattern, str) {
  const p = String(pattern).replace(/\\/g, '/');
  const s = String(str).replace(/\\/g, '/');
  let rx = '^';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        rx += '.*';
        i++;
      } else {
        rx += '[^/]*';
      }
    } else if (ch === '?') {
      rx += '.';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      rx += `\\${ch}`;
    } else {
      rx += ch;
    }
  }
  rx += '$';
  return new RegExp(rx, 'i').test(s);
}

/** 危险命令模式（即使用户开启自动放行也默认拒绝） */
const DANGEROUS = [
  { rx: /rm\s+-rf\s+[\/~]/i, why: '递归删除根目录' },
  { rx: /Remove-Item\b[^|;]*-Recurse[^|;]*-Force[^|;]*[\/~]/i, why: '递归强删根目录' },
  { rx: /format\s+[a-z]:/i, why: '格式化磁盘' },
  { rx: /\bmkfs\b/i, why: '创建文件系统' },
  { rx: /\bdd\s+if=/i, why: '裸设备写入' },
  { rx: /:\(\)\s*\{.*\};?\s*:/, why: 'fork 炸弹' },
  { rx: /\b(shutdown|Restart-Computer)\b/i, why: '关机/重启' },
  { rx: /\breg\s+delete\b/i, why: '删除注册表项' },
  { rx: /\bnet\s+user\s+\S+\s+\S+\s+\/add\b/i, why: '创建系统账户' },
  { rx: /\bSet-ExecutionPolicy\b/i, why: '修改执行策略' },
  { rx: />\s*\/dev\/(sd|nvme|hd)/i, why: '写入块设备' }
];

const SOFT_DELETE = /\brm\b|Remove-Item|\bdel\b|rmdir|\bgit\s+clean\b|\bgit\s+reset\s+--hard\b/i;

/**
 * @returns {{decision:'allow'|'deny'|'ask', autoApprove:boolean, risk:'low'|'medium'|'high', reason?:string, notes:string[]}}
 */
export function assessToolCall(config, tool, args = {}) {
  const notes = [];
  let risk = tool.risk === 'high' ? 'high' : tool.risk === 'medium' ? 'medium' : 'low';

  // ---- 1) 硬性规则 ----
  let outsideWorkspace = false;
  const target = tool.targetPath?.(args) ?? args.path ?? args.file_path;
  if (target && !config.allowOutsideWorkspace) {
    const abs = path.resolve(config.workspace, String(target));
    if (!insideWorkspace(config.workspace, abs)) {
      outsideWorkspace = true;
      if (tool.requiresWorkspace) {
        return {
          decision: 'deny',
          autoApprove: false,
          risk,
          reason:
            `路径超出工作区：${abs}\n` +
            `当前工作区为 ${config.workspace}。如确需访问外部路径，请设置 "allowOutsideWorkspace": true。`,
          notes
        };
      }
      // 只读类工具允许访问外部，但必须由用户确认
      risk = 'medium';
      notes.push(`路径在工作区之外，请确认无敏感信息：${abs}`);
    }
  }

  if (tool.name === 'run_command') {
    const cmd = String(args.command ?? '');
    const hit = DANGEROUS.find((d) => d.rx.test(cmd));
    if (hit) {
      return {
        decision: 'deny',
        autoApprove: false,
        risk: 'high',
        reason: `命令被安全策略拒绝（${hit.why}）：${cmd}`,
        notes
      };
    }
    if (SOFT_DELETE.test(cmd)) {
      risk = 'high';
      notes.push('命令包含删除或破坏性操作');
    }
  }

  // ---- 2) 自动放行 ----
  const listed = Array.isArray(config.autoApproveTools)
    ? config.autoApproveTools.some((p) => p === tool.name || globMatch(p, tool.name))
    : false;
  const autoApprove =
    config.autoApprove === true ||
    listed ||
    (!outsideWorkspace && tool.safeByDefault === true && risk === 'low');

  return { decision: autoApprove ? 'allow' : 'ask', autoApprove, risk, notes };
}
