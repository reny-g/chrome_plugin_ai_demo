# 历史记录功能设计

## 背景

当前网页摘要和简历优化的生成结果都不持久化，关闭侧边栏后结果即丢失。简历优化是重量级请求（通常 1–3 分钟、消耗较多 token），结果丢失后需要重新调用 AI，代价最高。用户希望保留最近的生成结果，便于回看和复用，避免重复请求。

## 目标

- 为网页摘要和简历优化两种模式提供本地历史记录。
- 每条历史保存完整结果，点击可完整恢复到对应模式的结果区。
- 每种模式各保留最近 5 条，超出自动淘汰最旧记录。
- 顶部新增独立“历史”标签页，集中展示两种模式的记录。
- 支持单条删除和一键清空全部。
- 每次成功生成后自动写入历史。

## 非目标

- 不引入构建步骤或第三方依赖。
- 不改动 `background.js`（历史是纯前端 UI 状态）。
- 不修改现有 provider 设置和简历存储结构。
- 不持久化失败结果（格式异常 / 截断 / 接口错误不入历史）。
- 不提供历史搜索、导出、跨设备同步。
- 不扩大 `manifest.json` 权限。

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `shared-utils.js` | 纯逻辑：构建历史条目、限长追加（保留最近 5）、按 id 删除、清空。无 DOM 与 chrome API 依赖，可 Node 测试 |
| `sidepanel.js` | 成功生成后写入历史；渲染“历史”标签页；点击恢复时切回对应模式并复用现有渲染函数；处理删除与清空 |
| `sidepanel.html` | 新增“历史”tab 及历史面板容器 |
| `sidepanel.css` | 历史列表与条目样式，沿用现有视觉风格 |

## 存储结构

采用单 key 聚合对象，一次读写拿到全部历史。

```js
HISTORY_STORAGE_KEY = 'history'
// 值结构：
{
  summary: [entry, ...],  // 最多 5 条，最新在前
  resume:  [entry, ...]   // 最多 5 条，最新在前
}
```

## 数据模型

每条历史条目结构：

```js
{
  id: string,         // 时间戳 + 随机串，用于删除定位
  mode: 'summary' | 'resume',
  title: string,      // 页面标题，列表展示用，缺失时回退为 URL 或“(无标题)”
  url: string,
  createdAt: string,  // ISO 时间字符串
  data: { ... }       // 原样保存生成时传给 render 函数的完整 data 对象
}
```

`data` 字段直接保存生成时的结果对象：摘要模式为 `renderResult` 的入参，简历模式为 `renderResumeOptimizationResult` 的入参。恢复时把 `data` 交给对应 render 函数即可，不需要额外渲染逻辑。

## 数据流

```
生成成功
  → sidepanel 构建 entry
  → 纯函数 appendHistoryEntry(history, mode, entry)（限长 5，最新在前）
  → chrome.storage.local.set({ history })

切换到“历史”tab
  → 读取 chrome.storage.local 中 history
  → 渲染摘要、简历两个分区列表

点击某条历史
  → 切换到对应模式 tab
  → 调用 renderResult(entry.data) 或 renderResumeOptimizationResult(entry.data)

单条删除
  → 纯函数 removeHistoryEntry(history, mode, id)
  → 写回 storage → 重渲染列表

一键清空
  → 纯函数 createEmptyHistory()
  → 写回 storage → 重渲染列表
```

## 纯函数契约（shared-utils.js）

| 函数 | 输入 | 输出 / 行为 |
| --- | --- | --- |
| `buildHistoryEntry(mode, data)` | 模式、结果 data | 返回带 id、title、url、createdAt、data 的条目 |
| `appendHistoryEntry(history, mode, entry)` | 历史对象、模式、新条目 | 返回新历史对象，新条目置顶，该模式数组裁剪到最多 5 条 |
| `removeHistoryEntry(history, mode, id)` | 历史对象、模式、id | 返回移除指定条目后的新历史对象 |
| `createEmptyHistory()` | 无 | 返回 `{ summary: [], resume: [] }` |

所有函数不修改入参，返回新对象，避免共享状态副作用。

## UI 设计

- 顶部 `mode-tabs` 增加第三个 tab：“历史”。
- 历史面板分两个区：“网页摘要”和“简历优化”，各自展示该模式最近 5 条。
- 每个条目展示：标题、本地时间；右侧提供“删除”按钮。
- 面板顶部提供“清空全部”按钮。
- 列表为空时展示空状态文案（如“暂无历史记录”）。
- 点击条目主体区域触发恢复，点击“删除”不触发恢复。

## 错误处理与边界

- storage 写入失败：提示“历史保存失败”，不影响当前已展示的生成结果。
- 仅保存成功解析的结果；简历优化的 `parseError`（格式异常）、截断、接口错误不入历史。
- 历史为空：列表区显示空状态文案。
- 标题缺失：回退为 URL，再回退为“(无标题)”。
- 容量：每模式 5 条上限可将总体积控制在百 KB 级，无需 `unlimitedStorage` 权限。
- 页面内容与简历属于敏感数据，历史只存于本地 `chrome.storage.local`，不发送、不写日志。

## 测试

`tests/shared-utils.test.js` 新增用例：

- `buildHistoryEntry` 生成的条目字段完整、title 回退正确。
- `appendHistoryEntry` 新条目置顶，且第 6 条挤掉最旧（保留最近 5）。
- `appendHistoryEntry` 不修改入参（返回新对象）。
- `removeHistoryEntry` 按 id 正确移除，不影响另一模式。
- `createEmptyHistory` 返回独立空结构。

UI 恢复、tab 切换、storage 持久化、删除与清空交互使用真实 Chrome 手动验证。

## 已知边界

恢复简历历史时，“下载对比报告”会基于当前保存的简历计算差异（历史未单独存原始简历快照）。若需对比报告完全还原历史当时的简历，需后续把原始 markdown 一并存入历史条目。
