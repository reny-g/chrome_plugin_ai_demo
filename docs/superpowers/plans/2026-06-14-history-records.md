# 历史记录功能实现计划

## Goal

为网页摘要和简历优化两种模式增加本地历史记录：每模式保留最近 5 条完整结果，顶部新增独立“历史”标签页，支持点击恢复、单条删除和一键清空。

## Constraints

- 原生 ES2020+，无构建步骤、无第三方依赖。
- 历史是纯前端 UI 状态，**不改动 `background.js`**。
- 纯逻辑放入 `shared-utils.js`（UMD 模块），用 Node `assert` 测试。
- 历史只存 `chrome.storage.local`，不发送、不写日志、不扩大权限。
- 仅保存成功结果；失败结果（`parseError` / 截断 / 接口错误）不入历史。
- UI 文案中文，复用现有 tab、按钮、结果区视觉风格。

## Context for implementer

实现前先读：

- 设计文档：`docs/superpowers/specs/2026-06-14-history-records-design.md`
- `shared-utils.js`：UMD 结构，末尾 `return { ... }` 统一导出；测试见 `tests/shared-utils.test.js`。
- `sidepanel.js`：`setMode(mode)`、`renderResult(data)`、`renderResumeOptimizationResult(data)`、`runSummarize` / `runResumeOptimization` 成功分支。
- `sidepanel.html`：`mode-tabs` 与各 `mode-panel` 结构。

## Tasks

### Task 1: shared-utils.js 历史纯函数（TDD）

- 先在 `tests/shared-utils.test.js` 写 `createEmptyHistory` / `buildHistoryEntry` / `appendHistoryEntry` / `removeHistoryEntry` 用例。
- 在 `shared-utils.js` 实现并导出，常量 `HISTORY_STORAGE_KEY = 'history'`、`HISTORY_LIMIT = 5`。
- 验证：`node tests/shared-utils.test.js`、`node --check shared-utils.js`。

### Task 2: sidepanel.html 增加“历史”tab 与面板

- `mode-tabs` 新增 `history-mode-tab`。
- 新增 `history-mode-panel`，含“清空全部”按钮、摘要与简历两个列表容器。

### Task 3: sidepanel.css 历史列表样式

- 条目、时间、删除按钮、空状态样式，沿用现有变量。

### Task 4: 成功生成后写入历史

- 启动读取历史；摘要与简历成功分支调用 `recordHistory`；`parseError` 不写入。
- 写入失败仅提示，不影响已展示结果。

### Task 5: 渲染历史面板与 tab 切换

- 扩展 `setMode` 支持 `'history'`；绑定 tab 与清空按钮；渲染两组列表，空数组显示空状态。

### Task 6: 点击恢复、单条删除、一键清空

- 点击条目恢复到对应模式；删除按钮阻止冒泡并移除；清空写入空结构。

### Task 7: 文档与端到端验证

- 更新 `CHANGELOG.md` 与 `manifest.json` 版本到 1.2.0。
- 真实 Chrome 端到端验证。

## Verification

```powershell
node tests/shared-utils.test.js
node --check shared-utils.js
node --check sidepanel.js
git diff --check
```

端到端（真实 Chrome）：生成→历史可见→重开侧边栏仍在→点击恢复→满 5 条淘汰→删除/清空同步→失败不入历史→原有两模式不受影响。

## Notes

- 风险：摘要 `data` 含整页正文，5 条上限下体积可控。
- 恢复简历历史时对比报告基于当前简历计算，历史未存原始简历快照（见设计文档“已知边界”）。
- `sidepanel.html` 的 `claude` provider option 属遗留项，不在本计划范围。
