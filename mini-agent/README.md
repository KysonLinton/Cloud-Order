# MiniAgent

一个**本地运行、零依赖**的 AI Agent。能和你自然对话，也能真正干活：读写文件、执行命令、抓网页、调用你写的插件和技能。

- **零依赖**：只用 Node.js 内置模块，`git clone` 后直接跑，不用 `npm install`
- **任意大模型**：OpenAI 兼容接口（OpenAI / DeepSeek / 通义 / Kimi / 智谱 / Ollama / LM Studio …）
- **插件接口**：丢一个 `.mjs` 文件进 `plugins/`，工具自动注册给模型
- **技能接口**：丢一个含 `SKILL.md` 的文件夹进 `skills/`，按需渐进式加载
- **两种界面**：终端 CLI + 浏览器 Web（都支持流式输出和工具审批）
- **安全默认**：危险命令直接拦截，写文件/执行命令前必须确认

---

## 快速开始

需要 **Node.js ≥ 18.17**（推荐 22+，插件同步加载需要 22.12+）。

```powershell
cd mini-agent
node src/index.js
```

首次运行会引导你选择模型服务并填入 API Key，然后就能直接聊天。

### 换个模型

```powershell
# 本地 Ollama，完全离线
node src/index.js --base-url http://127.0.0.1:11434/v1 --model qwen2.5:7b

# 单次提问
node src/index.js -p "把当前目录的 README 总结成 5 条要点"
```

### 浏览器界面

```powershell
node src/index.js --web          # 默认 http://127.0.0.1:8787
node src/index.js --web --port 9000
```

---

## 配置文件

复制 `config.example.json` 为 `config.json` 后按需修改。常用项：

| 字段 | 说明 |
| --- | --- |
| `baseUrl` / `apiKey` / `model` | 模型服务接入点。`apiKey` 支持 `"${DEEPSEEK_API_KEY}"` 引用环境变量 |
| `workspace` | 工作目录，所有相对路径以此为准，默认项目根目录 |
| `allowOutsideWorkspace` | 是否允许读写工作区之外的文件，默认 `false` |
| `autoApprove` | `true` = 所有工具不询问直接执行（**谨慎**） |
| `autoApproveTools` | 只对白名单内的工具免询问，如 `["read_file","list_dir"]` |
| `maxSteps` | 单轮对话最多进行多少次「模型 → 工具」往返，默认 12 |
| `enabledSkills` / `enabledPlugins` | `"*"` 或工具/技能名数组，用于按需启用 |

环境变量优先于配置文件：`MINIAGENT_API_KEY`、`MINIAGENT_BASE_URL`、`MINIAGENT_MODEL`
（`OPENAI_API_KEY` / `OPENAI_BASE_URL` 同样识别）。

---

## 内置工具

| 工具 | 风险 | 作用 |
| --- | --- | --- |
| `read_file` | 低 | 按行号读取文件，支持分页 |
| `list_dir` | 低 | 列出目录结构 |
| `search_files` | 低 | 按文件名或内容搜索 |
| `write_file` | 中 | 创建/覆盖文件（需确认） |
| `edit_file` | 中 | 精确查找替换（需确认） |
| `run_command` | 高 | 执行 shell 命令（默认每次确认） |
| `fetch_url` | 低 | 抓取网页并转纯文本 |
| `web_search` | 低 | 联网搜索（需配置 Tavily/Brave 密钥） |
| `load_skill` | 低 | 加载技能完整说明 |
| `list_skills` | 低 | 列出已安装技能 |

---

## 写一个插件

在 `plugins/` 下新建 `weather.mjs`：

```js
export default {
  name: 'weather',
  description: '天气查询',
  systemPrompt: '你还可以查询天气。',   // 可选：追加到系统提示

  tools: [
    {
      name: 'get_weather',
      description: '查询指定城市当前天气',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: '城市名' } },
        required: ['city']
      },
      risk: 'low',              // low | medium | high
      safeByDefault: true,      // 低风险时免确认
      async run(args, ctx) {
        // ctx = { config, workspace, log, fetch, env }
        ctx.log('查询', args.city);
        const res = await ctx.fetch(`https://wttr.in/${encodeURIComponent(args.city)}?format=j1`);
        const json = await res.json();
        return `${args.city}: ${json.current_condition[0].temp_C}°C，${json.current_condition[0].weatherDesc[0].value}`;
      }
    }
  ]
};
```

重启后 `get_weather` 就自动出现在模型的工具列表里了。用 `--list-plugins` 可以确认是否加载成功。

> 插件就是普通的 Node 模块，可以用任何 npm 包、调用任何本地程序。

---

## 写一个技能

技能是**给模型看的说明书**（不是代码接口）。适合封装「一套固定流程」。

```
skills/
  deploy-site/
    SKILL.md          # 必须
    deploy.ps1        # 可选：附带脚本
    reference.md      # 可选：参考资料
```

`SKILL.md` 用 YAML front matter 声明元数据：

```markdown
---
name: deploy-site
description: 把构建产物发布到公司服务器。当用户说"发布""部署上线"时使用。
---

# 发布流程

## 步骤

1. 用 `run_command` 执行 `npm run build`，确认构建成功。
2. 检查 `dist/` 目录是否存在。
3. 用 `run_command` 执行本技能目录下的 `deploy.ps1`。
4. 用 `fetch_url` 访问线上地址，确认返回 200。

## 注意事项

- 发布前必须先跑一次 `npm test`。
- 失败时不要重试超过两次，直接把错误给用户看。
```

**渐进式披露**：系统提示里只放技能的名字和描述，模型判断相关时才用 `load_skill` 读取全文。
这样装几十个技能也不会撑爆上下文。

---

## 命令行速查

```
node src/index.js                  交互式对话
node src/index.js --web            浏览器界面
node src/index.js -p "问题"         单次提问
node src/index.js --check          检查配置 + 测试连通性
node src/index.js --list-tools     列出工具
node src/index.js --list-skills    列出技能
node src/index.js --list-plugins   列出插件
node src/index.js --setup          重跑配置向导
node src/index.js --auto           自动批准所有工具（谨慎）
node src/index.js --no-stream      关闭流式输出
```

对话中可用斜杠命令：

```
/help  /tools  /tool <名> <json>  /skills  /skill <名>  /plugins
/model  /workspace  /auto  /reasoning  /new  /config  /save  /exit
```

`Ctrl+C` 第一次中断当前生成，第二次退出。

---

## 测试

```powershell
# 单元冒烟测试（不需要网络和 API Key）
node test/smoke.mjs

# 端到端测试：启动一个 mock 模型服务
node test/mock-llm-server.mjs              # 终端 A
node src/index.js --base-url http://127.0.0.1:11435/v1 --model mock   # 终端 B
# 在 B 里输入「工具测试」「技能测试」「命令测试」验证链路
```

---

## 目录结构

```
mini-agent/
├── config.example.json     配置模板
├── plugins/                插件（.mjs，工具级接口）
│   ├── utility.mjs         示例：时间/计算/Base64
│   └── git.mjs             示例：Git 状态/日志/差异
├── skills/                 技能（SKILL.md，流程级接口）
│   ├── summarize-file/
│   └── commit-message/
├── public/index.html       Web 界面
├── src/
│   ├── index.js            入口与参数解析
│   ├── config.js           配置加载
│   ├── llm.js              模型客户端（流式 + Function Calling）
│   ├── agent.js            主循环：对话 ↔ 工具
│   ├── registry.js         工具与技能注册表
│   ├── permissions.js      权限与风险判定
│   ├── session.js          会话持久化
│   ├── utils.js            公共工具
│   ├── tools/              内置工具
│   ├── plugins/loader.js   插件加载器
│   └── ui/                 CLI 与 Web 界面
└── test/                   测试与 mock 模型服务
```

会话记录保存在 `.mini-agent/sessions/`。

---

## 安全说明

这个 Agent 能读写文件和执行命令，请当作一个**有权限的同事**而不是玩具：

- 默认每个中/高风险操作都要你点确认；`--auto` 会跳过全部确认，只在你完全信任任务时使用。
- `rm -rf /`、格式化磁盘、改注册表、关机等破坏性命令**即使开了 `--auto` 也会被硬拦截**。
- 写入类操作默认限制在 `workspace` 目录内；只读工具访问外部路径时会额外提示确认。
- Web 服务只监听 `127.0.0.1`，不对外暴露；服务端本身无鉴权，不要改绑到公网地址。

## License

MIT
