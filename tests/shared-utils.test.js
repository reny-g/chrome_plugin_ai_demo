const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateMarkdownFileMeta,
  buildResumeRecord,
  sanitizeBaseName,
  buildDownloadFileName,
  buildResumeOptimizationMessages,
  normalizeChangeSummary,
  parseAiResumeResponse,
  normalizeResumeWarnings,
  buildAnalysisMarkdown,
  buildResumeChatCompletionBody,
  readChatCompletionResult,
  formatAiServiceError,
  normalizeMarkdownComparableText,
  parseMarkdownBlocks,
  textSimilarity,
  compareMarkdownDocuments,
} = require('../shared-utils');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('validateMarkdownFileMeta accepts non-empty .md files', () => {
  const result = validateMarkdownFileMeta({ name: 'resume.md' }, '# Resume');

  assert.deepStrictEqual(result, { ok: true });
});

test('validateMarkdownFileMeta rejects non-Markdown files', () => {
  const result = validateMarkdownFileMeta({ name: 'resume.txt' }, '# Resume');

  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Markdown|\.md/i);
});

test('validateMarkdownFileMeta rejects empty Markdown files', () => {
  const result = validateMarkdownFileMeta({ name: 'resume.md' }, '   \n\t');

  assert.strictEqual(result.ok, false);
  assert.match(result.error, /empty|空/i);
});

test('buildResumeRecord stores markdown, fileName, updatedAt, length', () => {
  const record = buildResumeRecord('resume.md', '# Resume', '2026-06-08T10:00:00.000Z');

  assert.deepStrictEqual(record, {
    markdown: '# Resume',
    fileName: 'resume.md',
    updatedAt: '2026-06-08T10:00:00.000Z',
    length: 8,
  });
});

test('sanitizeBaseName removes unsafe filename characters and falls back to resume', () => {
  assert.strictEqual(sanitizeBaseName('my<bad>:resume?.md'), 'my-bad-resume');
  assert.strictEqual(sanitizeBaseName('my/resume:java*.md'), 'my-resume-java');
  assert.strictEqual(sanitizeBaseName('////.md'), 'resume');
});

test('buildDownloadFileName includes sanitized base, kind, and date', () => {
  const fileName = buildDownloadFileName('my<bad>:resume?.md', 'analysis', new Date('2026-06-08T12:34:56Z'));

  assert.strictEqual(fileName, 'my-bad-resume-analysis-2026-06-08.md');
});

test('buildResumeOptimizationMessages creates system and user prompts for JD resume optimization', () => {
  const messages = buildResumeOptimizationMessages({
    pageTitle: 'Senior Frontend Engineer',
    pageUrl: 'https://example.com/jobs/frontend',
    pageContent: 'We need React, Chrome Extension, and accessibility experience.',
    resumeMarkdown: '# Resume\n\nBuilt browser extension features.',
  });

  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].role, 'system');
  assert.strictEqual(messages[1].role, 'user');
  assert.match(messages[0].content, /只输出有效 JSON/);
  assert.match(messages[0].content, /不要添加原简历中不存在的事实/);
  assert.match(messages[0].content, /isLikelyJobDescription/);
  assert.match(messages[0].content, /confidence/);
  assert.match(messages[0].content, /jobTitle/);
  assert.match(messages[0].content, /coreResponsibilities/);
  assert.match(messages[0].content, /requiredSkills/);
  assert.match(messages[0].content, /preferredSkills/);
  assert.match(messages[0].content, /softSkills/);
  assert.match(messages[0].content, /keywords/);
  assert.match(messages[0].content, /aspirationalChangeSummary/);
  assert.match(messages[0].content, /groundedChangeSummary/);
  assert.match(messages[0].content, /summary/);
  assert.match(messages[0].content, /changes/);
  assert.match(messages[0].content, /section/);
  assert.match(messages[0].content, /original/);
  assert.match(messages[0].content, /optimized/);
  assert.match(messages[0].content, /reason/);
  assert.match(messages[0].content, /jdMatch/);
  assert.match(messages[0].content, /factStatus/);
  for (const status of ['rephrased', 'strengthened', 'reordered', 'removed', 'placeholder', 'risk']) {
    assert.match(messages[0].content, new RegExp(status));
  }
  assert.match(messages[0].content, /20/);
  assert.match(messages[0].content, /实质变化/);
  assert.match(messages[0].content, /紧凑/);
  assert.match(messages[1].content, /Senior Frontend Engineer/);
  assert.match(messages[1].content, /https:\/\/example\.com\/jobs\/frontend/);
  assert.match(messages[1].content, /React, Chrome Extension, and accessibility/);
  assert.match(messages[1].content, /# Resume/);
  assert.match(messages[1].content, /Built browser extension features/);
});

test('normalizeChangeSummary discards invalid summary entries and invalid changes', () => {
  const result = normalizeChangeSummary({
    summary: [' Improved JD alignment ', '', 42, 'Added evidence'],
    changes: [
      {
        section: ' Experience ',
        original: 'Old wording',
        optimized: 'New wording',
        reason: 'Matches the role',
        jdMatch: [' React ', '', 123],
        factStatus: 'strengthened',
      },
      {
        section: 'Skills',
        original: 'JavaScript',
        optimized: 'JavaScript and React',
        reason: 'Keyword match',
        jdMatch: ['React'],
        factStatus: 'invented',
      },
      null,
    ],
  });

  assert.deepStrictEqual(result, {
    summary: ['Improved JD alignment', 'Added evidence'],
    changes: [{
      section: 'Experience',
      original: 'Old wording',
      optimized: 'New wording',
      reason: 'Matches the role',
      jdMatch: ['React'],
      factStatus: 'strengthened',
    }],
  });
});

test('normalizeChangeSummary falls back for invalid structures and limits changes to 20', () => {
  assert.deepStrictEqual(normalizeChangeSummary(null), { summary: [], changes: [] });
  assert.deepStrictEqual(normalizeChangeSummary([]), { summary: [], changes: [] });

  const changes = Array.from({ length: 21 }, (_, index) => ({
    section: `Section ${index}`,
    original: 'Original',
    optimized: 'Optimized',
    reason: 'Reason',
    jdMatch: [],
    factStatus: 'rephrased',
  }));

  assert.strictEqual(normalizeChangeSummary({ summary: [], changes }).changes.length, 20);
});

test('normalizeChangeSummary preserves string original and optimized values including empty pairs', () => {
  const result = normalizeChangeSummary({
    summary: [],
    changes: [
      {
        section: 'Experience',
        original: 'Removed claim',
        optimized: '',
        reason: 'Not relevant to the JD',
        jdMatch: [],
        factStatus: 'removed',
      },
      {
        section: 'Experience',
        original: '',
        optimized: '[待补充：项目指标]',
        reason: 'The JD requests measurable impact',
        jdMatch: ['measurable impact'],
        factStatus: 'placeholder',
      },
      {
        section: 'Experience',
        original: '',
        optimized: '',
        reason: 'No content changed',
        jdMatch: [],
        factStatus: 'rephrased',
      },
    ],
  });

  assert.deepStrictEqual(result.changes, [
    {
      section: 'Experience',
      original: 'Removed claim',
      optimized: '',
      reason: 'Not relevant to the JD',
      jdMatch: [],
      factStatus: 'removed',
    },
    {
      section: 'Experience',
      original: '',
      optimized: '[待补充：项目指标]',
      reason: 'The JD requests measurable impact',
      jdMatch: ['measurable impact'],
      factStatus: 'placeholder',
    },
    {
      section: 'Experience',
      original: '',
      optimized: '',
      reason: 'No content changed',
      jdMatch: [],
      factStatus: 'rephrased',
    },
  ]);
});

test('background success response passes through both change summaries', () => {
  const backgroundSource = fs.readFileSync(
    path.join(__dirname, '..', 'background.js'),
    'utf8'
  );

  assert.match(
    backgroundSource,
    /aspirationalChangeSummary:\s*parsed\.aspirationalChangeSummary/
  );
  assert.match(
    backgroundSource,
    /groundedChangeSummary:\s*parsed\.groundedChangeSummary/
  );
});

test('buildResumeChatCompletionBody requests enough output tokens for two complete resumes', () => {
  const body = buildResumeChatCompletionBody({
    model: 'doubao-seed-2.0-pro',
    messages: [{ role: 'user', content: 'Generate resumes' }],
  });

  assert.strictEqual(body.model, 'doubao-seed-2.0-pro');
  assert.strictEqual(body.max_tokens, 16384);
  assert.strictEqual(body.temperature, 0.2);
  assert.strictEqual(body.stream, false);
});

test('readChatCompletionResult preserves finish reason and token usage', () => {
  const result = readChatCompletionResult({
    choices: [{
      finish_reason: 'length',
      message: { content: '{"incomplete":' },
    }],
    usage: {
      prompt_tokens: 3000,
      completion_tokens: 4096,
      total_tokens: 7096,
    },
  });

  assert.deepStrictEqual(result, {
    content: '{"incomplete":',
    finishReason: 'length',
    usage: {
      prompt_tokens: 3000,
      completion_tokens: 4096,
      total_tokens: 7096,
    },
  });
});

test('formatAiServiceError always includes finish_reason and usage when available', () => {
  const message = formatAiServiceError('AI 输出被截断', 'length', {
    completion_tokens: 4096,
    total_tokens: 7096,
  });

  assert.match(message, /finish_reason=length/);
  assert.match(message, /completion_tokens=4096/);
  assert.match(message, /total_tokens=7096/);
  assert.match(formatAiServiceError('HTTP 500'), /finish_reason=unknown/);
});

test('parseAiResumeResponse parses direct JSON', () => {
  const result = parseAiResumeResponse(JSON.stringify({
    jdAnalysis: {
      isLikelyJobDescription: true,
      confidence: 'high',
      jobTitle: '前端工程师',
      coreResponsibilities: ['开发前端功能'],
      requiredSkills: ['React'],
      preferredSkills: ['Chrome Extension'],
      softSkills: ['沟通协作'],
      keywords: ['MV3'],
    },
    aspirationalResumeMarkdown: '# 冲刺版',
    groundedResumeMarkdown: '# 稳健版',
    gapSuggestions: ['补充项目指标'],
    warnings: ['缺少岗位年限'],
  }));

  assert.deepStrictEqual(result, {
    ok: true,
    jdAnalysis: {
      isLikelyJobDescription: true,
      confidence: 'high',
      jobTitle: '前端工程师',
      coreResponsibilities: ['开发前端功能'],
      requiredSkills: ['React'],
      preferredSkills: ['Chrome Extension'],
      softSkills: ['沟通协作'],
      keywords: ['MV3'],
    },
    aspirationalResumeMarkdown: '# 冲刺版',
    groundedResumeMarkdown: '# 稳健版',
    gapSuggestions: ['补充项目指标'],
    warnings: ['缺少岗位年限'],
    aspirationalChangeSummary: { summary: [], changes: [] },
    groundedChangeSummary: { summary: [], changes: [] },
  });
});

test('parseAiResumeResponse parses fenced JSON', () => {
  const result = parseAiResumeResponse('```json\n{"jdAnalysis":{"isLikelyJobDescription":true,"confidence":"medium","jobTitle":"后端工程师","coreResponsibilities":[],"requiredSkills":[],"preferredSkills":[],"softSkills":[],"keywords":[]},"aspirationalResumeMarkdown":"# A","groundedResumeMarkdown":"# G"}\n```');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.jdAnalysis.jobTitle, '后端工程师');
  assert.deepStrictEqual(result.gapSuggestions, []);
  assert.deepStrictEqual(result.warnings, []);
  assert.deepStrictEqual(result.aspirationalChangeSummary, { summary: [], changes: [] });
  assert.deepStrictEqual(result.groundedChangeSummary, { summary: [], changes: [] });
});

test('parseAiResumeResponse normalizes optional change summaries', () => {
  const result = parseAiResumeResponse(JSON.stringify({
    jdAnalysis: {
      isLikelyJobDescription: true,
      confidence: 'high',
      jobTitle: 'Frontend Engineer',
      coreResponsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      softSkills: [],
      keywords: [],
    },
    aspirationalResumeMarkdown: '# A',
    groundedResumeMarkdown: '# G',
    aspirationalChangeSummary: {
      summary: [' Stronger impact '],
      changes: [{
        section: 'Experience',
        original: 'Built UI',
        optimized: 'Built accessible React UI',
        reason: 'Aligns with JD',
        jdMatch: [' React ', null],
        factStatus: 'strengthened',
      }],
    },
    groundedChangeSummary: {
      summary: ['Invalid change removed'],
      changes: [{
        section: 'Experience',
        original: 'Built UI',
        optimized: 'Invented metric',
        reason: 'Looks stronger',
        jdMatch: ['Metrics'],
        factStatus: 'invented',
      }],
    },
  }));

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.aspirationalChangeSummary, {
    summary: ['Stronger impact'],
    changes: [{
      section: 'Experience',
      original: 'Built UI',
      optimized: 'Built accessible React UI',
      reason: 'Aligns with JD',
      jdMatch: ['React'],
      factStatus: 'strengthened',
    }],
  });
  assert.deepStrictEqual(result.groundedChangeSummary, {
    summary: ['Invalid change removed'],
    changes: [],
  });
});

test('parseAiResumeResponse reports missing required resume fields', () => {
  const raw = '{"jdAnalysis":{"isLikelyJobDescription":true,"confidence":"high","jobTitle":"数据分析师","coreResponsibilities":[],"requiredSkills":[],"preferredSkills":[],"softSkills":[],"keywords":[]},"aspirationalResumeMarkdown":"# A"}';
  const result = parseAiResumeResponse(raw);

  assert.strictEqual(result.ok, false);
  assert.match(result.error, /groundedResumeMarkdown/);
  assert.strictEqual(result.raw, raw);
});

test('parseAiResumeResponse reports non-object JSON responses without throwing', () => {
  const raw = 'null';

  assert.doesNotThrow(() => {
    const result = parseAiResumeResponse(raw);

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /object/i);
    assert.strictEqual(result.raw, raw);
  });
});

test('parseAiResumeResponse reports missing required jdAnalysis schema fields', () => {
  const raw = '{"jdAnalysis":{"jobTitle":"前端工程师"},"aspirationalResumeMarkdown":"# A","groundedResumeMarkdown":"# G"}';
  const result = parseAiResumeResponse(raw);

  assert.strictEqual(result.ok, false);
  assert.match(result.error, /jdAnalysis\.isLikelyJobDescription/);
  assert.match(result.error, /jdAnalysis\.requiredSkills/);
  assert.strictEqual(result.raw, raw);
});

test('parseAiResumeResponse reports invalid jdAnalysis scalar fields', () => {
  const raw = JSON.stringify({
    jdAnalysis: {
      isLikelyJobDescription: true,
      confidence: 'banana',
      jobTitle: [],
      coreResponsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      softSkills: [],
      keywords: [],
    },
    aspirationalResumeMarkdown: '# A',
    groundedResumeMarkdown: '# G',
  });
  const result = parseAiResumeResponse(raw);

  assert.strictEqual(result.ok, false);
  assert.match(result.error, /jdAnalysis\.confidence/);
  assert.match(result.error, /jdAnalysis\.jobTitle/);
});

test('normalizeResumeWarnings adds a visible warning for non-JD pages', () => {
  const warnings = normalizeResumeWarnings([], { isLikelyJobDescription: false }, ['页面内容超过 12000 字符']);

  assert.deepStrictEqual(warnings, [
    '页面可能不是招聘 JD，请谨慎参考生成结果。',
    '页面内容超过 12000 字符',
  ]);
});

test('buildAnalysisMarkdown creates a downloadable Markdown report containing title, skills, warnings', () => {
  const markdown = buildAnalysisMarkdown({
    jdAnalysis: {
      title: '前端工程师',
      skills: ['React', 'Chrome Extension'],
    },
    gapSuggestions: ['补充 MV3 项目经验'],
    warnings: ['不要虚构工作经历'],
  });

  assert.match(markdown, /^# JD 分析与补充建议/m);
  assert.match(markdown, /前端工程师/);
  assert.match(markdown, /React/);
  assert.match(markdown, /Chrome Extension/);
  assert.match(markdown, /不要虚构工作经历/);
});

test('buildAnalysisMarkdown includes all spec-shaped JD analysis fields', () => {
  const markdown = buildAnalysisMarkdown({
    jdAnalysis: {
      jobTitle: 'Senior Frontend Engineer',
      isLikelyJobDescription: false,
      confidence: 'low',
      coreResponsibilities: ['Lead frontend architecture'],
      requiredSkills: ['JavaScript'],
      preferredSkills: ['Chrome Extension'],
      softSkills: ['Cross-functional communication'],
      keywords: ['Manifest V3'],
    },
  });

  assert.match(markdown, /Senior Frontend Engineer/);
  assert.match(markdown, /是否像 JD/);
  assert.match(markdown, /否/);
  assert.match(markdown, /置信度/);
  assert.match(markdown, /low/);
  assert.match(markdown, /Lead frontend architecture/);
  assert.match(markdown, /JavaScript/);
  assert.match(markdown, /Chrome Extension/);
  assert.match(markdown, /Cross-functional communication/);
  assert.match(markdown, /Manifest V3/);
});

test('buildAnalysisMarkdown renders object-shaped gap suggestions as human-readable content', () => {
  const markdown = buildAnalysisMarkdown({
    gapSuggestions: [{
      area: 'Project experience',
      reason: 'The JD requires a complex frontend project',
      suggestion: 'Add a verifiable project example',
    }],
  });

  assert.match(markdown, /Project experience/);
  assert.match(markdown, /The JD requires a complex frontend project/);
  assert.match(markdown, /Add a verifiable project example/);
  assert.doesNotMatch(markdown, /\[object Object\]/);
});

test('normalizeMarkdownComparableText ignores Markdown formatting, whitespace, case, and punctuation', () => {
  const formatted = '**Senior Engineer**： React、Node.js，交付 90%！';
  const plain = 'senior engineer react node.js 交付90%';

  assert.strictEqual(
    normalizeMarkdownComparableText(formatted),
    normalizeMarkdownComparableText(plain)
  );
});

test('normalizeMarkdownComparableText preserves numbers, dates, technical terms, and placeholder text', () => {
  const normalized = normalizeMarkdownComparableText(
    '- [待补充：2025-06 项目指标] 使用 .NET Node.js C++ C# React/Vue 提升 80%'
  );

  assert.match(normalized, /待补充/);
  assert.match(normalized, /2025-06/);
  assert.match(normalized, /\.net/);
  assert.match(normalized, /c\+\+/);
  assert.match(normalized, /c#/);
  assert.match(normalized, /node\.js/);
  assert.match(normalized, /react\/vue/);
  assert.match(normalized, /80/);
  assert.notStrictEqual(
    normalized,
    normalizeMarkdownComparableText(
      '- [待补充：2025-06 项目指标] 使用 .NET Node.js C++ C# React/Vue 提升 90%'
    )
  );
});

test('normalizeMarkdownComparableText ignores prose hyphens like whitespace', () => {
  assert.strictEqual(
    normalizeMarkdownComparableText('Delivered foo-bar capability.'),
    normalizeMarkdownComparableText('Delivered foo bar capability')
  );
});

test('normalizeMarkdownComparableText treats canonically equivalent Unicode as equal', () => {
  assert.strictEqual(
    normalizeMarkdownComparableText('Caf\u00e9'),
    normalizeMarkdownComparableText('Cafe\u0301')
  );
});

test('parseMarkdownBlocks tracks heading paths and parses each Markdown block type', () => {
  const markdown = [
    '# Resume',
    '',
    'Intro line',
    'continued here.',
    '',
    '## Experience',
    '- Java',
    '* Improved accessibility',
    '+ Reduced load time',
    '',
    '> 重点',
    '> 跨团队协作',
    '',
    '| Skill | Level |',
    '| --- | --- |',
    '| React | Advanced |',
    '',
    '```js',
    'const score = 90;',
    '```',
    '',
    'After code.',
  ].join('\n');

  const blocks = parseMarkdownBlocks(markdown);

  assert.deepStrictEqual(
    blocks.map(({ section, type, text, index }) => ({ section, type, text, index })),
    [
      {
        section: 'Resume',
        type: 'paragraph',
        text: 'Intro line\ncontinued here.',
        index: 0,
      },
      {
        section: 'Resume / Experience',
        type: 'list',
        text: '- Java',
        index: 1,
      },
      {
        section: 'Resume / Experience',
        type: 'list',
        text: '* Improved accessibility',
        index: 2,
      },
      {
        section: 'Resume / Experience',
        type: 'list',
        text: '+ Reduced load time',
        index: 3,
      },
      {
        section: 'Resume / Experience',
        type: 'quote',
        text: '> 重点\n> 跨团队协作',
        index: 4,
      },
      {
        section: 'Resume / Experience',
        type: 'table',
        text: '| Skill | Level |\n| --- | --- |\n| React | Advanced |',
        index: 5,
      },
      {
        section: 'Resume / Experience',
        type: 'code',
        text: '```js\nconst score = 90;\n```',
        index: 6,
      },
      {
        section: 'Resume / Experience',
        type: 'paragraph',
        text: 'After code.',
        index: 7,
      },
    ]
  );
  for (const block of blocks) {
    assert.strictEqual(block.normalized, normalizeMarkdownComparableText(block.text));
  }
});

test('parseMarkdownBlocks preserves C# headings and removes spaced closing hashes', () => {
  const blocks = parseMarkdownBlocks([
    '## C#',
    'Language experience.',
    '',
    '## Title ##',
    'Regular section.',
  ].join('\n'));

  assert.deepStrictEqual(
    blocks.map(({ section, text }) => ({ section, text })),
    [
      { section: 'C#', text: 'Language experience.' },
      { section: 'Title', text: 'Regular section.' },
    ]
  );
});

test('parseMarkdownBlocks keeps indented continuation lines in the same list block', () => {
  const blocks = parseMarkdownBlocks([
    '- Led migration',
    '  across teams',
    '- Shipped release',
  ].join('\n'));

  assert.deepStrictEqual(
    blocks.map(({ type, text }) => ({ type, text })),
    [
      { type: 'list', text: '- Led migration\n  across teams' },
      { type: 'list', text: '- Shipped release' },
    ]
  );
});

test('parseMarkdownBlocks recognizes GFM tables with optional outer pipes', () => {
  const blocks = parseMarkdownBlocks([
    'A | B',
    '--- | ---',
    'x | y',
    '',
    '| C | D',
    '| --- | ---',
    '| z | w',
  ].join('\n'));

  assert.deepStrictEqual(
    blocks.map(({ type, text }) => ({ type, text })),
    [
      { type: 'table', text: 'A | B\n--- | ---\nx | y' },
      { type: 'table', text: '| C | D\n| --- | ---\n| z | w' },
    ]
  );
});

test('parseMarkdownBlocks requires a delimiter row before treating pipes as a table', () => {
  const blocks = parseMarkdownBlocks([
    'Use React | Vue based on the project.',
    'This remains prose.',
  ].join('\n'));

  assert.deepStrictEqual(
    blocks.map(({ type, text }) => ({ type, text })),
    [{
      type: 'paragraph',
      text: 'Use React | Vue based on the project.\nThis remains prose.',
    }]
  );
});

test('parseMarkdownBlocks resets deeper heading paths and uses an unsectioned fallback', () => {
  const blocks = parseMarkdownBlocks([
    'Before headings.',
    '',
    '# Work',
    '## Current',
    '### Details',
    'Deep paragraph.',
    '',
    '## Previous',
    'Earlier paragraph.',
  ].join('\n'));

  assert.deepStrictEqual(
    blocks.map(({ section, text }) => ({ section, text })),
    [
      { section: '未分区', text: 'Before headings.' },
      { section: 'Work / Current / Details', text: 'Deep paragraph.' },
      { section: 'Work / Previous', text: 'Earlier paragraph.' },
    ]
  );
});

test('parseMarkdownBlocks closes matching fences without consuming following content', () => {
  const blocks = parseMarkdownBlocks([
    '~~~text',
    '``` is content inside tilde fence',
    '~~~',
    'Following paragraph.',
  ].join('\n'));

  assert.deepStrictEqual(
    blocks.map(({ type, text }) => ({ type, text })),
    [
      {
        type: 'code',
        text: '~~~text\n``` is content inside tilde fence\n~~~',
      },
      {
        type: 'paragraph',
        text: 'Following paragraph.',
      },
    ]
  );
});

test('textSimilarity scores related text above unrelated text', () => {
  const related = textSimilarity(
    '负责知识库问答系统开发',
    '负责 RAG 知识库问答系统端到端开发'
  );
  const unrelated = textSimilarity(
    '负责知识库问答系统开发',
    '熟悉 Kubernetes 集群运维'
  );

  assert.ok(related > unrelated);
  assert.ok(related > 0.5);
});

test('compareMarkdownDocuments ignores formatting-only changes', () => {
  const diffs = compareMarkdownDocuments(
    '## 技能\n\n- **Java**。\n- Redis',
    '## 技能\n\n* Java\n* Redis'
  );

  assert.deepStrictEqual(diffs, []);
});

test('compareMarkdownDocuments reports modified added and removed blocks', () => {
  const diffs = compareMarkdownDocuments(
    '## 项目\n\n- 负责问答系统\n- 使用 Redis\n\n## 技能\n\n- Java',
    '## 项目\n\n- 负责 RAG 问答系统端到端交付\n- 使用 Milvus\n\n## 技能\n\n- Java\n- Python'
  );

  assert.ok(diffs.some((entry) =>
    entry.type === 'modified' &&
    entry.original.includes('问答系统') &&
    entry.optimized.includes('RAG')
  ));
  assert.ok(diffs.some((entry) =>
    entry.type === 'removed' && entry.original.includes('Redis')
  ));
  assert.ok(diffs.some((entry) =>
    entry.type === 'added' && entry.optimized.includes('Milvus')
  ));
  assert.ok(diffs.some((entry) =>
    entry.type === 'added' && entry.optimized.includes('Python')
  ));
});

test('compareMarkdownDocuments recognizes reordered unchanged blocks', () => {
  const diffs = compareMarkdownDocuments(
    '## 项目\n\n- Java 项目\n- RAG 项目',
    '## 项目\n\n- RAG 项目\n- Java 项目'
  );

  assert.ok(diffs.some((entry) => entry.type === 'reordered'));
  assert.ok(diffs.every((entry) => !['added', 'removed'].includes(entry.type)));
});

test('compareMarkdownDocuments does not mark unchanged trailing blocks reordered after insertion', () => {
  const diffs = compareMarkdownDocuments(
    '## 技能\n\n- Java\n- Redis',
    '## 技能\n\n- Python\n- Java\n- Redis'
  );

  assert.deepStrictEqual(
    diffs.map(({ type, optimized }) => ({ type, optimized })),
    [{ type: 'added', optimized: '- Python' }]
  );
});
