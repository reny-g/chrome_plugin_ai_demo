# AI 网页摘要 Chrome 扩展设计文档

## 背景

该项目已包含一个最小化的 Chrome Manifest V3 扩展：

- `manifest.json` 声明了侧边栏扩展，权限包括 `storage`、`activeTab`、`scripting` 和 `sidePanel`。
- `background.js` 打开侧边栏、注入 `content.js`、提取页面文本，并调用 AI 提供商。
- `content.js` 提取当前页面标题、URL 和可读的正文文本。
- `sidepanel.html`、`sidepanel.css` 和 `sidepanel.js` 提供用户界面的摘要展示。
- `options.html` 和 `options.js` 在 `chrome.storage.local` 中存储提供商设置。

当前代码是一个有效的轻量级 MVP 架构。应该进行增量改进，而不是立即用大型构建系统替换它。

## 产品范围

第一个可用版本应该支持：

1. 从工具栏按钮打开扩展侧边栏。
2. 从活跃标签页提取可读文本。
3. 一键生成中文摘要。
4. 支持 OpenAI 兼容提供商和可选的 Chrome 内置 Summarizer API。
5. 本地存储提供商设置。
6. 显示加载、成功、复制和错误状态。

第一个版本不应包括登录、云端历史、账户同步、向量搜索或多页摘要。

## 推荐结构

为初始 MVP 保持当前无构建工具的 MV3 结构：

```text
chrome_plugin_ai_demo/
|-- manifest.json
|-- background.js
|-- content.js
|-- sidepanel.html
|-- sidepanel.css
|-- sidepanel.js
|-- options.html
|-- options.js
|-- icons/
`-- docs/
```

MVP 稳定工作后，迁移到类型化结构：

```text
extension/
|-- public/manifest.json
|-- src/background/
|-- src/content/
|-- src/sidepanel/
|-- src/options/
|-- src/shared/
`-- vite.config.ts

server/
|-- src/routes/
|-- src/services/
`-- .env.example
```

无构建工具结构在本地 Chrome 扩展开发中更快。类型化结构在提供商逻辑、测试和发布打包变得重要后更好。

## 架构

当前扩展应保持这些边界：

- `content.js`：仅读取活跃网页。不应调用 AI API 或访问设置。
- `background.js`：协调活跃标签查询、脚本注入、提取、设置加载和提供商调用。
- `sidepanel.js`：仅管理 UI 状态。它发送命令给 `background.js` 并渲染结果。
- `options.js`：仅管理设置持久化。

数据流：

```text
工具栏点击
  -> 侧边栏打开
  -> 用户点击摘要
  -> 侧边栏发送 SUMMARIZE_ACTIVE_TAB
  -> 后台注入提取器到活跃标签
  -> 后台调用选定的 AI 提供商
  -> 侧边栏渲染摘要
```

## 安全与隐私

当前本地密钥设计对个人使用是可接受的，但不适合公开发布。生产版本应倾向于后端代理，以便 API 密钥不存储在扩展中。

对当前 MVP：

- 在 `chrome.storage.local` 中保存 API 密钥。
- 不要向页面上下文注入 API 密钥。
- 仅使用 `chrome.scripting.executeScript` 运行提取器。
- 避免请求不必要的权限。
- 发布前添加清晰的隐私说明。

## 待修复的已知问题

1. 多个文件中的中文 UI 文本出现乱码，应重写为 UTF-8 文本。
2. 提供商命名不一致：`builtin`、`chrome-ai`、`openai` 和 `claude` 应标准化。
3. 默认 `apiBase` 指向 `https://ark.cn-beijing.volces.com/api/coding`，这可能不是正确的 OpenAI 兼容聊天完成基址。
4. 当前 OpenAI 兼容请求在扩展内部。对本地演示这是可接受的，但应在发布前移至后端。
5. 长页面被截断而不是分块。这对 MVP 很好，但应在 UI 中记录。
6. 基本手动测试步骤缺失。

## MVP 实现计划

1. 修复 `manifest.json`、`background.js`、`content.js`、`sidepanel.html`、`sidepanel.js`、`options.html` 和 `options.js` 中所有乱码的中文字符串。
2. 将提供商值标准化为 `openai-compatible` 和 `chrome-ai`。
3. 使默认设置明确和保守。
4. 改进不支持的浏览器页面、缺少 API 密钥、提供商失败和空提取内容的错误消息。
5. 添加 `README.md`，包含本地安装和测试步骤。
6. 添加 `docs/privacy.md`，描述选定 AI 提供商发送的页面内容。

## 验证

手动验证应涵盖：

1. 在 Chrome 中加载未打包的扩展。
2. 打开普通文章页面并生成摘要。
3. 打开浏览器内置页面并确认显示可读的不支持错误。
4. 保存设置，关闭侧边栏，重新打开它，并确认设置持久化。
5. 复制生成的摘要。
6. 尝试缺少 API 密钥和无效 API 基址的错误路径。
