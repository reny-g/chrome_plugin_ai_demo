````markdown
# JD Resume Optimizer Chrome Extension Design（职位描述-简历优化器 Chrome 扩展 设计）

## 背景

当前项目是一个轻量级的 Chrome Manifest V3 扩展。它可以打开侧边面板，从活动标签页提取可读文本，并调用兼容 OpenAI 的 API 来生成中文网页摘要。

本设计将扩展该扩展为双模式工具：

- 网页摘要模式：保留现有的页面摘要工作流。
- 简历优化模式：上传一个 Markdown 简历，将活动页面视为可能的职位描述（JD），并生成两个优化后的 Markdown 简历版本。

MVP 应保持增量演进。应重用当前无构建文件结构，并避免引入后端、账户系统、构建管线或站点特定的抓取规则。

## 目标

1. 保留现有的页面摘要功能。
2. 添加一个本地的 Markdown 简历，存储在 `chrome.storage.local` 中。
3. 允许用户上传、替换、查看和清除当前简历。
4. 即使页面不是已知招聘网站，也能把活动网页作为 JD 输入。
5. 要求 AI 分析 JD 并生成两份完整的 Markdown 简历：
   - 进阶（Aspirational）简历：尽量接近 JD，但对缺失或不支持的内容用明确的 `[待补充：...]` 占位标注。
   - 基于原始（Grounded）简历：仅改进原简历支持的内容，主要通过重写、强调、顺序和角度调整。
6. 优化后的简历应尽量贴近原始简历的 Markdown 结构、章节顺序、标题风格、列表粒度和写作风格，除非确有必要做小幅调整。
7. 为两种生成的简历提供复制和下载操作。
8. 清晰展示 JD 分析、缺口建议和警告信息。

## 非目标

1. MVP 中不做多简历管理。
2. 不做云存储、登录、账户同步或版本历史。
3. MVP 中不添加 Boss 直聘、拉勾、猎聘等站点特定的抽取规则。
4. 此阶段不使用后端代理来转发 AI 请求。
5. 不支持 PDF/DOCX 简历导入或导出。
6. 不做自动投递或浏览器表单自动填写功能。

## 推荐方法

继续使用当前扩展结构并增量添加功能：

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

职责保持分明：

- `content.js`：只负责提取活动页面标题、URL 与可读文本。
- `background.js`：路由消息、读取设置、读取保存的简历、提取活动页面、构建 prompt、调用 AI 提供方并返回规范化结果。
- `sidepanel.js`：管理 UI 状态、简历上传/查看/清除动作、模式切换、渲染、复制与下载动作。
- `options.js`：继续管理提供方设置。
- `chrome.storage.local`：存储提供方设置和一份当前简历。

## 分阶段范围

### 第 1 阶段：本地简历管理与模式切换

第 1 阶段在不加入 AI 生成的情况下添加简历模式框架。

必需行为：

1. 在侧边面板中添加模式切换：`网页摘要` 和 `简历优化`。
2. 在 `网页摘要` 保留现有的摘要工作流。
3. 添加一个 `简历优化` 面板，显示当前简历状态。
4. 允许上传 `.md` 文件。
5. 拒绝空文件和非 Markdown 文件。
6. 将简历保存在 `chrome.storage.local`。
7. 至少存储：
   - `markdown`
   - `fileName`
   - `updatedAt`
   - `length`
8. 刷新或重新打开侧边面板后显示已保存的简历元数据。
9. 允许在侧边面板查看已保存的简历。
10. 允许替换和清除已保存的简历。
11. 在未存在简历前禁用或阻止生成操作。

第 1 阶段验收标准：

1. 现有摘要模式仍可用。
2. 可以上传并在本地持久化一份 Markdown 简历。
3. 简历可以查看、替换与清除。
4. 缺失简历时状态清晰并可操作。

### 第 2 阶段：JD 简历优化生成

第 2 阶段将简历模式与活动页面抽取和 AI 生成连接起来。

必需行为：

1. 添加新的消息类型，例如 `OPTIMIZE_RESUME_FOR_ACTIVE_TAB`。
2. `background.js` 通过：
   - 使用现有的 `extractActiveTab()` 提取活动页面。
   - 从 `chrome.storage.local` 读取已保存简历。
   - 加载提供方设置。
   - 调用兼容 OpenAI 的 chat completion API。
3. prompt 必须要求模型返回一个包含如下字段的 JSON 字符串：
   - `jdAnalysis`
   - `aspirationalResumeMarkdown`
   - `groundedResumeMarkdown`
   - `gapSuggestions`
   - `warnings`
4. 结果 UI 渲染：
   - JD 分析
   - 进阶（Aspirational）简历
   - 基于原始（Grounded）简历
   - 缺口建议与警告
5. 每个生成的简历应包含：
   - 复制按钮
   - 下载为 `.md` 按钮
6. 分析和建议可选地导出为 Markdown 报告。
7. 如果页面看起来不像 JD，仍允许生成，但必须可见警告。
8. 如果 JSON 解析失败，显示 AI 原始输出并给出明确的格式错误信息。
9. 如果页面内容或简历内容被截断，包含警告。

第 2 阶段验收标准：

1. 类似 JD 的页面能生成两份完整的 Markdown 简历。
2. 进阶简历对不被原简历支持的内容使用 `[待补充：...]` 标注。
3. 基于原始的简历不会杜撰公司、项目、日期、技能、职责或不在原简历中的指标。
4. 两份生成的简历都可复制和下载。
5. 非 JD 页面显示警告但不强制阻止生成。
6. JSON 解析失败不会导致结果区域空白。

## AI 输出约定

AI 的回应应为 JSON 字符串。扩展应在渲染前解析该字符串。

期望结构：

```json
{
  "jdAnalysis": {
    "isLikelyJobDescription": true,
    "confidence": "high",
    "jobTitle": "string",
    "coreResponsibilities": ["string"],
    "requiredSkills": ["string"],
    "preferredSkills": ["string"],
    "softSkills": ["string"],
    "keywords": ["string"]
  },
  "aspirationalResumeMarkdown": "string",
  "groundedResumeMarkdown": "string",
  "gapSuggestions": [
    {
      "area": "string",
      "reason": "string",
      "suggestion": "string"
    }
  ],
  "warnings": ["string"]
}
```

解析器应在实用范围内容忍轻微的结构差异，但缺失简历字段会导致正常渲染失败，应回退到显示原始输出。

## Prompt 规则

简历优化的 prompt 必须包含以下规则：

1. 只输出有效 JSON。
2. 使用中文，除非源简历明显使用其它语言。
3. 生成两份完整的 Markdown 简历。
4. 尽量保留原简历的结构、标题风格、列表粒度和语气。
5. 不要在原始结构可用时把简历完全转换为另一套模板。
6. 在进阶版本中，缺失的技能、项目、成果或经历必须标注为 `[待补充：具体内容]`。
7. 在基于原始的版本中，不要添加原简历中不存在的事实。
8. 重写可以提升清晰性、相关性、关键词覆盖和表述角度。
9. 如果 JD 弱、不完整或不是明确的 JD，应在 `warnings` 中说明。
10. 如果源内容被截断，应在 `warnings` 中说明。

## 数据流

摘要模式：

```text
User clicks summarize
-> sidepanel sends SUMMARIZE_ACTIVE_TAB
-> background extracts active tab
-> background calls AI
-> sidepanel renders summary
```

简历优化模式：

```text
User uploads Markdown resume
-> sidepanel stores resume in chrome.storage.local
-> user opens a JD or any page
-> user clicks generate resume optimization
-> sidepanel sends OPTIMIZE_RESUME_FOR_ACTIVE_TAB
-> background extracts active tab
-> background reads saved resume and provider settings
-> background calls AI with JD text, resume text, and output rules
-> background parses or returns raw output state
-> sidepanel renders analysis, two resumes, suggestions, warnings, copy actions, and download actions
```

## UI 设计

侧边面板应保持紧凑的操作布局。

顶部控件：

- 模式切换：`网页摘要` / `简历优化`
- 提供方选择
- 设置链接

摘要模式：

- 保留当前摘要按钮和结果布局。
- 保留来源证据和复制操作。

简历优化模式：

- 当前简历区：
  - 文件名
  - 更新时间
  - 字符数
  - 上传/替换按钮
  - 查看按钮
  - 清除按钮
- 生成区：
  - 生成按钮
  - 提取或生成后的当前页面标题与 URL
  - 状态与错误信息
- 结果区：
  - JD 分析
  - 进阶简历
  - 基于原始的简历
  - 缺口建议与警告

结果操作：

- 复制进阶简历
- 下载进阶简历
- 复制基于原始的简历
- 下载基于原始的简历
- 下载分析与建议报告

下载文件名应确定且可读，例如：

- `resume-aspirational-2026-06-08.md`
- `resume-grounded-2026-06-08.md`
- `resume-analysis-2026-06-08.md`

如果原始文件名可用，可在消毒后用作基名。

## 错误处理

扩展应处理以下状态：

1. 无已保存简历：提示上传 Markdown 简历。
2. 非 Markdown 上传：以明确信息拒绝。
3. 空文件上传：以明确信息拒绝。
4. 不支持的活动页面：复用当前活动页抽取的错误处理。
5. 提取到的页面内容为空：复用当前抽取失败处理。
6. 缺少 API key：提示用户配置提供方设置。
7. AI 请求失败：显示提供方状态和可用的简短响应摘录。
8. 无效的 AI JSON：显示 AI 原始输出并提示格式错误。
9. 缺少必需的 AI 字段：显示 AI 原始输出并说明缺失字段。
10. 内容被截断：在结果区域显示警告。

## 隐私与安全

简历保存在 `chrome.storage.local` 中。扩展不进行同步或上传，除非用户触发 AI 生成。

当触发简历优化时，扩展会把已保存的简历和提取的页面内容发送给配置的 AI 提供方。UI 或文档应在生成操作附近或之前明确告知这一点。

扩展不应把 API key 注入到活动页面。API key 保留在扩展存储中，仅由扩展脚本使用。

AI 不应被要求捏造经历。进阶版本可对缺失内容使用显式占位，基于原始的版本必须忠实于源内容。

## 验证计划

由于当前扩展没有构建系统或测试框架，手动验证对 MVP 足够。

第 1 阶段检查：

1. 在 Chrome 中加载 unpacked extension。
2. 打开侧边面板并确认摘要模式仍然可见。
3. 切换到简历模式。
4. 上传有效的 `.md` 简历并确认显示元数据。
5. 关闭并重新打开侧边面板，确认元数据持久存在。
6. 查看简历内容。
7. 替换简历并确认元数据更新。
8. 清除简历并确认生成被阻止。
9. 上传非 Markdown 文件并确认被拒绝。
10. 上传空的 Markdown 文件并确认被拒绝。

第 2 阶段检查：

1. 配置一个可用的兼容 OpenAI 的提供方。
2. 上传 Markdown 简历。
3. 打开类 JD 页面并生成简历优化。
4. 确认渲染 JD 分析、两份完整简历、建议与警告。
5. 确认进阶简历对不支持的缺口使用 `[待补充：...]` 标注。
6. 确认基于原始的简历不杜撰不支持的事实。
7. 复制两份生成简历。
8. 下载两份生成的简历为 `.md`。
9. 打开非 JD 页面，生成并确认出现可见警告。
10. 强制或模拟无效 JSON 并确认回退到显示原始输出。

## 后续工作

1. 多简历管理。
2. 针对常见招聘站点的站点特定 JD 抽取器。
3. 用于 API key 保护的后端代理。
4. PDF/DOCX 导出。
5. 在提取纯逻辑后，为 prompt 构建、JSON 解析和 Markdown 下载助手编写单元测试，并实现自动差异查看功能。

````