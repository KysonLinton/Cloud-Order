// 检查当前 node 环境能否正常加载项目（插件同步加载是关键）
import { createRequire } from 'node:module';
import os from 'node:os';

console.log('node 版本 :', process.version);
console.log('node 路径 :', process.execPath);
console.log('平台      :', process.platform);

const require = createRequire(import.meta.url);
try {
  const p = require('../plugins/utility.mjs');
  console.log('插件同步加载: OK （' + p.default.tools.length + ' 个工具）');
} catch (e) {
  console.log('插件同步加载: 失败 ->', e.message);
}

try {
  const { execSync } = await import('node:child_process');
  console.log('子进程调用  : OK');
} catch (e) {
  console.log('子进程调用  : 失败 ->', e.message);
}
