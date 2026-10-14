/** 冒烟测试：不依赖外部网络，直接驱动 Agent 循环 */
import { loadConfig } from '../src/config.js';
import { createRegistry } from '../src/registry.js';
import { Agent } from '../src/agent.js';
import { assessToolCall, globMatch } from '../src/permissions.js';
import { parseFrontMatter } from '../src/registry.js';
import { weatherText, isWet, fetchWeatherSummary } from '../src/tools/weather.js';
import { locateBrief, reverseGeocode, locateByIp } from '../src/tools/location.js';
import * as wardrobe from '../src/wardrobe.js';
import { identifyImage, parseJsonLoose } from '../src/tools/vision.js';

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

console.log('\n[1] 配置加载');
const config = loadConfig({ overrides: { apiKey: 'test', stream: false } });
check('baseUrl 去掉尾部斜杠', !config.baseUrl.endsWith('/'), config.baseUrl);
check('workspace 解析为绝对路径', config.workspace.includes(':') || config.workspace.startsWith('/'), config.workspace);

console.log('\n[2] 注册表');
const registry = createRegistry(config);
check('内建工具存在', registry.tools.has('read_file') && registry.tools.has('run_command'));
check('技能工具存在', registry.tools.has('load_skill'));
check('已加载示例技能', registry.skills.size >= 2, `实际 ${registry.skills.size}`);
check('已加载示例插件', registry.plugins.length >= 2, `实际 ${registry.plugins.length}`);
check('插件工具已注册', registry.tools.has('now_time') && registry.tools.has('git_status'));
check('天气工具已注册', registry.tools.has('get_weather') && registry.tools.has('get_weather_forecast') && registry.tools.has('geocode_city'));
check('IP 定位工具已注册', registry.tools.has('get_ip_location'));
check('位置/天气模块导出可用', typeof locateBrief === 'function' && typeof reverseGeocode === 'function' && typeof locateByIp === 'function' && typeof fetchWeatherSummary === 'function');
check('天气技能已加载', [...registry.skills.keys()].includes('weather-dressing'));
check('load_skill 能看到技能', [...registry.skills.keys()].includes('summarize-file'));
check(
  '衣柜工具已注册',
  registry.tools.has('wardrobe_list') &&
    registry.tools.has('wardrobe_get') &&
    registry.tools.has('wardrobe_add') &&
    registry.tools.has('wardrobe_update') &&
    registry.tools.has('wardrobe_remove')
);
check('衣柜数据层导出可用', typeof wardrobe.addItem === 'function' && typeof wardrobe.listItems === 'function');
check('图片识别工具已注册', registry.tools.has('analyze_image'));
check('图片识别模块导出可用', typeof identifyImage === 'function' && typeof parseJsonLoose === 'function');
check('衣物图片识别技能已加载', [...registry.skills.keys()].includes('wardrobe-vision'));

console.log('\n[3] 天气代码映射');
check('晴 -> 0', weatherText(0) === '晴');
check('小雨 -> 61', weatherText(61) === '小雨');
check('未知代码兜底', weatherText(1234).includes('1234'));
check('降水类代码识别', isWet(61) && isWet(80) && isWet(95) && !isWet(0) && !isWet(2));

console.log('\n[3b] front matter 解析');
const fm = parseFrontMatter('---\nname: demo\ndescription: "关于 演示"\n---\n正文');
check('解析 name', fm.data.name === 'demo');
check('解析带引号 description', fm.data.description === '关于 演示');
check('正文分离', fm.body.trim() === '正文');

console.log('\n[4] 权限判定');
check('glob 通配', globMatch('read_*', 'read_file') && !globMatch('read_*', 'write_file'));
const readTool = registry.tools.get('read_file');
check('工作区内文件读取放行', assessToolCall(config, readTool, { path: 'README.md' }).decision === 'allow');
check(
  '越界读取需确认',
  assessToolCall({ ...config, allowOutsideWorkspace: false }, readTool, { path: '../../secret.txt' }).decision === 'ask'
);
const writeTool = registry.tools.get('write_file');
check(
  '越界写入被拒绝',
  assessToolCall({ ...config, allowOutsideWorkspace: false }, writeTool, { path: '../../evil.txt', content: 'x' }).decision === 'deny'
);
check(
  'allowOutsideWorkspace 放开越界写入',
  assessToolCall({ ...config, allowOutsideWorkspace: true }, writeTool, { path: '../../evil.txt', content: 'x' }).decision !== 'deny'
);
const cmdTool = registry.tools.get('run_command');
check('危险命令被拒绝', assessToolCall(config, cmdTool, { command: 'rm -rf /' }).decision === 'deny');
check('高风险命令需确认', assessToolCall(config, cmdTool, { command: 'echo hi' }).decision === 'ask');
check(
  '自动批准白名单生效',
  assessToolCall({ ...config, autoApproveTools: ['run_command'] }, cmdTool, { command: 'echo hi' }).decision === 'allow'
);

console.log('\n[5] 技能正文可读取');
const skillDoc = await registry.tools.get('load_skill').run({ name: 'summarize-file' });
check('load_skill 返回说明正文', skillDoc.includes('文件总结') && skillDoc.includes('## 步骤'));

console.log('\n[6] 工具实际执行');
const listOut = await registry.tools.get('list_dir').run({ path: '.', recursive: false });
check('list_dir 列出内容', listOut.includes('package.json'), listOut.slice(0, 200));
const calcOut = await registry.tools.get('calculate').run({ expression: '(12+8)*3/7' });
check('插件工具 calculate 正确', calcOut.includes('8.5714'), calcOut);
const timeOut = await registry.tools.get('now_time').run({});
check('插件工具 now_time 返回时间', /\d{4}/.test(timeOut), timeOut);

console.log('\n[6b] 衣柜数据库（增/查/改/删）');
const before = wardrobe.listAll().length;
check('衣柜初始可枚举', Array.isArray(wardrobe.listAll()));
const added = wardrobe.addItem({
  name: '冒烟测试-白衬衫',
  category: '衬衫',
  colors: '白, 米白',
  material: '棉',
  style: ['简约'],
  seasons: ['春', '秋'],
  fit: '修身'
});
check('新增生成 id', typeof added.id === 'string' && added.id.startsWith('w_'));
check('颜色解析为数组', Array.isArray(added.colors) && added.colors.length === 2, JSON.stringify(added.colors));
check('可按类别筛选到', wardrobe.listItems({ category: '衬衫' }).some((it) => it.id === added.id));
check('可按关键词搜索到', wardrobe.listItems({ keyword: '冒烟测试' }).some((it) => it.id === added.id));
const bumped = wardrobe.updateItem(added.id, { material: '亚麻', colors: ['白'] });
check('修改生效', bumped.material === '亚麻' && bumped.colors.length === 1);
const wdListOut = await registry.tools.get('wardrobe_list').run({ keyword: '冒烟测试' });
check('wardrobe_list 输出单品', wdListOut.includes('冒烟测试-白衬衫'));
const getOut = await registry.tools.get('wardrobe_get').run({ id: added.id });
check('wardrobe_get 输出完整参数', getOut.includes('亚麻') && getOut.includes('修身'));
wardrobe.removeItem(added.id);
check('删除后恢复原有数量', wardrobe.listAll().length === before, `now ${wardrobe.listAll().length}, before ${before}`);

console.log('\n[7] Agent 循环（假模型，验证 tool_calls 编排）');
let calls = 0;
const agent = new Agent({
  config: { ...config, stream: true, maxSteps: 5 },
  registry,
  ui: {
    onAssistantDelta: () => {},
    onToolEnd: ({ ok }) => {
      if (ok) calls++;
    },
    requestApproval: async () => true
  }
});
agent.reset();
agent.addUser('test');
// 手动模拟一轮：直接注入假的 assistant tool_calls 等价流程通过 mock server 更真实，
// 这里只验证 prompt 组装与历史管理。
check('系统提示包含工具清单', agent.messages[0].content.includes('# 可用工具'));
check('系统提示包含技能列表', agent.messages[0].content.includes('summarize-file'));
check('历史不含 system', agent.history().every((m) => m.role !== 'system'));

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
