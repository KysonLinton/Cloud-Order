/** 会话持久化：JSONL 追加写入 + 简单索引 */
import fs from 'node:fs';
import path from 'node:path';
import { SESSION_DIR, ensureDirs } from './config.js';
import { nowStamp } from './utils.js';

export function createSessionStore() {
  ensureDirs();
  const file = path.join(SESSION_DIR, `session-${nowStamp()}.jsonl`);
  const stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });

  return {
    file,
    append(entry) {
      try {
        stream.write(`${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
      } catch {
        /* 持久化失败不影响对话 */
      }
    },
    saveMessages(messages) {
      this.append({ type: 'snapshot', messages });
    },
    close() {
      try {
        stream.end();
      } catch {
        /* ignore */
      }
    }
  };
}

/** 会话结束后把完整对话另存一份可读的 .json，方便查看 */
export function saveTranscript(messages, meta = {}) {
  ensureDirs();
  const file = path.join(SESSION_DIR, `transcript-${nowStamp()}.json`);
  fs.writeFileSync(file, JSON.stringify({ meta, messages }, jsonReplacer, 2), 'utf8');
  return file;
}

function jsonReplacer(key, value) {
  if (key === 'reasoning_content') return undefined;
  return value;
}
