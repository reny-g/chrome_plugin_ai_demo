# Resume Comparison Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为进阶简历和稳妥简历分别生成只供下载的 Markdown 对比报告，报告包含简洁优化摘要、经过本地核验的逐段原文/优化后对照、JD 对应关系和事实风险。

**Architecture:** 保持现有单次 AI 请求，在响应中增加两个可选的结构化变更说明字段。`shared-utils.js` 负责字段归一化、Markdown 分块、本地差异、AI 说明合并和报告 Markdown 构建；`background.js` 只负责 prompt 和字段透传；`sidepanel.js` 在用户点击时按需构建并下载报告，不把报告正文插入 DOM。

**Tech Stack:** Chrome Extension Manifest V3、原生 JavaScript、Node.js `assert` 测试、Markdown 文本处理、Blob 下载。

---

## File Structure

- Modify: `shared-utils.js`
  - 增加可选 AI 变更说明解析。
  - 增加 Markdown 分块、规范化、相似度比较、本地差异识别。
  - 增加 AI 说明与本地差异合并。
  - 增加两类对比报告 Markdown 构建。
- Modify: `tests/shared-utils.test.js`
  - 为所有纯逻辑新增 TDD 测试。
- Modify: `background.js`
  - 将新字段加入 prompt 契约并透传到 sidepanel。
- Modify: `sidepanel.js`
  - 增加两个“下载对比报告”按钮和按需报告构建。
  - 报告失败不影响已有简历展示、复制和下载。
- Modify: `sidepanel.css`
  - 让增加按钮后的操作区可换行，保持窄侧边栏可用。
- No change required: `sidepanel.html`
  - 结果区是动态渲染的，按钮应由 `sidepanel.js` 生成。

## Data Contracts

统一使用以下结构：

```js
const changeSummary = {
  summary: ['强化 RAG 项目中的端到端交付能力'],
  changes: [{
    section: '项目经历 / RAG 知识库',
    original: '负责知识库问答系统开发。',
    optimized: '负责基于 LangChain 和向量数据库构建 RAG 知识库问答系统。',
    reason: '突出 JD 要求的 RAG 和端到端交付能力。',
    jdMatch: ['RAG', '端到端交付'],
    factStatus: 'strengthened',
  }],
};
```

本地差异统一使用以下结构：

```js
const diffEntry = {
  section: '项目经历 / RAG 知识库',
  type: 'modified',
  original: '负责知识库问答系统开发。',
  optimized: '负责基于 LangChain 和向量数据库构建 RAG 知识库问答系统。',
  originalIndex: 3,
  optimizedIndex: 3,
};
```

合并后的报告项统一使用以下结构：

```js
const reportChange = {
  ...diffEntry,
  reason: '突出 JD 要求的 RAG 和端到端交付能力。',
  jdMatch: ['RAG', '端到端交付'],
  factStatus: 'strengthened',
};
```

---

### Task 1: Extend The Optional AI Change-Summary Contract

**Files:**
- Modify: `tests/shared-utils.test.js`
- Modify: `shared-utils.js`
- Modify: `background.js`

- [ ] **Step 1: Write failing tests for prompt requirements**

在 `tests/shared-utils.test.js` 的 prompt 测试后增加：

```js
test('buildResumeOptimizationMessages requests compact change summaries for both versions', () => {
  const messages = buildResumeOptimizationMessages({
    pageContent: 'JD',
    resumeMarkdown: '# Resume',
  });
  const prompt = messages.map((message) => message.content).join('\n');

  assert.match(prompt, /aspirationalChangeSummary/);
  assert.match(prompt, /groundedChangeSummary/);
  assert.match(prompt, /最多 20/);
  assert.match(prompt, /rephrased/);
  assert.match(prompt, /placeholder/);
  assert.match(prompt, /只描述有实质变化/);
});
```

- [ ] **Step 2: Write failing tests for optional-field normalization**

从 `shared-utils.js` 引入 `normalizeChangeSummary`，增加：

```js
test('normalizeChangeSummary keeps valid entries and rejects invalid enum values', () => {
  const result = normalizeChangeSummary({
    summary: ['强化 RAG 经验', 42],
    changes: [{
      section: '项目经历',
      original: '负责问答系统。',
      optimized: '负责 RAG 问答系统。',
      reason: '匹配 JD。',
      jdMatch: ['RAG'],
      factStatus: 'strengthened',
    }, {
      section: '技能',
      original: 'Java',
      optimized: 'Java, Go',
      reason: '扩展技能。',
      jdMatch: [],
      factStatus: 'invented',
    }],
  });

  assert.deepStrictEqual(result.summary, ['强化 RAG 经验']);
  assert.strictEqual(result.changes.length, 1);
  assert.strictEqual(result.changes[0].factStatus, 'strengthened');
});

test('parseAiResumeResponse treats change summaries as optional enhancements', () => {
  const result = parseAiResumeResponse(JSON.stringify({
    jdAnalysis: {
      isLikelyJobDescription: true,
      confidence: 'high',
      jobTitle: 'AI 工程师',
      coreResponsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      softSkills: [],
      keywords: [],
    },
    aspirationalResumeMarkdown: '# A',
    groundedResumeMarkdown: '# G',
  }));

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.aspirationalChangeSummary, { summary: [], changes: [] });
  assert.deepStrictEqual(result.groundedChangeSummary, { summary: [], changes: [] });
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
node .\tests\shared-utils.test.js
```

Expected: FAIL because `normalizeChangeSummary` is not exported and the prompt does not mention the new fields.

- [ ] **Step 4: Implement compact prompt requirements**

在 `buildResumeOptimizationMessages()` 的 system prompt 中加入：

```js
'还必须返回 aspirationalChangeSummary 和 groundedChangeSummary；它们是可选增强字段，但应尽量完整。',
'每个 change summary 包含 summary(string[]) 和 changes(array)。',
'每个 change 包含 section、original、optimized、reason、jdMatch(string[])、factStatus。',
'factStatus 仅允许 rephrased、strengthened、reordered、removed、placeholder、risk。',
'只描述有实质变化的段落，不要列出仅空格、标点或 Markdown 格式变化的内容。',
'每个版本最多 20 个 changes，优先保留对 JD 匹配影响最大的修改，说明保持简洁。',
```

同步更新 JSON 字段说明，使其包含：

```text
aspirationalChangeSummary、groundedChangeSummary
```

- [ ] **Step 5: Implement optional-field normalization**

在 `shared-utils.js` 中增加：

```js
const CHANGE_FACT_STATUSES = new Set([
  'rephrased',
  'strengthened',
  'reordered',
  'removed',
  'placeholder',
  'risk',
]);

function normalizeChangeSummary(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const summary = (Array.isArray(source.summary) ? source.summary : [])
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim());
  const changes = (Array.isArray(source.changes) ? source.changes : [])
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .filter((item) => CHANGE_FACT_STATUSES.has(item.factStatus))
    .filter((item) =>
      typeof item.section === 'string' &&
      typeof item.original === 'string' &&
      typeof item.optimized === 'string' &&
      typeof item.reason === 'string'
    )
    .slice(0, 20)
    .map((item) => ({
      section: item.section.trim(),
      original: item.original.trim(),
      optimized: item.optimized.trim(),
      reason: item.reason.trim(),
      jdMatch: (Array.isArray(item.jdMatch) ? item.jdMatch : [])
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => entry.trim()),
      factStatus: item.factStatus,
    }));

  return { summary, changes };
}
```

在 `parseAiResumeResponse()` 成功结果中增加：

```js
aspirationalChangeSummary: normalizeChangeSummary(data.aspirationalChangeSummary),
groundedChangeSummary: normalizeChangeSummary(data.groundedChangeSummary),
```

并导出 `normalizeChangeSummary`。

- [ ] **Step 6: Pass optional fields through the background result**

在 `background.js` 的成功返回对象中增加：

```js
aspirationalChangeSummary: parsed.aspirationalChangeSummary,
groundedChangeSummary: parsed.groundedChangeSummary,
```

不要把这两个字段加入核心 required-field 校验。

- [ ] **Step 7: Run tests and syntax checks**

Run:

```powershell
node .\tests\shared-utils.test.js
node --check .\shared-utils.js
node --check .\background.js
```

Expected: all tests pass and both syntax checks exit `0`.

- [ ] **Step 8: Commit**

```powershell
git add shared-utils.js background.js tests/shared-utils.test.js
git commit -m "feat: add resume change summary contract"
```

---

### Task 2: Parse Markdown Into Comparable Blocks

**Files:**
- Modify: `tests/shared-utils.test.js`
- Modify: `shared-utils.js`

- [ ] **Step 1: Write failing tests for block parsing**

从 `shared-utils.js` 引入 `parseMarkdownBlocks`，增加：

```js
test('parseMarkdownBlocks tracks heading paths and block types', () => {
  const blocks = parseMarkdownBlocks([
    '# 张三',
    '',
    '个人简介。',
    '',
    '## 项目经历',
    '',
    '### RAG 知识库',
    '',
    '- 使用 LangChain',
    '- 使用 Milvus',
    '',
    '> 重点项目',
    '',
    '| 指标 | 数值 |',
    '| --- | --- |',
    '| 命中率 | 90% |',
    '',
    '```js',
    'console.log("ok");',
    '```',
  ].join('\n'));

  assert.deepStrictEqual(
    blocks.map(({ section, type }) => ({ section, type })),
    [
      { section: '张三', type: 'paragraph' },
      { section: '张三 / 项目经历 / RAG 知识库', type: 'list' },
      { section: '张三 / 项目经历 / RAG 知识库', type: 'quote' },
      { section: '张三 / 项目经历 / RAG 知识库', type: 'table' },
      { section: '张三 / 项目经历 / RAG 知识库', type: 'code' },
    ]
  );
});

test('parseMarkdownBlocks keeps list items independently comparable', () => {
  const blocks = parseMarkdownBlocks('## 技能\n\n- Java\n- Python');

  assert.deepStrictEqual(blocks.map((block) => block.text), ['- Java', '- Python']);
  assert.ok(blocks.every((block) => block.type === 'list'));
});
```

- [ ] **Step 2: Write failing tests for normalization**

从 `shared-utils.js` 引入 `normalizeMarkdownComparableText`，增加：

```js
test('normalizeMarkdownComparableText ignores formatting whitespace and punctuation', () => {
  assert.strictEqual(
    normalizeMarkdownComparableText('- **负责 RAG 系统。**'),
    normalizeMarkdownComparableText('负责  RAG 系统')
  );
});

test('normalizeMarkdownComparableText preserves numbers dates and placeholders', () => {
  assert.notStrictEqual(
    normalizeMarkdownComparableText('命中率 80%'),
    normalizeMarkdownComparableText('命中率 90%')
  );
  assert.match(
    normalizeMarkdownComparableText('[待补充：移动端项目]'),
    /待补充.*移动端项目/
  );
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
node .\tests\shared-utils.test.js
```

Expected: FAIL because the parser and normalizer do not exist.

- [ ] **Step 4: Implement comparable-text normalization**

在 `shared-utils.js` 中增加：

```js
function normalizeMarkdownComparableText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, (block) => block)
    .replace(/[*_~`>#-]/g, ' ')
    .replace(/[，。！？；：、,.!?;:()[\]{}"'“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
```

- [ ] **Step 5: Implement Markdown block parsing**

实现以下接口：

```js
function parseMarkdownBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const headingStack = [];
  const blocks = [];
  let index = 0;

  function currentSection() {
    return headingStack.filter(Boolean).join(' / ') || '未分区';
  }

  function pushBlock(type, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    blocks.push({
      section: currentSection(),
      type,
      text: trimmed,
      normalized: normalizeMarkdownComparableText(trimmed),
      index: blocks.length,
    });
  }

  while (index < lines.length) {
    const line = lines[index];
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      headingStack.length = level - 1;
      headingStack[level - 1] = heading[2].trim();
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const chunk = [line];
      index += 1;
      while (index < lines.length) {
        chunk.push(lines[index]);
        if (/^```/.test(lines[index])) {
          index += 1;
          break;
        }
        index += 1;
      }
      pushBlock('code', chunk.join('\n'));
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const chunk = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        chunk.push(lines[index]);
        index += 1;
      }
      pushBlock('table', chunk.join('\n'));
      continue;
    }

    if (/^\s*>/.test(line)) {
      const chunk = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        chunk.push(lines[index]);
        index += 1;
      }
      pushBlock('quote', chunk.join('\n'));
      continue;
    }

    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      pushBlock('list', line);
      index += 1;
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const chunk = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^```/.test(lines[index]) &&
      !/^\s*\|/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[index])
    ) {
      chunk.push(lines[index]);
      index += 1;
    }
    pushBlock('paragraph', chunk.join('\n'));
  }

  return blocks;
}
```

导出 `normalizeMarkdownComparableText` 和 `parseMarkdownBlocks`。

- [ ] **Step 6: Run tests**

Run:

```powershell
node .\tests\shared-utils.test.js
node --check .\shared-utils.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add shared-utils.js tests/shared-utils.test.js
git commit -m "feat: parse resume markdown into comparable blocks"
```

---

### Task 3: Compute Conservative Local Resume Differences

**Files:**
- Modify: `tests/shared-utils.test.js`
- Modify: `shared-utils.js`

- [ ] **Step 1: Write failing tests for unchanged formatting**

从 `shared-utils.js` 引入 `compareMarkdownDocuments`，增加：

```js
test('compareMarkdownDocuments ignores formatting-only changes', () => {
  const diffs = compareMarkdownDocuments(
    '## 技能\n\n- **Java**。\n- Redis',
    '## 技能\n\n* Java\n* Redis'
  );

  assert.deepStrictEqual(diffs, []);
});
```

- [ ] **Step 2: Write failing tests for modified, added, removed and reordered blocks**

```js
test('compareMarkdownDocuments reports material changes', () => {
  const diffs = compareMarkdownDocuments(
    '## 项目\n\n- 负责问答系统\n- 使用 Redis\n\n## 技能\n\n- Java',
    '## 项目\n\n- 负责 RAG 问答系统端到端交付\n- 使用 Milvus\n\n## 技能\n\n- Java\n- Python'
  );

  assert.ok(diffs.some((entry) =>
    entry.type === 'modified' &&
    entry.original.includes('问答系统') &&
    entry.optimized.includes('RAG')
  ));
  assert.ok(diffs.some((entry) => entry.type === 'removed' && entry.original.includes('Redis')));
  assert.ok(diffs.some((entry) => entry.type === 'added' && entry.optimized.includes('Milvus')));
  assert.ok(diffs.some((entry) => entry.type === 'added' && entry.optimized.includes('Python')));
});

test('compareMarkdownDocuments recognizes reordered unchanged blocks', () => {
  const diffs = compareMarkdownDocuments(
    '## 项目\n\n- Java 项目\n- RAG 项目',
    '## 项目\n\n- RAG 项目\n- Java 项目'
  );

  assert.ok(diffs.some((entry) => entry.type === 'reordered'));
  assert.ok(diffs.every((entry) => !['added', 'removed'].includes(entry.type)));
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
node .\tests\shared-utils.test.js
```

Expected: FAIL because `compareMarkdownDocuments` does not exist.

- [ ] **Step 4: Implement lightweight similarity**

在 `shared-utils.js` 中增加：

```js
function textBigrams(value) {
  const text = normalizeMarkdownComparableText(value).replace(/\s+/g, '');
  if (text.length < 2) return new Set(text ? [text] : []);
  const result = new Set();
  for (let index = 0; index < text.length - 1; index += 1) {
    result.add(text.slice(index, index + 2));
  }
  return result;
}

function textSimilarity(left, right) {
  const a = textBigrams(left);
  const b = textBigrams(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return (2 * intersection) / (a.size + b.size);
}
```

- [ ] **Step 5: Implement conservative block matching**

实现：

```js
function compareMarkdownDocuments(originalMarkdown, optimizedMarkdown) {
  const originalBlocks = parseMarkdownBlocks(originalMarkdown);
  const optimizedBlocks = parseMarkdownBlocks(optimizedMarkdown);
  const matchedOriginal = new Set();
  const matchedOptimized = new Set();
  const diffs = [];

  for (const optimized of optimizedBlocks) {
    const exactIndex = originalBlocks.findIndex((original, index) =>
      !matchedOriginal.has(index) &&
      original.normalized &&
      original.normalized === optimized.normalized
    );
    if (exactIndex >= 0) {
      matchedOriginal.add(exactIndex);
      matchedOptimized.add(optimized.index);
      const original = originalBlocks[exactIndex];
      if (original.index !== optimized.index || original.section !== optimized.section) {
        diffs.push({
          section: optimized.section,
          type: 'reordered',
          original: original.text,
          optimized: optimized.text,
          originalIndex: original.index,
          optimizedIndex: optimized.index,
        });
      }
    }
  }

  for (const optimized of optimizedBlocks) {
    if (matchedOptimized.has(optimized.index)) continue;
    let best = null;
    for (const original of originalBlocks) {
      if (matchedOriginal.has(original.index) || original.type !== optimized.type) continue;
      const sectionBonus = original.section === optimized.section ? 0.15 : 0;
      const score = textSimilarity(original.text, optimized.text) + sectionBonus;
      if (!best || score > best.score) best = { original, score };
    }
    if (best && best.score >= 0.62) {
      matchedOriginal.add(best.original.index);
      matchedOptimized.add(optimized.index);
      diffs.push({
        section: optimized.section,
        type: 'modified',
        original: best.original.text,
        optimized: optimized.text,
        originalIndex: best.original.index,
        optimizedIndex: optimized.index,
      });
    }
  }

  for (const original of originalBlocks) {
    if (!matchedOriginal.has(original.index)) {
      diffs.push({
        section: original.section,
        type: 'removed',
        original: original.text,
        optimized: '',
        originalIndex: original.index,
        optimizedIndex: -1,
      });
    }
  }

  for (const optimized of optimizedBlocks) {
    if (!matchedOptimized.has(optimized.index)) {
      diffs.push({
        section: optimized.section,
        type: 'added',
        original: '',
        optimized: optimized.text,
        originalIndex: -1,
        optimizedIndex: optimized.index,
      });
    }
  }

  return diffs.sort((left, right) => {
    const leftIndex = left.optimizedIndex >= 0 ? left.optimizedIndex : left.originalIndex;
    const rightIndex = right.optimizedIndex >= 0 ? right.optimizedIndex : right.originalIndex;
    return leftIndex - rightIndex;
  });
}
```

导出 `textSimilarity` 和 `compareMarkdownDocuments`。

- [ ] **Step 6: Tune only from failing fixtures**

Run:

```powershell
node .\tests\shared-utils.test.js
```

如果测试中的明显改写未匹配，只调整相似度阈值或 section bonus；不要增加 NLP 依赖，也不要让完全不同的 Redis/Milvus 项错误匹配。

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add shared-utils.js tests/shared-utils.test.js
git commit -m "feat: compute local resume markdown differences"
```

---

### Task 4: Merge AI Explanations And Build Downloadable Reports

**Files:**
- Modify: `tests/shared-utils.test.js`
- Modify: `shared-utils.js`

- [ ] **Step 1: Write failing tests for explanation matching and fallback**

从 `shared-utils.js` 引入 `mergeResumeChanges`，增加：

```js
test('mergeResumeChanges attaches matching AI explanations to local diffs', () => {
  const result = mergeResumeChanges([{
    section: '项目经历 / RAG',
    type: 'modified',
    original: '负责问答系统。',
    optimized: '负责 RAG 问答系统。',
    originalIndex: 1,
    optimizedIndex: 1,
  }], {
    summary: ['强化 RAG 能力'],
    changes: [{
      section: '项目经历 / RAG',
      original: '负责问答系统。',
      optimized: '负责 RAG 问答系统。',
      reason: '匹配 JD 的 RAG 要求。',
      jdMatch: ['RAG'],
      factStatus: 'strengthened',
    }],
  });

  assert.strictEqual(result.changes[0].reason, '匹配 JD 的 RAG 要求。');
  assert.deepStrictEqual(result.changes[0].jdMatch, ['RAG']);
  assert.strictEqual(result.changes[0].factStatus, 'strengthened');
});

test('mergeResumeChanges keeps unexplained local differences', () => {
  const result = mergeResumeChanges([{
    section: '技能',
    type: 'added',
    original: '',
    optimized: '- Python',
    originalIndex: -1,
    optimizedIndex: 2,
  }], { summary: [], changes: [] });

  assert.strictEqual(result.changes[0].reason, '未提供优化原因');
  assert.deepStrictEqual(result.changes[0].jdMatch, []);
  assert.strictEqual(result.changes[0].factStatus, 'risk');
});

test('mergeResumeChanges drops AI claims without a local text change', () => {
  const result = mergeResumeChanges([], {
    summary: ['声称有变化'],
    changes: [{
      section: '技能',
      original: 'Java',
      optimized: 'Python',
      reason: '匹配 JD',
      jdMatch: ['Python'],
      factStatus: 'strengthened',
    }],
  });

  assert.deepStrictEqual(result.changes, []);
});
```

- [ ] **Step 2: Write failing tests for report Markdown**

从 `shared-utils.js` 引入 `buildResumeComparisonMarkdown`，增加：

```js
test('buildResumeComparisonMarkdown includes summary comparison and risk sections', () => {
  const markdown = buildResumeComparisonMarkdown({
    kind: 'aspirational',
    resumeFileName: 'resume.md',
    jobTitle: 'AI 工程师',
    generatedAt: '2026-06-09T10:00:00.000Z',
    originalMarkdown: '# Resume\n\n负责问答系统。',
    optimizedMarkdown: '# Resume\n\n负责 RAG 问答系统。\n\n[待补充：移动端项目]',
    changeSummary: {
      summary: ['强化 RAG 能力'],
      changes: [{
        section: 'Resume',
        original: '负责问答系统。',
        optimized: '负责 RAG 问答系统。',
        reason: '匹配 JD。',
        jdMatch: ['RAG'],
        factStatus: 'strengthened',
      }],
    },
  });

  assert.match(markdown, /^# 进阶简历优化对比报告/m);
  assert.match(markdown, /强化 RAG 能力/);
  assert.match(markdown, /#### 原文/);
  assert.match(markdown, /负责问答系统/);
  assert.match(markdown, /负责 RAG 问答系统/);
  assert.match(markdown, /对应 JD：RAG/);
  assert.match(markdown, /\[待补充：移动端项目\]/);
});

test('buildResumeComparisonMarkdown creates a local-only report without AI explanations', () => {
  const markdown = buildResumeComparisonMarkdown({
    kind: 'grounded',
    resumeFileName: 'resume.md',
    jobTitle: '后端工程师',
    originalMarkdown: '## 技能\n\n- Java',
    optimizedMarkdown: '## 技能\n\n- Java\n- Redis',
    changeSummary: null,
  });

  assert.match(markdown, /^# 稳妥简历优化对比报告/m);
  assert.match(markdown, /Redis/);
  assert.match(markdown, /未提供优化原因/);
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
node .\tests\shared-utils.test.js
```

Expected: FAIL because merge and report functions do not exist.

- [ ] **Step 4: Implement AI/local change matching**

实现：

```js
function mergeResumeChanges(localDiffs, changeSummary) {
  const normalizedSummary = normalizeChangeSummary(changeSummary);
  const aiChanges = normalizedSummary.changes;
  const usedAiIndexes = new Set();

  const changes = localDiffs.map((diff) => {
    let best = null;
    aiChanges.forEach((change, index) => {
      if (usedAiIndexes.has(index)) return;
      const sectionScore =
        normalizeMarkdownComparableText(change.section) ===
        normalizeMarkdownComparableText(diff.section)
          ? 0.25
          : 0;
      const originalScore = diff.original
        ? textSimilarity(change.original, diff.original)
        : change.original
          ? 0
          : 0.5;
      const optimizedScore = diff.optimized
        ? textSimilarity(change.optimized, diff.optimized)
        : change.optimized
          ? 0
          : 0.5;
      const score = sectionScore + originalScore * 0.35 + optimizedScore * 0.4;
      if (!best || score > best.score) best = { change, index, score };
    });

    if (best && best.score >= 0.62) {
      usedAiIndexes.add(best.index);
      return {
        ...diff,
        reason: best.change.reason,
        jdMatch: best.change.jdMatch,
        factStatus: best.change.factStatus,
      };
    }

    return {
      ...diff,
      reason: '未提供优化原因',
      jdMatch: [],
      factStatus:
        diff.type === 'reordered'
          ? 'reordered'
          : diff.type === 'removed'
            ? 'removed'
            : 'risk',
    };
  });

  return { summary: normalizedSummary.summary, changes };
}
```

- [ ] **Step 5: Implement report Markdown construction**

增加辅助函数：

```js
function reportList(items, emptyText) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : `- ${emptyText}`;
}

function factStatusLabel(status) {
  return ({
    rephrased: '换角度表达',
    strengthened: '基于原内容强化',
    reordered: '顺序调整',
    removed: '内容删除',
    placeholder: '待用户补充',
    risk: '需要核实',
  })[status] || '需要核实';
}
```

实现 `buildResumeComparisonMarkdown(input)`：

```js
function buildResumeComparisonMarkdown(input) {
  const source = input || {};
  const kind = source.kind === 'grounded' ? 'grounded' : 'aspirational';
  const title = kind === 'grounded' ? '稳妥简历' : '进阶简历';
  const localDiffs = compareMarkdownDocuments(
    source.originalMarkdown,
    source.optimizedMarkdown
  );
  const merged = mergeResumeChanges(localDiffs, source.changeSummary);
  const counts = {
    rephrased: 0,
    strengthened: 0,
    reordered: 0,
    removed: 0,
    placeholder: 0,
    risk: 0,
  };
  merged.changes.forEach((change) => {
    counts[change.factStatus] = (counts[change.factStatus] || 0) + 1;
  });

  const placeholderMatches =
    String(source.optimizedMarkdown || '').match(/\[待补充：[^\]]+\]/g) || [];
  const added = merged.changes.filter((change) => change.type === 'added');
  const removed = merged.changes.filter((change) => change.type === 'removed');
  const reordered = merged.changes.filter((change) => change.type === 'reordered');
  const risks = merged.changes.filter((change) =>
    change.factStatus === 'risk' ||
    (kind === 'grounded' && change.factStatus === 'placeholder')
  );

  const comparisonSections = merged.changes.map((change, index) => [
    `### ${index + 1}. ${change.section || '未分区'}`,
    '',
    '#### 原文',
    '',
    change.original || '（无，对应新增内容）',
    '',
    '#### 优化后',
    '',
    change.optimized || '（无，对应删除内容）',
    '',
    '#### 优化说明',
    '',
    `- 优化原因：${change.reason}`,
    `- 对应 JD：${change.jdMatch.length ? change.jdMatch.join('、') : '未明确'}`,
    `- 事实状态：${factStatusLabel(change.factStatus)}`,
  ].join('\n')).join('\n\n');

  return [
    `# ${title}优化对比报告`,
    '',
    '## 基本信息',
    '',
    `- 原简历：${source.resumeFileName || 'resume.md'}`,
    `- 目标岗位：${source.jobTitle || '未命名岗位'}`,
    `- 生成时间：${source.generatedAt || new Date().toISOString()}`,
    `- 版本：${title}`,
    '',
    '## 简洁优化摘要',
    '',
    reportList(merged.summary, '未提供 AI 优化摘要，请参考逐段对照'),
    '',
    '## 变更类型统计',
    '',
    `- 表达优化：${counts.rephrased}`,
    `- 内容强化：${counts.strengthened}`,
    `- 顺序调整：${counts.reordered}`,
    `- 删除内容：${counts.removed}`,
    `- 待补充：${placeholderMatches.length}`,
    `- 事实风险：${counts.risk}`,
    '',
    '## 逐段优化对照',
    '',
    comparisonSections || '暂无实质变化。',
    '',
    '## 新增内容',
    '',
    reportList(added.map((change) => change.optimized), '暂无'),
    '',
    '## 删除内容',
    '',
    reportList(removed.map((change) => change.original), '暂无'),
    '',
    '## 顺序调整',
    '',
    reportList(reordered.map((change) => `${change.section}：${change.optimized}`), '暂无'),
    '',
    '## 待补充内容',
    '',
    reportList(placeholderMatches, '暂无'),
    '',
    '## 事实风险',
    '',
    reportList(
      risks.map((change) => `${change.section}：${change.optimized || change.original}`),
      '暂无'
    ),
    '',
  ].join('\n');
}
```

导出 `mergeResumeChanges` 和 `buildResumeComparisonMarkdown`。

- [ ] **Step 6: Run tests and syntax checks**

Run:

```powershell
node .\tests\shared-utils.test.js
node --check .\shared-utils.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add shared-utils.js tests/shared-utils.test.js
git commit -m "feat: build resume comparison reports"
```

---

### Task 5: Add Two Download-Only Report Actions

**Files:**
- Modify: `sidepanel.js`
- Modify: `sidepanel.css`
- Test: `tests/shared-utils.test.js`

- [ ] **Step 1: Add a filename regression test**

在 `tests/shared-utils.test.js` 增加：

```js
test('buildDownloadFileName creates separate comparison report names', () => {
  const date = new Date('2026-06-09T10:00:00.000Z');

  assert.strictEqual(
    buildDownloadFileName('resume.md', 'aspirational-comparison', date),
    'resume-aspirational-comparison-2026-06-09.md'
  );
  assert.strictEqual(
    buildDownloadFileName('resume.md', 'grounded-comparison', date),
    'resume-grounded-comparison-2026-06-09.md'
  );
});
```

- [ ] **Step 2: Run test**

Run:

```powershell
node .\tests\shared-utils.test.js
```

Expected: PASS because the existing filename helper supports arbitrary sanitized kinds. This is a characterization test, so no production change is required for this step.

- [ ] **Step 3: Add report buttons to dynamic result markup**

在 `renderResumeOptimizationResult()` 中计算：

```js
const aspirationalComparisonName = resumeUtils.buildDownloadFileName(
  resumeFileName,
  'aspirational-comparison'
);
const groundedComparisonName = resumeUtils.buildDownloadFileName(
  resumeFileName,
  'grounded-comparison'
);
```

在进阶简历操作区加入：

```html
<button id="download-aspirational-comparison-btn" class="ghost-btn" type="button">
  下载对比报告
</button>
```

在稳妥简历操作区加入：

```html
<button id="download-grounded-comparison-btn" class="ghost-btn" type="button">
  下载对比报告
</button>
```

不要增加报告正文容器。

- [ ] **Step 4: Build reports only when clicked**

在 `renderResumeOptimizationResult()` 绑定：

```js
bindResumeResultButton('download-aspirational-comparison-btn', () => {
  downloadResumeComparisonReport({
    kind: 'aspirational',
    fileName: aspirationalComparisonName,
    optimizedMarkdown: aspirationalMarkdown,
    changeSummary: result.aspirationalChangeSummary,
    result,
  });
});

bindResumeResultButton('download-grounded-comparison-btn', () => {
  downloadResumeComparisonReport({
    kind: 'grounded',
    fileName: groundedComparisonName,
    optimizedMarkdown: groundedMarkdown,
    changeSummary: result.groundedChangeSummary,
    result,
  });
});
```

新增：

```js
function downloadResumeComparisonReport(input) {
  try {
    const report = resumeUtils.buildResumeComparisonMarkdown({
      kind: input.kind,
      resumeFileName: savedResume?.fileName || 'resume.md',
      jobTitle: input.result?.jdAnalysis?.jobTitle || input.result?.title || '',
      generatedAt: new Date().toISOString(),
      originalMarkdown: savedResume?.markdown || '',
      optimizedMarkdown: input.optimizedMarkdown,
      changeSummary: input.changeSummary,
    });
    downloadMarkdown(input.fileName, report);
  } catch (error) {
    showStatus('生成对比报告失败：' + (error?.message || error), 'error');
  }
}
```

异常只影响报告按钮，不清空或隐藏已有结果。

- [ ] **Step 5: Make compact action rows wrap**

在 `sidepanel.css` 的 `.action-row` 或 `.action-row.compact` 规则中加入：

```css
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.action-row.compact {
  justify-content: flex-end;
}
```

保留现有按钮尺寸和视觉风格。

- [ ] **Step 6: Run automatic verification**

Run:

```powershell
node .\tests\shared-utils.test.js
node --check .\shared-utils.js
node --check .\background.js
node --check .\sidepanel.js
node --check .\content.js
node --check .\options.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
git diff --check
```

Expected: all tests pass, syntax checks exit `0`, output includes `manifest ok`, and `git diff --check` has no errors.

- [ ] **Step 7: Commit**

```powershell
git add sidepanel.js sidepanel.css tests/shared-utils.test.js
git commit -m "feat: download resume comparison reports"
```

---

### Task 6: Browser Integration And Real Extension Verification

**Files:**
- No production file changes expected.
- Modify only if verification reveals a reproducible defect, following a new RED/GREEN cycle.

- [ ] **Step 1: Reload the unpacked extension**

Open:

```text
chrome://extensions/?id=<extension-id>
```

Click the extension reload button. Confirm the sidepanel reloads and the saved Markdown resume remains available.

- [ ] **Step 2: Verify fallback without AI change summaries**

Using a browser harness or direct invocation of `renderResumeOptimizationResult()`, provide:

```js
{
  jdAnalysis: { jobTitle: 'AI 工程师' },
  aspirationalResumeMarkdown: '# Resume\n\n负责 RAG 系统。',
  groundedResumeMarkdown: '# Resume\n\n负责问答系统。',
  aspirationalChangeSummary: { summary: [], changes: [] },
  groundedChangeSummary: { summary: [], changes: [] }
}
```

Confirm:

- Both “下载对比报告” buttons exist.
- Clicking each button produces a different filename.
- Downloaded report includes local differences and “未提供优化原因”.
- No report body appears in `#resume-result-area`.

- [ ] **Step 3: Run a real JD generation**

Use the configured Chrome environment:

1. Activate a recruiting/JD page.
2. Confirm the saved resume is present.
3. Click “根据当前网页生成简历优化”.
4. Wait for both complete resumes.

Confirm:

- Existing JD analysis, copy, and resume download actions still work.
- Both comparison-report buttons appear.
- The response does not fail if either change-summary field is absent.

- [ ] **Step 4: Download and inspect the aspirational report**

Confirm:

- Filename ends with `aspirational-comparison-YYYY-MM-DD.md`.
- Header is `# 进阶简历优化对比报告`.
- It includes a concise summary.
- It includes changed original and optimized passages.
- `[待补充：...]` entries appear in “待补充内容”.
- Unchanged paragraphs are not repeated.

- [ ] **Step 5: Download and inspect the grounded report**

Confirm:

- Filename ends with `grounded-comparison-YYYY-MM-DD.md`.
- Header is `# 稳妥简历优化对比报告`.
- It includes changed original and optimized passages.
- Any placeholder or unsupported addition is visible under “事实风险”.
- Unchanged paragraphs are not repeated.

- [ ] **Step 6: Verify report isolation**

Force `buildResumeComparisonMarkdown()` to throw in a harness-only mock, then click a report button.

Confirm:

- Status shows `生成对比报告失败`.
- Existing JD analysis and both resumes remain visible.
- Existing copy and resume download buttons remain usable.

- [ ] **Step 7: Run final verification**

Run:

```powershell
node .\tests\shared-utils.test.js
node --check .\shared-utils.js
node --check .\background.js
node --check .\sidepanel.js
node --check .\content.js
node --check .\options.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
git status --short
```

Expected:

- All tests pass.
- All syntax checks exit `0`.
- Manifest prints `manifest ok`.
- Worktree contains no uncommitted feature changes.
- Any pre-existing user-owned file changes remain untouched.

---

## Implementation Notes

1. Use `superpowers:using-git-worktrees` before implementation because `main` currently contains a user-owned uncommitted `CLAUDE.md` change.
2. Use `superpowers:test-driven-development` for every behavioral task.
3. Commit after every task as listed.
4. Do not add a third-party Markdown parser or diff dependency for the MVP.
5. Keep AI change summaries optional so older or partially compliant model responses still render both resumes.
6. If increasing prompt output causes truncation in real verification, do not silently increase token limits again. Record the actual `finish_reason` and revise the change-summary size limit or request architecture in a separate design decision.
