# AI 网页摘要助手

Chrome Manifest V3 扩展，在侧边栏中一键调用 AI 完成**网页摘要**与**简历优化**。无需构建工具，原生 JavaScript 直接加载即可使用。

**当前版本**：1.2.0 · **最低 Chrome 版本**：138+

## 功能概览

| 模式 | 说明 |
|------|------|
| **网页摘要** | 读取当前标签页正文，生成中文摘要，支持查看原文证据、复制结果 |
| **简历优化** | 上传本地 Markdown 简历，结合当前网页 JD 生成进取版 / 稳妥版简历、分析建议与对比报告 |
| **历史记录** | 两种模式各自保留最近 5 条本地历史，支持恢复查看、单条删除与一键清空 |

### AI 通道

- **OpenAI 兼容接口**：支持 DeepSeek、OpenAI、Kimi、智谱 GLM、通义千问、火山豆包等（通过设置页预设或手动填写）
- **Chrome 内置 Summarizer API**：本地摘要，无需 API Key（主要支持英语，中文质量有限）

> 简历优化仅支持远程 OpenAI 兼容接口，不支持 Chrome 内置 Summarizer。

## 快速开始

### 1. 安装扩展

1. 克隆或下载本项目到本地
2. 打开 Chrome，访问 `chrome://extensions`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择项目根目录
5. 点击工具栏图标，打开侧边栏

### 2. 配置 AI 服务

1. 在侧边栏点击 ⚙️，或右键扩展图标 →「选项」，进入设置页
2. 选择 **AI 来源**（OpenAI / Claude / Chrome 内置）
3. 若使用远程接口：
   - 在「服务商」下拉中选择预设（自动填入接口地址与默认模型）
   - 填写 **API Key**
   - 按需修改 API Base URL 和模型名称
4. 点击「保存设置」

**默认配置**（可在设置页恢复）：

```text
provider: openai
apiBase:  https://ark.cn-beijing.volces.com/api/coding
model:    doubao-seed-2.0-pro
```

> 火山豆包需在控制台创建推理接入点，模型名称填写 `ep-xxxx` 格式的接入点 ID。详见 `config/providers.json` 中的说明。

### 3. 使用网页摘要

1. 打开普通文章页（如新闻、博客）
2. 点击扩展图标打开侧边栏，确认处于「网页摘要」标签
3. 选择 AI 来源，点击「一键生成摘要」
4. 生成后可复制摘要，或展开「原文证据」查看提取正文

**不支持页面**：`chrome://`、`chrome-extension://` 等内置页会显示友好错误提示。

### 4. 使用简历优化

1. 切换到「简历优化」标签
2. 点击「上传/替换」，选择一份 `.md` 格式的 Markdown 简历
3. 打开招聘 JD 页面（如 BOSS 直聘、拉勾等）
4. 点击「根据当前网页生成简历优化」
5. 查看并切换：
   - **进取简历**：面向 ATS 与 HR 初筛，允许轻量包装与 JD 关键词对齐
   - **稳妥简历**：保守改写，每条陈述都能举证
   - **分析建议**与**对比报告**
6. 支持复制、下载简历与报告

> 生成会将本地简历和当前网页内容发送至你配置的 AI 服务，请注意隐私。

## 项目结构

```text
chrome_plugin_ai_demo/
├── manifest.json          # MV3 扩展声明
├── background.js          # Service Worker：消息路由、页面注入、AI 调用
├── content.js             # 页面正文提取（只读 DOM，不调用 AI）
├── sidepanel.html/css/js  # 侧边栏 UI 与交互
├── options.html/js        # 设置页
├── resume-prompts.js      # 简历优化提示词与输出契约
├── shared-utils.js        # 可测试的纯逻辑工具
├── config-loader.js       # 扩展内 JSON 配置加载
├── config/
│   └── providers.json     # AI 服务商预设
├── icons/                 # 16 / 48 / 128px 图标
├── tests/                 # Node.js 单元测试
└── docs/                  # 功能规格与设计文档
```

### 架构与数据流

```text
工具栏点击 → 打开侧边栏
  → 用户触发操作
  → sidepanel 发送消息（SUMMARIZE_ACTIVE_TAB / OPTIMIZE_RESUME_FOR_ACTIVE_TAB）
  → background 注入 content.js，调用 window.__AI_SUMMARY_EXTRACT__()
  → background 调用 AI Provider
  → sidepanel 渲染结果并写入本地历史
```

各层职责边界：

- `content.js`：只读页面 DOM，不访问 storage，不持有 API Key
- `background.js`：所有远程 AI 请求在此完成
- `sidepanel.js`：UI 状态、简历管理、消息通信、复制与下载
- `options.js`：设置读写

## 开发与测试

本项目**无构建步骤**，不依赖 npm 包。修改代码后在 `chrome://extensions` 点击扩展的「重新加载」即可。

### 运行单元测试

```powershell
node .\tests\shared-utils.test.js
node .\tests\resume-prompts.test.js
node .\tests\background-contract.test.js
node .\tests\providers-config.test.js
```

### 语法检查

```powershell
node --check .\background.js
node --check .\sidepanel.js
node --check .\content.js
node --check .\options.js
node --check .\shared-utils.js
node --check .\resume-prompts.js
```

### 手动验证清单

1. 在 `chrome://extensions` 以开发者模式加载 unpacked 扩展
2. 打开普通文章页，生成摘要，确认复制与历史记录
3. 打开 `chrome://settings` 等内置页，确认友好报错
4. 修改并保存设置，重新打开侧边栏，确认设置持久化
5. 上传 Markdown 简历，在招聘页生成优化结果，测试复制与下载
6. 测试 API Key 为空时的错误提示
7. 测试历史记录的恢复、单条删除与清空

更多开发约定见 [`AGENTS.md`](AGENTS.md)、[`CLAUDE.md`](CLAUDE.md)。

## 隐私与安全

- API Key、简历与历史记录仅保存在本机 `chrome.storage.local`
- 网页正文和简历只发送给你配置并选择的 AI 服务
- API Key 不会注入到页面上下文或写入仓库
- 页面内容渲染前均经转义处理，避免 XSS

## 已知限制

- 网页正文超过 12,000 字符时会截断，末尾追加 `...[内容过长已截断]`（UI 暂未提示截断状态）
- Chrome 内置 Summarizer 对中文摘要质量有限，侧边栏已注明
- 简历优化采用单次非流式请求，长页面生成可能耗时数分钟
- 历史记录每种模式最多 5 条，失败结果不入历史
- 关闭侧边栏后重新打开，进行中的任务状态不会恢复

## 更新日志

版本变更见 [`CHANGELOG.md`](CHANGELOG.md)。

## 相关文档

- [`CHANGELOG.md`](CHANGELOG.md) — 版本更新记录
- [`TODO.md`](TODO.md) — 待办事项
- [`docs/`](docs/) — 功能规格与实现计划
