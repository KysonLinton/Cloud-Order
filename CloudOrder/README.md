# CloudOrder

一个**本地运行、零依赖**的 AI Agent。能和你自然对话，也能真正干活：读写文件、执行命令、抓网页、调用你写的插件和技能。

- **零依赖**：只用 Node.js 内置模块，`git clone` 后直接跑，不用 `npm install`
- **任意大模型**：OpenAI 兼容接口（OpenAI / DeepSeek / 通义 / Kimi / 智谱 / Ollama / LM Studio …）
- **插件接口**：丢一个 `.mjs` 文件进 `plugins/`，工具自动注册给模型
- **技能接口**：丢一个含 `SKILL.md` 的文件夹进 `skills/`，按需渐进式加载
- **本地衣柜**：衣物数据库（材质/颜色/图片…）由你录入，搭配只从衣柜中挑选
- **图片识别**：识别衣服照片，读出材质/颜色/版型等参数，一键录入衣柜
- **两种界面**：终端 CLI + 浏览器 Web（都支持流式输出和工具审批）
- **安全默认**：危险命令直接拦截，写文件/执行命令前必须确认

---

## 快速开始

需要 **Node.js ≥ 18.17**（推荐 22+，插件同步加载需要 22.12+）。

```powershell
cd CloudOrder
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

### 双击启动（Windows，无需命令行）

| 文件 | 作用 |
| --- | --- |
| `启动网页版.bat` | 一键启动 Web 界面并自动打开浏览器（默认 8787 端口） |
| `启动.bat` | 一键启动终端对话（CLI） |

直接**双击** `启动网页版.bat` 即可。特性：

- 已在运行时不重复启动，只把浏览器指向 `http://127.0.0.1:8787`
- 想换端口：把脚本拖进命令行并附带端口，如 `启动网页版.bat 9000`
- 缺少 Node.js 会给出明确提示

> 网页版服务端启动后**本身也会自动唤起浏览器**；`.bat` 只是省去手敲命令这一步。
> 两个脚本为 UTF-8 无 BOM + CRLF，中文在 cmd 窗口正常显示。

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

环境变量优先于配置文件：`CLOUDORDER_API_KEY`、`CLOUDORDER_BASE_URL`、`CLOUDORDER_MODEL`（旧前缀 `MINIAGENT_*` 仍向后兼容）
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
| `get_weather` | 低 | 实时天气 + 今日概况（免密钥，Open-Meteo） |
| `get_weather_forecast` | 低 | 未来 1-16 天预报（免密钥） |
| `geocode_city` | 低 | 城市名 → 经纬度/时区 |
| `get_ip_location` | 低 | 按公网 IP 获取大致地理位置（免密钥） |
| `wardrobe_list` | 低 | 查看「衣柜」中的衣物（可按类别/颜色/季节/风格/关键词筛选） |
| `wardrobe_get` | 低 | 读取某件单品的完整参数 |
| `wardrobe_add` | 中 | 新增衣物到衣柜（需确认） |
| `wardrobe_update` | 中 | 修改衣物参数（需确认） |
| `wardrobe_remove` | 高 | 删除衣物（需确认） |
| `analyze_image` | 低 | **识别图片**：`mode=clothing` 读出衣服的名称/类别/颜色/材质/风格/季节/版型/品牌等参数，可直接录入衣柜 |
| `load_skill` | 低 | 加载技能完整说明 |
| `list_skills` | 低 | 列出已安装技能 |

### 网页版位置/天气模块

网页版顶部有一个实时模块，自动展示**当前所在位置（精确到市/区级）**与**当日天气、气温**：

```
🌙 18°  晴
         📍 北京市 · 东城区   今日 10~22°C · 体感 19°C · 降水 0% · 风 东北 2 km/h · 湿度 67% · 紫外线 4.5
```

- 数据来源：IP 定位（ipwho.is）+ 反向地理编码（BigDataCloud，市/区级）+ 当日天气（Open-Meteo）
- 点击卡片即可刷新；鼠标悬停可看当天的「穿衣提示」
- 后端端点：`GET /api/location-weather`（返回结构化 JSON）

---

## 衣柜（Wardrobe）：本地衣物数据库

「穿搭管家」推荐搭配时**只会从你的衣柜里挑衣物**，不会凭空编造。衣柜初始为空，完全由你手动录入。

### 网页版录入入口

网页版右上角有 **「衣柜 (N)」按钮**（`N` 为当前单品数），点击展开右侧面板：

- 面板列出所有单品（缩略图 + 名称 + 类别/颜色/季节/风格标签），每张卡片可「编辑」或「删除」
- 「+ 添加衣物」打开录入弹窗，可填：

| 字段 | 说明 |
| --- | --- |
| 图片 | 点击方框上传（png/jpg/webp/gif，≤ 8MB） |
| 名称 * | 必填，如「白色府绸衬衫」 |
| 类别 | 衬衫 / 裤装 / 鞋 / 外套 …（可下拉选择） |
| 颜色 | 逗号分隔，如 `白, 米白` |
| 材质 | 如 棉 / 羊毛 / 真丝 |
| 风格 | 逗号分隔，如 `简约, 通勤` |
| 适合季节 | 勾选 春 / 夏 / 秋 / 冬 |
| 版型 / 尺码 / 品牌 / 备注 | 可选，填得越全，搭配越准 |

- **AI 识别图片**：录入弹窗里点「🔍 识别图片参数」，会调用多模态模型读出这件衣服的类别、颜色、材质、风格、季节、版型等，自动填进表单（识别不准的字段会提示你核对），核对后保存即可
- 深链接：浏览器打开 `#wardrobe` 直接展开面板，`#wardrobe/new` 同时打开录入弹窗

### 数据存放

```
.cloudorder/wardrobe/
  wardrobe.json     # 全部单品（JSON）
  images/           # 上传的衣物图片
```

整个 `.cloudorder/` 已在 `.gitignore` 中，不会进版本库。

### 关于搭配

- 模型在推荐前会先调 `wardrobe_list`，方案里每件单品都标注来源（名称/id），只从衣柜中挑
- 若理想方案需要衣柜里没有的单品，会单独列为「建议补充」，而不是假装衣柜里有
- 也可以直接用自然语言让管家帮你录入（如「帮我加一件藏青直筒西裤，羊毛混纺，秋冬穿」），它会调用 `wardrobe_add`

### 衣柜后端接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/wardrobe` | 列出全部单品 + 统计 + 可选类别/季节 |
| `POST` | `/api/wardrobe` | 新增单品（`image` 传 dataURL 自动存盘） |
| `PUT` | `/api/wardrobe/:id` | 修改单品（只传需改字段） |
| `DELETE` | `/api/wardrobe/:id` | 删除单品（连图片一并删） |
| `GET` | `/api/wardrobe/image/:file` | 读取衣物图片 |

---

## 图片识别（analyze_image）

内置 `analyze_image` 工具，调用**支持图片输入的多模态模型**，把一张衣服照片转成可直接录入「衣柜」的结构化参数。

### 用途

| 模式 | 说明 |
| --- | --- |
| `clothing`（默认） | 识别衣物，输出 JSON：`name` / `category` / `colors` / `material` / `style` / `seasons` / `fit` / `brand` / `tags` / `notes` / `confidence` / `unsure` |
| `describe` | 通用图片描述 |
| `custom` | 按 `prompt` 自定义分析（如「这件外套够不够保暖」「这身搭配协调吗」） |

### 三种用法

1. **聊天里附图**：网页版输入框左侧点「📎」选图片 → 图片会上传到工作区 `uploads/` → 管家自动用 `analyze_image` 识别（因可直接读工作区图片，不需要联网传输 base64）
2. **衣柜录入时识别**：衣柜弹窗点「🔍 识别图片参数」→ 识别结果自动填入表单 → 核对后保存
3. **工具直调**：`analyze_image` 的 `image` 参数可传
   - 工作区相对路径（如 `uploads/u_xxx.png`）或绝对路径
   - 衣柜图片（如 `images/<文件名>.png`）
   - `http(s)` 图片链接

### 模型要求（重要）

识别必须用**多模态**模型。配置项 `visionModel` 指定识别模型，留空则沿用主模型 `model`：

| 场景 | 建议 |
| --- | --- |
| 主模型本身支持图片（如 `deepseek-chat`、`gpt-4o-mini`、`qwen-vl-max`） | `visionModel` 留空即可 |
| 主模型不支持图片（如 `deepseek-v4-pro`、`moonshot-v1-8k`） | 把 `visionModel` 设为某个多模态模型 |

```jsonc
{
  "model": "deepseek-chat",
  "visionModel": ""   // 留空=沿用 model；可填 deepseek-flash / gpt-4o-mini / qwen-vl-max 等
}
```

> 模型若不支持图片输入，通常会在识别环节报错或返回空；此时请切换到多模态模型。

### 后端接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/upload` | 上传图片（`{image: "data:image/..."}`）→ 存 `uploads/` 返回路径 |
| `GET` | `/api/upload/:file` | 读回上传的图片 |
| `POST` | `/api/analyze-image` | 识别图片（`{image, mode?, prompt?, model?}`），返回 `{text, parsed}` |

---

## 天气查询（无需密钥）

内置三个天气工具，数据来自 [Open-Meteo](https://open-meteo.com)（实时不可用时自动回退到 wttr.in）：

```powershell
node src/index.js -p "北京今天多少度，适合穿什么"
```

| 工具 | 作用 |
| --- | --- |
| `get_weather` | 实时天气 + 今日温区/降水/紫外线，并附带一条「穿衣提示」 |
| `get_weather_forecast` | 未来 1-16 天预报（温度、天气、降水概率、风、紫外线） |
| `geocode_city` | 城市名解析为经纬度与时区，用于核对位置 |
| `get_ip_location` | 按本机公网 IP 获取城市、经纬度、时区（不传城市名时 `get_weather` 会自动调用它） |

不想报城市名时，直接说「按我的位置」即可：`get_weather` / `get_weather_forecast` 未传 `city` 时会自动用 IP 定位。IP 定位精度为**城市级**，且若开了代理/VPN，结果会是出口节点所在地。

```powershell
node src/index.js -p "不用我说城市，按我的位置看今天穿什么"
```

搭配技能 `weather-dressing` 使用：模型会先查真实天气（体感温度、降水、风、紫外线、温差），再按温度带与天气修正给出可执行方案。

---

## 写一个插件

在 `plugins/` 下新建 `quote.mjs`：

```js
export default {
  name: 'quote',
  description: '每日一言',
  systemPrompt: '你还能获取每日一言。',   // 可选：追加到系统提示

  tools: [
    {
      name: 'random_quote',
      description: '随机返回一条名言',
      parameters: { type: 'object', properties: {} },
      risk: 'low',              // low | medium | high
      safeByDefault: true,      // 低风险时免确认
      async run(args, ctx) {
        // ctx = { config, workspace, log, fetch, env }
        const res = await ctx.fetch('https://api.quotable.io/random');
        const json = await res.json();
        return `“${json.content}” —— ${json.author}`;
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
CloudOrder/
├── config.example.json     配置模板
├── plugins/                插件（.mjs，工具级接口）
│   ├── utility.mjs         示例：时间/计算/Base64
│   └── git.mjs             示例：Git 状态/日志/差异
├── skills/                 技能（SKILL.md，流程级接口）
│   ├── outfit-advice/      穿搭建议总入口（含风格索引）
│   ├── style-casual/       休闲风格
│   ├── style-business/     商务 / 通勤
│   ├── style-banquet/      宴会 / 正式
│   ├── style-sport/        运动 / 户外
│   ├── style-street/       街头潮流
│   ├── style-minimal/      极简
│   ├── style-vintage/      复古 / 学院
│   ├── style-date/         约会 / 社交
│   ├── style-resort/       度假 / 旅行
│   ├── weather-dressing/   结合天气的穿搭
│   ├── wardrobe-matching/  基于「衣柜」真实单品的搭配
│   ├── wardrobe-vision/    识别衣物图片，转成衣柜字段
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
│   ├── wardrobe.js         衣柜数据库（本地 JSON + 图片）
│   ├── tools/              内置工具（含 weather.js 天气、location.js IP 定位、wardrobe.js 衣柜、vision.js 图片识别）
│   ├── plugins/loader.js   插件加载器
│   └── ui/                 CLI 与 Web 界面
└── test/                   测试与 mock 模型服务
```

会话记录保存在 `.cloudorder/sessions/`，衣柜数据保存在 `.cloudorder/wardrobe/`。

---

## 安全说明

这个 Agent 能读写文件和执行命令，请当作一个**有权限的同事**而不是玩具：

- 默认每个中/高风险操作都要你点确认；`--auto` 会跳过全部确认，只在你完全信任任务时使用。
- `rm -rf /`、格式化磁盘、改注册表、关机等破坏性命令**即使开了 `--auto` 也会被硬拦截**。
- 写入类操作默认限制在 `workspace` 目录内；只读工具访问外部路径时会额外提示确认。
- Web 服务只监听 `127.0.0.1`，不对外暴露；服务端本身无鉴权，不要改绑到公网地址。

## License

MIT
