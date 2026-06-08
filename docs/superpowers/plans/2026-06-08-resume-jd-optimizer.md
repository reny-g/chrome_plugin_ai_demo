# JD Resume Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resume optimization mode to the existing Chrome MV3 side panel extension while preserving the current web summary mode.

**Architecture:** Keep the no-build extension structure. Add a small shared utility file for pure logic that can be tested with Node and loaded by both the side panel and the background service worker. Implement Phase 1 for local resume management and mode switching, then Phase 2 for JD extraction, AI JSON generation, rendering, copy, and Markdown downloads.

**Tech Stack:** Chrome Manifest V3, plain JavaScript, HTML, CSS, `chrome.storage.local`, `chrome.scripting`, OpenAI-compatible chat completions, Node built-in `assert` for pure utility tests.

---

## File Structure

- Create: `shared-utils.js`
  - UMD-style utility module for storage keys, Markdown upload validation, filename sanitization, Markdown download filename generation, AI JSON parsing, and analysis report Markdown generation.
  - Must work in three environments: side panel page via `<script>`, service worker via `importScripts`, and Node tests via `require`.
- Create: `tests/shared-utils.test.js`
  - Node-based test file using built-in `assert`.
  - Verifies pure logic before UI wiring.
- Modify: `sidepanel.html`
  - Add `shared-utils.js` before `sidepanel.js`.
  - Add mode tabs, resume management controls, resume preview, generation controls, and resume optimization result sections.
- Modify: `sidepanel.css`
  - Add compact styles for mode tabs, resume metadata, result cards/sections, warnings, preview, and action rows.
- Modify: `sidepanel.js`
  - Preserve summary behavior.
  - Add mode switching, resume upload/view/clear, resume optimization generation, JSON-result rendering, copy, and download actions.
- Modify: `background.js`
  - Load `shared-utils.js` with `importScripts`.
  - Add `OPTIMIZE_RESUME_FOR_ACTIVE_TAB`.
  - Read saved resume, extract active page, build prompt, call AI, parse result, and return normalized data or raw fallback.
- Modify: `docs/superpowers/specs/2026-06-08-resume-jd-optimizer-design.md`
  - Only if implementation reveals a spec mismatch that must be corrected. Do not overwrite the user's Chinese translation.

## Task 1: Add Shared Utility Module And Tests

**Files:**
- Create: `shared-utils.js`
- Create: `tests/shared-utils.test.js`

- [ ] **Step 1: Create the failing utility tests**

Create `tests/shared-utils.test.js` with this content:

```javascript
const assert = require('assert');
const utils = require('../shared-utils.js');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('validateMarkdownFileMeta accepts non-empty .md files', () => {
  const result = utils.validateMarkdownFileMeta({ name: 'resume.md' }, '# Resume');
  assert.deepStrictEqual(result, { ok: true });
});

test('validateMarkdownFileMeta rejects non-Markdown files', () => {
  const result = utils.validateMarkdownFileMeta({ name: 'resume.txt' }, '# Resume');
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Markdown|md/i);
});

test('validateMarkdownFileMeta rejects empty Markdown files', () => {
  const result = utils.validateMarkdownFileMeta({ name: 'resume.md' }, '   \n\t');
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /empty|空/i);
});

test('buildResumeRecord stores required metadata', () => {
  const record = utils.buildResumeRecord('resume.md', '# Resume', '2026-06-08T08:00:00.000Z');
  assert.strictEqual(record.fileName, 'resume.md');
  assert.strictEqual(record.markdown, '# Resume');
  assert.strictEqual(record.updatedAt, '2026-06-08T08:00:00.000Z');
  assert.strictEqual(record.length, 8);
});

test('sanitizeBaseName removes unsafe filename characters', () => {
  assert.strictEqual(utils.sanitizeBaseName('my/resume:java*.md'), 'my-resume-java');
  assert.strictEqual(utils.sanitizeBaseName('   '), 'resume');
});

test('buildDownloadFileName includes base, kind, and date', () => {
  const name = utils.buildDownloadFileName('my resume.md', 'grounded', new Date('2026-06-08T10:00:00Z'));
  assert.strictEqual(name, 'my-resume-grounded-2026-06-08.md');
});

test('parseAiResumeResponse parses direct JSON', () => {
  const parsed = utils.parseAiResumeResponse(JSON.stringify({
    jdAnalysis: { isLikelyJobDescription: true, confidence: 'high' },
    aspirationalResumeMarkdown: '# A',
    groundedResumeMarkdown: '# B',
    gapSuggestions: [],
    warnings: []
  }));
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.data.aspirationalResumeMarkdown, '# A');
});

test('parseAiResumeResponse parses fenced JSON', () => {
  const parsed = utils.parseAiResumeResponse('```json\\n{"jdAnalysis":{},"aspirationalResumeMarkdown":"# A","groundedResumeMarkdown":"# B","gapSuggestions":[],"warnings":[]}\\n```');
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.data.groundedResumeMarkdown, '# B');
});

test('parseAiResumeResponse reports missing required resume fields', () => {
  const parsed = utils.parseAiResumeResponse('{"jdAnalysis":{},"gapSuggestions":[],"warnings":[]}');
  assert.strictEqual(parsed.ok, false);
  assert.match(parsed.error, /aspirationalResumeMarkdown/);
  assert.strictEqual(parsed.raw.includes('jdAnalysis'), true);
});

test('buildAnalysisMarkdown creates a downloadable report', () => {
  const md = utils.buildAnalysisMarkdown({
    jdAnalysis: {
      isLikelyJobDescription: false,
      confidence: 'low',
      jobTitle: 'Unknown',
      requiredSkills: ['JavaScript']
    },
    gapSuggestions: [{ area: '项目', reason: 'JD 要求复杂前端项目', suggestion: '补充可验证项目经历' }],
    warnings: ['页面可能不是 JD']
  });
  assert.match(md, /# JD 分析与补充建议/);
  assert.match(md, /JavaScript/);
  assert.match(md, /页面可能不是 JD/);
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```powershell
node .\tests\shared-utils.test.js
```

Expected:

```text
Error: Cannot find module '../shared-utils.js'
```

If `node` is not installed, record that pure utility tests cannot run and continue with manual verification for this task.

- [ ] **Step 3: Implement `shared-utils.js`**

Create `shared-utils.js` with this content:

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ResumeOptimizerUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const RESUME_STORAGE_KEY = 'resumeMarkdownProfile';

  function validateMarkdownFileMeta(file, markdown) {
    const name = file && file.name ? String(file.name) : '';
    if (!/\.md$/i.test(name)) {
      return { ok: false, error: '请上传 .md Markdown 简历文件' };
    }
    if (!String(markdown || '').trim()) {
      return { ok: false, error: 'Markdown 简历内容为空' };
    }
    return { ok: true };
  }

  function buildResumeRecord(fileName, markdown, nowIso) {
    const text = String(markdown || '');
    return {
      markdown: text,
      fileName: String(fileName || 'resume.md'),
      updatedAt: nowIso || new Date().toISOString(),
      length: text.length,
    };
  }

  function sanitizeBaseName(fileName) {
    const withoutExt = String(fileName || 'resume').replace(/\.[^.]+$/, '');
    const clean = withoutExt
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return clean || 'resume';
  }

  function buildDownloadFileName(fileName, kind, date) {
    const d = date instanceof Date ? date : new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${sanitizeBaseName(fileName)}-${kind}-${yyyy}-${mm}-${dd}.md`;
  }

  function stripJsonFence(raw) {
    const text = String(raw || '').trim();
    const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : text;
  }

  function parseAiResumeResponse(raw) {
    const source = String(raw || '');
    let parsed;
    try {
      parsed = JSON.parse(stripJsonFence(source));
    } catch (error) {
      return { ok: false, error: `AI 返回内容不是有效 JSON：${error.message}`, raw: source };
    }

    const missing = [];
    if (!parsed || typeof parsed !== 'object') missing.push('rootObject');
    if (!parsed.aspirationalResumeMarkdown) missing.push('aspirationalResumeMarkdown');
    if (!parsed.groundedResumeMarkdown) missing.push('groundedResumeMarkdown');
    if (missing.length) {
      return { ok: false, error: `AI JSON 缺少必需字段：${missing.join(', ')}`, raw: source };
    }

    return {
      ok: true,
      data: {
        jdAnalysis: parsed.jdAnalysis || {},
        aspirationalResumeMarkdown: String(parsed.aspirationalResumeMarkdown),
        groundedResumeMarkdown: String(parsed.groundedResumeMarkdown),
        gapSuggestions: Array.isArray(parsed.gapSuggestions) ? parsed.gapSuggestions : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      },
    };
  }

  function listMarkdown(title, values) {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!items.length) return `## ${title}\n\n无\n`;
    return `## ${title}\n\n${items.map((item) => `- ${String(item)}`).join('\n')}\n`;
  }

  function buildAnalysisMarkdown(data) {
    const jd = data && data.jdAnalysis ? data.jdAnalysis : {};
    const gaps = Array.isArray(data && data.gapSuggestions) ? data.gapSuggestions : [];
    const warnings = Array.isArray(data && data.warnings) ? data.warnings : [];
    const lines = [
      '# JD 分析与补充建议',
      '',
      `- 是否像 JD：${jd.isLikelyJobDescription === false ? '否' : '是/不确定'}`,
      `- 置信度：${jd.confidence || '未提供'}`,
      `- 岗位名称：${jd.jobTitle || '未提供'}`,
      '',
      listMarkdown('核心职责', jd.coreResponsibilities),
      listMarkdown('必备技能', jd.requiredSkills),
      listMarkdown('加分技能', jd.preferredSkills),
      listMarkdown('软技能', jd.softSkills),
      listMarkdown('关键词', jd.keywords),
      '## 缺口建议',
      '',
      gaps.length
        ? gaps.map((gap) => `- ${gap.area || '未分类'}：${gap.suggestion || ''}${gap.reason ? `（原因：${gap.reason}）` : ''}`).join('\n')
        : '无',
      '',
      listMarkdown('警告', warnings),
    ];
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  return {
    RESUME_STORAGE_KEY,
    validateMarkdownFileMeta,
    buildResumeRecord,
    sanitizeBaseName,
    buildDownloadFileName,
    parseAiResumeResponse,
    buildAnalysisMarkdown,
  };
});
```

- [ ] **Step 4: Run tests and confirm they pass**

Run:

```powershell
node .\tests\shared-utils.test.js
```

Expected:

```text
PASS validateMarkdownFileMeta accepts non-empty .md files
PASS validateMarkdownFileMeta rejects non-Markdown files
PASS validateMarkdownFileMeta rejects empty Markdown files
PASS buildResumeRecord stores required metadata
PASS sanitizeBaseName removes unsafe filename characters
PASS buildDownloadFileName includes base, kind, and date
PASS parseAiResumeResponse parses direct JSON
PASS parseAiResumeResponse parses fenced JSON
PASS parseAiResumeResponse reports missing required resume fields
PASS buildAnalysisMarkdown creates a downloadable report
```

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add .\shared-utils.js .\tests\shared-utils.test.js
git commit -m "test: add resume optimizer shared utilities"
```

## Task 2: Add Side Panel Mode Shell And Resume Management

**Files:**
- Modify: `sidepanel.html`
- Modify: `sidepanel.css`
- Modify: `sidepanel.js`

- [ ] **Step 1: Update `sidepanel.html` with mode and resume sections**

Add `<script src="shared-utils.js"></script>` before `sidepanel.js`.

Add these elements while preserving the existing summary elements and IDs:

```html
<div class="mode-tabs" role="tablist" aria-label="功能模式">
  <button id="summary-mode-tab" class="mode-tab active" type="button">网页摘要</button>
  <button id="resume-mode-tab" class="mode-tab" type="button">简历优化</button>
</div>

<section id="summary-mode-panel" class="mode-panel">
  <!-- keep the current summary button, status, result, and source evidence here -->
</section>

<section id="resume-mode-panel" class="mode-panel hidden">
  <section class="panel-block">
    <div class="section-heading">
      <h2>当前简历</h2>
      <span id="resume-status-tag" class="tag">未上传</span>
    </div>
    <p id="resume-meta" class="muted">上传一份 Markdown 简历后，可以根据当前网页 JD 生成优化版本。</p>
    <div class="action-row">
      <input id="resume-file-input" class="hidden" type="file" accept=".md,text/markdown,text/plain" />
      <button id="upload-resume-btn" type="button">上传/替换</button>
      <button id="view-resume-btn" type="button" disabled>查看</button>
      <button id="clear-resume-btn" type="button" disabled>清除</button>
    </div>
    <pre id="resume-preview" class="markdown-preview hidden"></pre>
  </section>

  <section class="panel-block">
    <div class="section-heading">
      <h2>生成</h2>
    </div>
    <p class="privacy-note">点击生成后，会将本地简历和当前网页内容发送给已配置的 AI 提供方。</p>
    <button id="optimize-resume-btn" type="button" disabled>根据当前网页生成简历优化</button>
  </section>

  <section id="resume-result-area" class="hidden"></section>
</section>
```

- [ ] **Step 2: Add compact CSS**

Add styles to `sidepanel.css`:

```css
.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 12px 0;
}

.mode-tab {
  border: 1px solid #d0d7de;
  background: #fff;
  color: #24292f;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.mode-tab.active {
  background: #0969da;
  border-color: #0969da;
  color: #fff;
}

.mode-panel.hidden,
.hidden {
  display: none !important;
}

.panel-block {
  border-top: 1px solid #d8dee4;
  padding: 12px 0;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-heading h2 {
  font-size: 15px;
  margin: 0;
}

.tag {
  border: 1px solid #d0d7de;
  border-radius: 999px;
  color: #57606a;
  font-size: 12px;
  padding: 2px 8px;
  white-space: nowrap;
}

.muted,
.privacy-note {
  color: #57606a;
  font-size: 12px;
  line-height: 1.5;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.markdown-preview {
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  color: #24292f;
  font-size: 12px;
  line-height: 1.5;
  margin-top: 10px;
  max-height: 220px;
  overflow: auto;
  padding: 10px;
  white-space: pre-wrap;
}
```

- [ ] **Step 3: Wire mode switching and resume storage in `sidepanel.js`**

Extend the existing `els` map with:

```javascript
summaryModeTab: $('summary-mode-tab'),
resumeModeTab: $('resume-mode-tab'),
summaryModePanel: $('summary-mode-panel'),
resumeModePanel: $('resume-mode-panel'),
resumeStatusTag: $('resume-status-tag'),
resumeMeta: $('resume-meta'),
resumeFileInput: $('resume-file-input'),
uploadResumeBtn: $('upload-resume-btn'),
viewResumeBtn: $('view-resume-btn'),
clearResumeBtn: $('clear-resume-btn'),
resumePreview: $('resume-preview'),
optimizeResumeBtn: $('optimize-resume-btn'),
resumeResult: $('resume-result-area'),
```

Add these functions:

```javascript
const resumeUtils = window.ResumeOptimizerUtils;
let savedResume = null;

function setMode(mode) {
  const isResume = mode === 'resume';
  els.summaryModeTab.classList.toggle('active', !isResume);
  els.resumeModeTab.classList.toggle('active', isResume);
  els.summaryModePanel.classList.toggle('hidden', isResume);
  els.resumeModePanel.classList.toggle('hidden', !isResume);
}

async function loadSavedResume() {
  const stored = await chrome.storage.local.get({ [resumeUtils.RESUME_STORAGE_KEY]: null });
  savedResume = stored[resumeUtils.RESUME_STORAGE_KEY];
  renderResumeState();
}

function renderResumeState() {
  const hasResume = Boolean(savedResume && savedResume.markdown);
  els.resumeStatusTag.textContent = hasResume ? '已保存' : '未上传';
  els.resumeMeta.textContent = hasResume
    ? `${savedResume.fileName} · ${savedResume.length.toLocaleString()} 字符 · ${new Date(savedResume.updatedAt).toLocaleString()}`
    : '上传一份 Markdown 简历后，可以根据当前网页 JD 生成优化版本。';
  els.viewResumeBtn.disabled = !hasResume;
  els.clearResumeBtn.disabled = !hasResume;
  els.optimizeResumeBtn.disabled = !hasResume;
  if (!hasResume) {
    els.resumePreview.classList.add('hidden');
    els.resumePreview.textContent = '';
  }
}

async function handleResumeUpload(file) {
  const markdown = await file.text();
  const validation = resumeUtils.validateMarkdownFileMeta(file, markdown);
  if (!validation.ok) {
    showStatus(validation.error, 'error');
    return;
  }
  savedResume = resumeUtils.buildResumeRecord(file.name, markdown);
  await chrome.storage.local.set({ [resumeUtils.RESUME_STORAGE_KEY]: savedResume });
  renderResumeState();
  showStatus('简历已保存到浏览器本地。', 'success');
}

async function clearSavedResume() {
  await chrome.storage.local.remove(resumeUtils.RESUME_STORAGE_KEY);
  savedResume = null;
  renderResumeState();
  showStatus('已清除本地简历。', 'success');
}
```

Add event listeners:

```javascript
els.summaryModeTab.addEventListener('click', () => setMode('summary'));
els.resumeModeTab.addEventListener('click', () => setMode('resume'));
els.uploadResumeBtn.addEventListener('click', () => els.resumeFileInput.click());
els.resumeFileInput.addEventListener('change', async () => {
  const [file] = els.resumeFileInput.files || [];
  if (file) await handleResumeUpload(file);
  els.resumeFileInput.value = '';
});
els.viewResumeBtn.addEventListener('click', () => {
  if (!savedResume) return;
  els.resumePreview.textContent = savedResume.markdown;
  els.resumePreview.classList.toggle('hidden');
});
els.clearResumeBtn.addEventListener('click', clearSavedResume);
loadSavedResume();
```

- [ ] **Step 4: Manually verify Phase 1**

Run Chrome with the unpacked extension and verify:

```text
1. Summary mode is visible by default.
2. Summary generation still calls the existing flow.
3. Resume mode can be selected.
4. Uploading resume.md stores metadata.
5. Closing and reopening the side panel keeps metadata.
6. View toggles the Markdown preview.
7. Clear removes metadata and disables generate.
8. Uploading resume.txt shows an error.
9. Uploading an empty .md file shows an error.
```

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add .\sidepanel.html .\sidepanel.css .\sidepanel.js
git commit -m "feat: add resume mode and local resume management"
```

## Task 3: Add Background AI Resume Optimization Flow

**Files:**
- Modify: `background.js`
- Modify: `shared-utils.js`
- Modify: `tests/shared-utils.test.js`

- [ ] **Step 1: Add prompt construction tests**

Append to `tests/shared-utils.test.js`:

```javascript
test('buildResumeOptimizationMessages includes JD, resume, and safety rules', () => {
  const messages = utils.buildResumeOptimizationMessages({
    pageTitle: 'Senior Frontend Engineer',
    pageUrl: 'https://example.com/jobs/1',
    pageContent: 'React TypeScript performance',
    resumeMarkdown: '# Resume\\nJavaScript'
  });
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].role, 'system');
  assert.strictEqual(messages[1].role, 'user');
  assert.match(messages[0].content, /只输出有效 JSON/);
  assert.match(messages[0].content, /不要添加原简历中不存在的事实/);
  assert.match(messages[1].content, /Senior Frontend Engineer/);
  assert.match(messages[1].content, /React TypeScript performance/);
  assert.match(messages[1].content, /# Resume/);
});
```

- [ ] **Step 2: Run tests and confirm the new test fails**

Run:

```powershell
node .\tests\shared-utils.test.js
```

Expected:

```text
TypeError: utils.buildResumeOptimizationMessages is not a function
```

- [ ] **Step 3: Add prompt construction to `shared-utils.js`**

Add this function before the returned API object:

```javascript
function buildResumeOptimizationMessages(input) {
  const pageTitle = input.pageTitle || '';
  const pageUrl = input.pageUrl || '';
  const pageContent = input.pageContent || '';
  const resumeMarkdown = input.resumeMarkdown || '';
  const system = [
    '你是严谨的中文简历优化助手。',
    '只输出有效 JSON，不要输出 Markdown 代码围栏，不要输出解释性前后缀。',
    '生成两份完整 Markdown 简历：aspirationalResumeMarkdown 和 groundedResumeMarkdown。',
    '尽量保留原简历的结构、标题风格、列表粒度和语气。',
    '不要在原始结构可用时把简历完全转换为另一套模板。',
    '进阶版本中，缺失的技能、项目、成果或经历必须标注为 [待补充：具体内容]。',
    '基于原始的版本中，不要添加原简历中不存在的事实，包括公司、项目、日期、技能、职责、年限、指标。',
    '可以通过重写、排序、强调和换角度提升清晰性、相关性、关键词覆盖。',
    '如果网页不像 JD、JD 信息弱或源内容被截断，必须写入 warnings。',
    'JSON 字段必须包括 jdAnalysis、aspirationalResumeMarkdown、groundedResumeMarkdown、gapSuggestions、warnings。',
  ].join('\\n');
  const user = [
    '# 当前网页',
    `标题：${pageTitle}`,
    `URL：${pageUrl}`,
    '',
    '## 网页正文/JD 候选内容',
    pageContent,
    '',
    '# 原始 Markdown 简历',
    resumeMarkdown,
  ].join('\\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
```

Add `buildResumeOptimizationMessages` to the returned API object.

- [ ] **Step 4: Run tests and confirm they pass**

Run:

```powershell
node .\tests\shared-utils.test.js
```

Expected: all tests print `PASS`.

- [ ] **Step 5: Load shared utils in `background.js`**

At the top of `background.js`, add:

```javascript
try {
  importScripts('shared-utils.js');
} catch (error) {
  console.error('[bg] failed to load shared-utils.js:', error);
}
```

- [ ] **Step 6: Add message route in `background.js`**

Inside `chrome.runtime.onMessage.addListener`, add:

```javascript
if (message?.type === 'OPTIMIZE_RESUME_FOR_ACTIVE_TAB') {
  handleResumeOptimization()
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
}
```

- [ ] **Step 7: Add background resume optimization functions**

Add these functions to `background.js`:

```javascript
async function handleResumeOptimization() {
  const utils = self.ResumeOptimizerUtils;
  if (!utils) throw new Error('简历优化工具未加载');

  const pageData = await extractActiveTab();
  const settings = await loadSettings();
  const stored = await chrome.storage.local.get({ [utils.RESUME_STORAGE_KEY]: null });
  const resume = stored[utils.RESUME_STORAGE_KEY];
  if (!resume?.markdown) throw new Error('请先上传 Markdown 简历');

  const pageLimit = 12000;
  const resumeLimit = 20000;
  const pageWasTruncated = pageData.content.length > pageLimit;
  const resumeWasTruncated = resume.markdown.length > resumeLimit;
  const pageContent = pageWasTruncated ? pageData.content.slice(0, pageLimit) + '\n...[页面内容过长已截断]' : pageData.content;
  const resumeMarkdown = resumeWasTruncated ? resume.markdown.slice(0, resumeLimit) + '\n...[简历内容过长已截断]' : resume.markdown;

  const raw = await optimizeResumeWithOpenAI({
    pageTitle: pageData.title,
    pageUrl: pageData.url,
    pageContent,
    resumeMarkdown,
    settings,
  });
  const parsed = utils.parseAiResumeResponse(raw);

  if (!parsed.ok) {
    return {
      title: pageData.title,
      url: pageData.url,
      provider: settings.provider || 'openai',
      parseError: parsed.error,
      rawOutput: parsed.raw,
      warnings: [
        pageWasTruncated ? '页面内容过长，已截断后发送给 AI。' : '',
        resumeWasTruncated ? '简历内容过长，已截断后发送给 AI。' : '',
      ].filter(Boolean),
    };
  }

  const warnings = Array.isArray(parsed.data.warnings) ? parsed.data.warnings.slice() : [];
  if (pageWasTruncated) warnings.push('页面内容过长，已截断后发送给 AI。');
  if (resumeWasTruncated) warnings.push('简历内容过长，已截断后发送给 AI。');

  return {
    title: pageData.title,
    url: pageData.url,
    provider: settings.provider || 'openai',
    resumeFileName: resume.fileName,
    ...parsed.data,
    warnings,
  };
}

async function optimizeResumeWithOpenAI({ pageTitle, pageUrl, pageContent, resumeMarkdown, settings }) {
  const utils = self.ResumeOptimizerUtils;
  const { apiBase, apiKey, model } = settings;
  if (!apiKey) throw new Error('请先在设置页填写 API Key');

  const resp = await fetch(`${apiBase.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: utils.buildResumeOptimizationMessages({ pageTitle, pageUrl, pageContent, resumeMarkdown }),
      temperature: 0.2,
      stream: false,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`AI 接口调用失败 (${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 响应格式异常，未拿到简历优化内容');
  return content;
}
```

- [ ] **Step 8: Manually verify background route with extension reload**

Reload the unpacked extension. In the side panel console or by using the future UI route, confirm this message returns an error if no resume exists:

```javascript
chrome.runtime.sendMessage({ type: 'OPTIMIZE_RESUME_FOR_ACTIVE_TAB' }).then(console.log)
```

Expected:

```javascript
{ ok: false, error: '请先上传 Markdown 简历' }
```

- [ ] **Step 9: Commit Task 3**

Run:

```powershell
git add .\background.js .\shared-utils.js .\tests\shared-utils.test.js
git commit -m "feat: add resume optimization background flow"
```

## Task 4: Render Resume Optimization Results And Downloads

**Files:**
- Modify: `sidepanel.js`
- Modify: `sidepanel.css`

- [ ] **Step 1: Add result rendering helpers to `sidepanel.js`**

Add:

```javascript
let lastResumeResult = null;

function downloadMarkdown(fileName, markdown) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function renderResumeOptimizationResult(data) {
  lastResumeResult = data;
  els.resumeResult.classList.remove('hidden');

  if (data.parseError) {
    els.resumeResult.innerHTML = `
      <section class="result-block warning-block">
        <h2>格式异常</h2>
        <p>${escapeHtml(data.parseError)}</p>
      </section>
      <section class="result-block">
        <h2>AI 原始输出</h2>
        <pre class="markdown-preview">${escapeHtml(data.rawOutput || '')}</pre>
      </section>
    `;
    return;
  }

  const analysisMarkdown = resumeUtils.buildAnalysisMarkdown(data);
  const aspirationalName = resumeUtils.buildDownloadFileName(data.resumeFileName, 'aspirational');
  const groundedName = resumeUtils.buildDownloadFileName(data.resumeFileName, 'grounded');
  const analysisName = resumeUtils.buildDownloadFileName(data.resumeFileName || 'resume', 'analysis');

  els.resumeResult.innerHTML = `
    <section class="result-block">
      <div class="section-heading">
        <h2>JD 分析与建议</h2>
        <button id="download-analysis-btn" type="button">下载分析</button>
      </div>
      <div class="markdown-body-lite">${renderMarkdown(analysisMarkdown)}</div>
    </section>
    <section class="result-block">
      <div class="section-heading">
        <h2>进阶简历</h2>
        <div class="action-row compact">
          <button id="copy-aspirational-btn" type="button">复制</button>
          <button id="download-aspirational-btn" type="button">下载</button>
        </div>
      </div>
      <div class="markdown-body-lite">${renderMarkdown(data.aspirationalResumeMarkdown)}</div>
    </section>
    <section class="result-block">
      <div class="section-heading">
        <h2>基于原始的简历</h2>
        <div class="action-row compact">
          <button id="copy-grounded-btn" type="button">复制</button>
          <button id="download-grounded-btn" type="button">下载</button>
        </div>
      </div>
      <div class="markdown-body-lite">${renderMarkdown(data.groundedResumeMarkdown)}</div>
    </section>
  `;

  $('copy-aspirational-btn').addEventListener('click', () => navigator.clipboard.writeText(data.aspirationalResumeMarkdown));
  $('download-aspirational-btn').addEventListener('click', () => downloadMarkdown(aspirationalName, data.aspirationalResumeMarkdown));
  $('copy-grounded-btn').addEventListener('click', () => navigator.clipboard.writeText(data.groundedResumeMarkdown));
  $('download-grounded-btn').addEventListener('click', () => downloadMarkdown(groundedName, data.groundedResumeMarkdown));
  $('download-analysis-btn').addEventListener('click', () => downloadMarkdown(analysisName, analysisMarkdown));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
```

- [ ] **Step 2: Add generate action to `sidepanel.js`**

Add:

```javascript
async function runResumeOptimization() {
  if (!savedResume?.markdown) {
    showStatus('请先上传 Markdown 简历。', 'error');
    return;
  }

  els.optimizeResumeBtn.disabled = true;
  els.resumeResult.classList.add('hidden');
  showStatus('正在读取当前网页并生成简历优化...', 'loading');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'OPTIMIZE_RESUME_FOR_ACTIVE_TAB' });
    if (!response?.ok) throw new Error(response?.error || '未知错误');
    renderResumeOptimizationResult(response.data);
    hideStatus();
  } catch (error) {
    showStatus('生成简历优化失败：' + (error?.message || error), 'error');
  } finally {
    els.optimizeResumeBtn.disabled = false;
  }
}

els.optimizeResumeBtn.addEventListener('click', runResumeOptimization);
```

- [ ] **Step 3: Add result CSS**

Append to `sidepanel.css`:

```css
.result-block {
  border-top: 1px solid #d8dee4;
  padding: 12px 0;
}

.warning-block {
  background: #fff8c5;
  border: 1px solid #d4a72c;
  border-radius: 6px;
  margin-top: 10px;
  padding: 10px;
}

.markdown-body-lite {
  color: #24292f;
  font-size: 13px;
  line-height: 1.55;
}

.markdown-body-lite h1 {
  font-size: 18px;
}

.markdown-body-lite h2 {
  font-size: 15px;
  margin-top: 14px;
}

.markdown-body-lite h3 {
  font-size: 14px;
  margin-top: 12px;
}

.markdown-body-lite ul {
  padding-left: 20px;
}

.action-row.compact {
  margin-top: 0;
}
```

- [ ] **Step 4: Manually verify Phase 2 happy path**

Use a real or local JD-like page and a Markdown resume:

```text
1. Upload resume.md.
2. Open a JD-like page.
3. Click generate.
4. Confirm JD analysis appears.
5. Confirm aspirational resume is complete Markdown.
6. Confirm grounded resume is complete Markdown.
7. Confirm copy buttons write expected text to clipboard.
8. Confirm download buttons save .md files with readable names.
```

- [ ] **Step 5: Manually verify fallback states**

Verify:

```text
1. Missing API key shows settings-related error.
2. Browser internal page shows unsupported-page extraction error.
3. Non-JD page still returns output with visible warnings.
4. Invalid JSON response path displays raw output and format error.
```

For invalid JSON, temporarily set `optimizeResumeWithOpenAI()` to return `'not json'`, reload the extension, verify fallback UI, then restore the function before commit.

- [ ] **Step 6: Commit Task 4**

Run:

```powershell
git add .\sidepanel.js .\sidepanel.css
git commit -m "feat: render resume optimization results"
```

## Task 5: Final Verification And Documentation Check

**Files:**
- Modify only if needed after verification: `docs/superpowers/specs/2026-06-08-resume-jd-optimizer-design.md`
- Modify only if needed after verification: `docs/superpowers/plans/2026-06-08-resume-jd-optimizer.md`

- [ ] **Step 1: Run pure utility tests**

Run:

```powershell
node .\tests\shared-utils.test.js
```

Expected: all tests print `PASS`.

- [ ] **Step 2: Run static syntax checks where possible**

Run:

```powershell
node --check .\shared-utils.js
node --check .\tests\shared-utils.test.js
```

Expected:

```text
No output and exit code 0 for both commands.
```

If `node --check` cannot parse extension files because of Chrome globals, check only `shared-utils.js` and the test file.

- [ ] **Step 3: Complete manual Chrome extension checklist**

Verify this complete checklist:

```text
1. Extension loads without console syntax errors.
2. Web summary mode still works.
3. Resume mode appears and keeps provider/settings controls available.
4. .md upload, view, replace, clear all work.
5. Resume metadata persists across side panel reopen.
6. Generate is blocked before resume upload.
7. JD-like page generates two complete resumes.
8. Aspirational resume uses [待补充：...] for unsupported gaps.
9. Grounded resume avoids unsupported facts.
10. Copy and download actions work for both resumes.
11. Analysis report download works.
12. Non-JD page shows warning.
13. Invalid JSON fallback shows raw output.
14. Truncation warnings are visible when limits are exceeded.
```

- [ ] **Step 4: Check git status**

Run:

```powershell
git status --short
```

Expected:

```text
Only intentional modified or untracked files remain.
```

Do not revert unrelated untracked files already present in the repository.

- [ ] **Step 5: Final commit if verification changed documentation**

If documentation was updated during final verification, run:

```powershell
git add .\docs\superpowers\specs\2026-06-08-resume-jd-optimizer-design.md .\docs\superpowers\plans\2026-06-08-resume-jd-optimizer.md
git commit -m "docs: update resume optimizer implementation notes"
```

If no documentation changed, do not create an empty commit.

## Self-Review

Spec coverage:

- Preserve summary mode: Task 2 and Task 5.
- One local Markdown resume: Task 2.
- Upload/replace/view/clear: Task 2.
- Any page as JD input: Task 3 and Task 4.
- Two complete Markdown resumes: Task 3 and Task 4.
- `[待补充：...]` rule: Task 3 prompt and Task 5 verification.
- Grounded version factual constraint: Task 3 prompt and Task 5 verification.
- Preserve original resume format: Task 3 prompt.
- Copy and download actions: Task 4.
- JD analysis, gap suggestions, warnings: Task 3 and Task 4.
- Non-JD warning and JSON fallback: Task 3, Task 4, and Task 5.

Placeholder scan:

- No `TBD`, `TODO`, `implement later`, or vague "add error handling" steps are used.
- Each code-changing task includes concrete code or exact UI markup.

Type consistency:

- Utility key is `RESUME_STORAGE_KEY`.
- Storage value key is `resumeMarkdownProfile`.
- AI result fields are `jdAnalysis`, `aspirationalResumeMarkdown`, `groundedResumeMarkdown`, `gapSuggestions`, and `warnings`.
- Message type is `OPTIMIZE_RESUME_FOR_ACTIVE_TAB`.
