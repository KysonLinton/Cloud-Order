// Web 端「评价飞轮」端到端测试：/api/feedback 三方法 + 前端入口/弹窗/快捷评价栏
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8795);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve('.');
const FEEDBACK_FILE = path.join(ROOT, '.cloudorder', 'feedback', 'feedback.json');

let pass = 0;
let fail = 0;
function check(label, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label} ${extra}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(`${BASE}/api/info`);
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  return false;
}

const child = spawn(process.execPath, ['src/index.js', '--web', '--port', String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, CLOUDORDER_NO_OPEN: '1' },
  stdio: 'ignore'
});

try {
  const up = await waitUp();
  if (!up) throw new Error('服务未能在超时内启动');
  console.log('\n[1] /api/info 暴露飞轮状态');
  const info = await (await fetch(`${BASE}/api/info`)).json();
  check('feedbackCount 字段存在', typeof info.feedbackCount === 'number');
  const names = info.tools.map((t) => t.name);
  check('工具列表含 feedback_add/list/delete', ['feedback_add', 'feedback_list', 'feedback_delete'].every((n) => names.includes(n)));
  check('技能列表含 outfit-feedback', info.skills.some((s) => s.name === 'outfit-feedback'));

  console.log('\n[2] GET /api/feedback');
  await fetch(`${BASE}/api/feedback`, { method: 'DELETE' });
  const g0 = await (await fetch(`${BASE}/api/feedback`)).json();
  check('初始 items 为空数组', Array.isArray(g0.items) && g0.items.length === 0);
  check('返回 ratings 定义', Array.isArray(g0.ratings) && g0.ratings.length === 3);
  check('summary.total 为 0', g0.summary?.total === 0, JSON.stringify(g0.summary));

  console.log('\n[3] POST /api/feedback');
  const post = await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rating: '不满意',
      outfit: '藏青西装外套 + 白衬衫 + 卡其裤',
      scenario: '通勤',
      suggestion: '上衣太正式了，想休闲一点',
      disliked: ['太正式', ' 颜色太深 ']
    })
  });
  const pd = await post.json();
  check('POST 返回 201', post.status === 201, String(post.status));
  check('中文满意度被归一为 unsatisfied', pd.item?.rating === 'unsatisfied', JSON.stringify(pd.item?.rating));
  check('返回带 label/icon', pd.item?.label === '不满意' && !!pd.item?.icon);
  check('disliked 去空格为数组', Array.isArray(pd.item?.disliked) && pd.item.disliked[0] === '太正式' && pd.item.disliked.length === 2, JSON.stringify(pd.item?.disliked));
  check('summary 已更新', pd.summary?.total === 1 && pd.summary.byRating.unsatisfied === 1);

  console.log('\n[4] 落盘与文件规范');
  check('feedback.json 已生成', fs.existsSync(FEEDBACK_FILE));
  const buf = fs.readFileSync(FEEDBACK_FILE);
  check('feedback.json 无 BOM', !(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf));
  const onDisk = JSON.parse(buf.toString('utf8'));
  check('记录已落盘且含 id', onDisk.items.length === 1 && !!onDisk.items[0].id);
  check('落盘内容保留用户原话', onDisk.items[0].suggestion.includes('想休闲一点'));

  console.log('\n[5] 局部累加与统计');
  await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 'satisfied', outfit: '白T + 牛仔裤', suggestion: '这样很舒服' })
  });
  const g1 = await (await fetch(`${BASE}/api/feedback`)).json();
  check('共 2 条且倒序', g1.items.length === 2 && g1.items[0].rating === 'satisfied', JSON.stringify(g1.items.map((i) => i.rating)));
  check('满意率 50%', g1.summary.satisfiedRate === 50, String(g1.summary.satisfiedRate));
  check('雷点汇总含「太正式」', g1.summary.painPoints.includes('太正式'), JSON.stringify(g1.summary.painPoints));
  const filtered = await (await fetch(`${BASE}/api/feedback?rating=unsatisfied`)).json();
  check('rating 过滤生效', filtered.items.length === 1 && filtered.items[0].rating === 'unsatisfied');

  console.log('\n[6] 错误处理');
  const bad = await fetch(`${BASE}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  check('非法 JSON → 400', bad.status === 400, String(bad.status));
  const empty = await fetch(`${BASE}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('空内容 → 400', empty.status === 400, String(empty.status));
  const badMethod = await fetch(`${BASE}/api/feedback`, { method: 'PATCH' });
  check('非法方法 → 405', badMethod.status === 405, String(badMethod.status));
  const unknown = await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 'satisfied', evil: 'x', scenario: '约会' })
  });
  const ud = await unknown.json();
  check('未知字段不落库', ud.item && !('evil' in ud.item) && ud.item.scenario === '约会');

  console.log('\n[7] 前端界面要素');
  const html = await (await fetch(`${BASE}/`)).text();
  check('有反馈入口按钮', /id="btn-feedback"/.test(html));
  check('有反馈弹窗容器', /id="fb-modal"/.test(html));
  check('有快捷评价栏渲染函数', html.includes('showInlineFeedback'));
  check('调用 /api/feedback', html.includes("'/api/feedback'") || html.includes('`/api/feedback'));
  check('支持 #feedback 深链接', /h\.startsWith\('feedback'\)/.test(html));
  check('引用满意度选项文案', html.includes('不满意') && html.includes('满意'));
  check('档案弹窗底栏改为 sticky', /\.bar\.sticky/.test(html) && html.includes('bar sticky'));

  console.log('\n[8] DELETE');
  const one = g1.items[0];
  const delOne = await fetch(`${BASE}/api/feedback?id=${encodeURIComponent(one.id)}`, { method: 'DELETE' });
  const dd = await delOne.json();
  check('按 id 删除单条', delOne.ok && dd.summary.total === 2, JSON.stringify(dd.summary?.total));
  const delAll = await fetch(`${BASE}/api/feedback`, { method: 'DELETE' });
  const da = await delAll.json();
  check('清空全部', delAll.ok && da.summary.total === 0);
  check('清空后文件不存在', !fs.existsSync(FEEDBACK_FILE));

  console.log('\n[9] 系统提示注入（仓库内置默认提示）');
  const { DEFAULTS } = await import('../src/config.js');
  check('内置默认提示含 feedback_add 条款', /feedback_add/.test(DEFAULTS.systemPrompt || ''));
  check('内置默认提示含「不要重复」约束', /不要重复/.test(DEFAULTS.systemPrompt || ''));
  check('内置默认提示含档案条款（profile_get）', /profile_get/.test(DEFAULTS.systemPrompt || ''));
  check('8 条系统规则', (DEFAULTS.systemPrompt.match(/\d\)\s/g) || []).length === 8, String((DEFAULTS.systemPrompt.match(/\d\)\s/g) || []).length));
} catch (err) {
  fail++;
  console.log(`  ✗ 测试异常: ${err.message}`);
} finally {
  child.kill();
  try {
    fs.rmSync(path.dirname(FEEDBACK_FILE), { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
