# CLAUDE.md — AI 网页摘要助手

## 项目概述

Chrome Manifest V3 扩展，点击工具栏图标打开侧边栏，一键调用 AI 生成当前网页的中文摘要。

- **无构建工具**：原生 JS，直接加载到 Chrome，无 TypeScript、无 webpack/vite。
- **双 AI 通道**：OpenAI 兼容接口（远程）+ Chrome 内置 Summarizer API（本地）。
- **最低 Chrome 版本**：138+

## 文件职责

| 文件 | 职责 |
|------|------|
| `manifest.json` | MV3 声明，权限：storage / activeTab / scripting / sidePanel |
| `background.js` | Service Worker，消息路由、页面注入、AI 接口调用 |
| `content.js` | 注入到网页，只读取 title / url / 正文，不调用 API |
| `sidepanel.html/css/js` | 侧边栏 UI，发消息给 background，渲染摘要结果 |
| `options.html/js` | 设置页，读写 `chrome.storage.local` |
| `icons/` | 16 / 48 / 128px 图标 |
| `docs/` | 设计文档与规格说明 |

## 架构约束

**严格遵守各层职责边界，不要跨层调用：**

- `content.js` → 只读页面 DOM，禁止访问 settings 或调用 AI API
- `background.js` → 所有 AI 调用必须在此，**不能**直接调用 Chrome 内置 Summarizer（Service Worker 限制）
- `sidepanel.js` → 只管 UI 状态，通过 `chrome.runtime.sendMessage` 与 background 通信
- `options.js` → 只管设置读写

数据流：

```
toolbar click → side panel opens
→ user clicks "一键生成摘要"
→ sidepanel sends SUMMARIZE_ACTIVE_TAB (或 EXTRACT_ACTIVE_TAB)
→ background 注入 content.js，调用 window.__AI_SUMMARY_EXTRACT__()
→ background 调用 AI provider
→ sidepanel 渲染摘要
```

## Provider 命名规范

| 值 | 含义 |
|----|------|
| `openai` | OpenAI 兼容远程接口（含 Doubao / Claude 等） |
| `chrome-ai` | Chrome 内置 Summarizer API |

不使用 `builtin`、`claude`、`openai-compatible` 等其他名称。

## 默认设置

```js
{
  provider: 'openai',
  apiBase: 'https://ark.cn-beijing.volces.com/api/coding',
  apiKey: '',
  model: 'doubao-seed-2.0-pro',
}
```

## 编码规范

- **语言**：原生 ES2020+，禁止引入任何 npm 包或构建步骤
- **字符集**：所有文件 UTF-8，中文注释和 UI 文字必须保持可读（禁止乱码）
- **错误处理**：只在系统边界（AI 接口、页面注入、chrome API）处理错误，不过度防御
- **内容截断**：超过 12000 字符时截断并在末尾追加 `\n...[内容过长已截断]`
- **API Key 安全**：Key 只存 `chrome.storage.local`，禁止注入到页面 context

## 沟通偏好

- 回复语言：**中文**
- 代码风格：极简，避免过度工程化，不加无必要的抽象层
- 说明方式：结构化、对比表格、给出明确推荐 + 理由
- 不自动重构与当前任务无关的代码

## 文档规范

- **specs 文档语言**：`docs/` 目录下所有 specs / 设计文档（包括 `docs/superpowers/specs/` 等）必须使用**中文**撰写，包括标题、正文、表格、注释、示例说明等
- 代码块内的代码与变量名保持英文，但代码块前后的说明文字必须中文
- 已有英文 specs 文档在下次编辑时需逐步翻译为中文

## 已知待处理问题

1. Provider 标签在 `sidepanel.js` 中仍有 `'claude'` 残留，需统一为 `openai`
2. 默认 `apiBase` 指向 Doubao endpoint，settings 页应有清晰说明
3. 长页面截断未在 UI 中提示用户
4. 缺少手动测试步骤文档（`README.md`）
5. Chrome 内置 Summarizer 主要支持英语，中文摘要质量有限，UI 中应注明
6. 使用工具Get-Content时需要指定utf-8编码，否则会返回乱码内容

## 手动验证清单

1. 在 `chrome://extensions` 以开发者模式加载 unpacked 扩展
2. 打开普通文章页，点击图标，生成摘要
3. 打开 `chrome://settings` 等内置页，确认显示友好报错
4. 修改并保存设置，重新打开侧边栏，确认设置持久化
5. 测试复制按钮
6. 测试 API Key 为空时的错误提示
