# 简历优化提示词工程化与规则加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将简历优化提示词拆分为独立模块，并增加分层事实规则、防注入、JSON 示例、输出自检和版本诊断。

**Architecture:** 新增 UMD 模块 `resume-prompts.js`，由 Service Worker 直接加载并由 Node.js 测试导入。`shared-utils.js` 继续负责非提示词纯逻辑；`background.js` 负责加载提示词模块、构建消息并透传版本号，不改变第三方 OpenAI 兼容请求格式。

**Tech Stack:** Chrome Manifest V3、原生 JavaScript、Node.js `assert` 测试、PowerShell

---

### Task 1: 固化提示词模块契约

**Files:**
- Create: `tests/resume-prompts.test.js`
- Modify: `tests/shared-utils.test.js`

- [ ] **Step 1: 编写失败测试**

测试直接 `require('../resume-prompts')`，断言：

```js
assert.match(RESUME_PROMPT_VERSION, /^\d+\.\d+\.\d+$/);
assert.strictEqual(messages[0].role, 'system');
assert.strictEqual(messages[1].role, 'user');
assert.match(messages[0].content, /不可信数据/);
assert.match(messages[0].content, /不得把团队成果改写为候选人个人成果/);
assert.match(messages[0].content, /如实际使用过 Kubernetes/);
assert.match(messages[0].content, /"aspirationalResumeMarkdown"/);
assert.match(messages[0].content, /输出前在内部检查/);
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node .\tests\resume-prompts.test.js`

Expected: FAIL，错误为找不到 `../resume-prompts`。

- [ ] **Step 3: 从共享工具测试移除旧提示词导入和测试**

删除 `tests/shared-utils.test.js` 中对 `buildResumeOptimizationMessages` 的导入以及旧的提示词测试，避免同一职责由两个模块维护。

### Task 2: 实现独立提示词模块

**Files:**
- Create: `resume-prompts.js`
- Modify: `shared-utils.js`

- [ ] **Step 1: 实现 UMD 导出**

模块导出：

```js
{
  RESUME_PROMPT_VERSION,
  buildResumeOptimizationMessages,
}
```

- [ ] **Step 2: 按设计分层编写 system prompt**

加入任务目标、输入安全、事实规则、进阶版规则、稳妥版规则、结构保留、JSON 契约、精简示例和输出前自检。

- [ ] **Step 3: 保持 user prompt 动态输入格式**

继续拼接页面标题、URL、页面正文和原始 Markdown 简历，并为动态内容增加清晰的数据边界标记。

- [ ] **Step 4: 从 `shared-utils.js` 移除旧实现和导出**

`shared-utils.js` 不再拥有提示词职责。

- [ ] **Step 5: 运行提示词测试**

Run: `node .\tests\resume-prompts.test.js`

Expected: 全部 PASS。

### Task 3: 接入后台调用与版本诊断

**Files:**
- Create: `tests/background-contract.test.js`
- Modify: `background.js`

- [ ] **Step 1: 编写失败的后台静态契约测试**

读取 `background.js` 并断言：

```js
assert.ok(promptImportIndex < utilsImportIndex);
assert.match(source, /prompts\.buildResumeOptimizationMessages/);
assert.match(source, /promptVersion:\s*prompts\.RESUME_PROMPT_VERSION/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node .\tests\background-contract.test.js`

Expected: FAIL，因为后台尚未加载或调用提示词模块。

- [ ] **Step 3: 修改后台加载和调用链**

使用：

```js
importScripts('resume-prompts.js', 'shared-utils.js');
```

`optimizeResumeWithOpenAI()` 从 `self.ResumeOptimizerPrompts` 构建 messages。

- [ ] **Step 4: 透传版本号**

成功结果和解析错误结果增加：

```js
promptVersion: prompts.RESUME_PROMPT_VERSION
```

服务错误通过错误消息附加 `prompt_version=<version>`，日志记录同一版本号，不记录 prompt 内容。

- [ ] **Step 5: 运行后台契约测试**

Run: `node .\tests\background-contract.test.js`

Expected: 全部 PASS。

### Task 4: 同步文档和变更记录

**Files:**
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新文件职责和常用检查**

在 `AGENTS.md` 中增加 `resume-prompts.js` 和对应测试职责，并增加语法及测试命令。

- [ ] **Step 2: 更新变更记录**

在 `CHANGELOG.md` 的 `1.1.0` 优化项中记录提示词模块化、事实边界、防注入、JSON 示例和版本诊断。

### Task 5: 完整验证并提交

**Files:**
- Verify all changed files

- [ ] **Step 1: 执行测试和语法检查**

Run:

```powershell
node .\tests\resume-prompts.test.js
node .\tests\background-contract.test.js
node .\tests\shared-utils.test.js
node --check .\resume-prompts.js
node --check .\shared-utils.js
node --check .\background.js
node --check .\sidepanel.js
node --check .\content.js
node --check .\options.js
git diff --check
```

Expected: 全部退出码为 `0`。

- [ ] **Step 2: 自查差异和敏感信息**

确认没有 API Key、完整简历、网页内容或无关文件进入差异。

- [ ] **Step 3: 暂存本次范围文件并检查**

Run:

```powershell
git add AGENTS.md CHANGELOG.md background.js resume-prompts.js shared-utils.js tests/resume-prompts.test.js tests/background-contract.test.js tests/shared-utils.test.js docs/superpowers/specs/2026-06-09-resume-prompt-hardening-design.md docs/superpowers/plans/2026-06-09-resume-prompt-hardening.md
git diff --cached --check
```

Expected: 退出码为 `0`，且不包含 `CLAUDE.md`、`TODO.md`。

- [ ] **Step 4: 创建提交**

Run:

```powershell
git commit -m "feat: 加固简历优化提示词"
```
