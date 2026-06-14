const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateMarkdownFileMeta,
  buildResumeRecord,
  sanitizeBaseName,
  buildDownloadFileName,
  buildJobDownloadFileName,
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
  mergeResumeChanges,
  buildResumeComparisonMarkdown,
  buildResumeGenerationProgress,
  createEmptyHistory,
  buildHistoryEntry,
  appendHistoryEntry,
  removeHistoryEntry,
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

test('buildResumeGenerationProgress changes conservative status copy over time', () => {
  assert.deepStrictEqual(buildResumeGenerationProgress(0), {
    elapsedText: '0 秒',
    message: '正在读取当前网页和简历…',
  });
  assert.strictEqual(
    buildResumeGenerationProgress(10_000).message,
    '已提交给 AI，正在分析岗位要求…'
  );
  assert.strictEqual(
    buildResumeGenerationProgress(30_000).message,
    'AI 正在生成两版优化简历…'
  );
  assert.strictEqual(
    buildResumeGenerationProgress(60_000).message,
    '仍在生成，复杂简历可能需要更长时间…'
  );
});

test('buildResumeGenerationProgress formats elapsed minutes and clamps invalid input', () => {
  assert.strictEqual(buildResumeGenerationProgress(84_900).elapsedText, '1 分 24 秒');
  assert.strictEqual(buildResumeGenerationProgress(-1).elapsedText, '0 秒');
  assert.strictEqual(buildResumeGenerationProgress(Number.NaN).elapsedText, '0 秒');
});

test('buildJobDownloadFileName includes sanitized company and job title', () => {
  const date = new Date('2026-06-09T10:00:00.000Z');

  assert.strictEqual(
    buildJobDownloadFileName(
      '吴仁杨_本科_3年_AI应用工程师.md',
      'aspirational',
      '某某科技（上海）有限公司',
      'AI/大模型应用工程师',
      date
    ),
    '吴仁杨_本科_3年_AI应用工程师-某某科技（上海）有限公司-AI-大模型应用工程师-aspirational-2026-06-09.md'
  );
});

test('buildJobDownloadFileName skips missing company and job title', () => {
  const date = new Date('2026-06-09T10:00:00.000Z');

  assert.strictEqual(
    buildJobDownloadFileName('resume.md', 'grounded', '', '', date),
    'resume-grounded-2026-06-09.md'
  );
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

  assert.deepStrictEqual(result.summary, ['强化 RAG 能力']);
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

test('mergeResumeChanges keeps local structural fact status authoritative', () => {
  const result = mergeResumeChanges([
    {
      section: '技能',
      type: 'added',
      original: '',
      optimized: '- Kubernetes',
      originalIndex: -1,
      optimizedIndex: 2,
    },
    {
      section: '经历',
      type: 'removed',
      original: '- 旧项目',
      optimized: '',
      originalIndex: 3,
      optimizedIndex: -1,
    },
  ], {
    summary: [],
    changes: [
      {
        section: '技能',
        original: '',
        optimized: '- Kubernetes',
        reason: '匹配 JD 技能要求',
        jdMatch: ['Kubernetes'],
        factStatus: 'strengthened',
      },
      {
        section: '经历',
        original: '- 旧项目',
        optimized: '',
        reason: '降低无关信息',
        jdMatch: [],
        factStatus: 'rephrased',
      },
    ],
  });

  assert.strictEqual(result.changes[0].factStatus, 'risk');
  assert.strictEqual(result.changes[1].factStatus, 'removed');
});

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
  assert.match(markdown, /## 待补充内容[\s\S]*\[待补充：移动端项目\]/);
  assert.match(markdown, /## 事实风险/);
});

test('buildResumeComparisonMarkdown creates a local-only grounded report', () => {
  const markdown = buildResumeComparisonMarkdown({
    kind: 'grounded',
    resumeFileName: 'resume.md',
    jobTitle: '后端工程师',
    generatedAt: '2026-06-09T10:00:00.000Z',
    originalMarkdown: '## 技能\n\n- Java',
    optimizedMarkdown: '## 技能\n\n- Java\n- Redis',
    changeSummary: null,
  });

  assert.match(markdown, /^# 稳妥简历优化对比报告/m);
  assert.match(markdown, /Redis/);
  assert.match(markdown, /未提供优化原因/);
  assert.match(markdown, /事实状态：需要核实/);
});

test('createEmptyHistory returns independent empty summary and resume buckets', () => {
  const a = createEmptyHistory();
  const b = createEmptyHistory();
  assert.deepStrictEqual(a, { summary: [], resume: [] });
  a.summary.push({ id: 'x' });
  assert.strictEqual(b.summary.length, 0);
});

test('buildHistoryEntry captures mode, title, url, createdAt, and data', () => {
  const data = { title: '岗位页面', url: 'https://example.com/job', summary: 'hi' };
  const entry = buildHistoryEntry('summary', data);
  assert.strictEqual(entry.mode, 'summary');
  assert.strictEqual(entry.title, '岗位页面');
  assert.strictEqual(entry.url, 'https://example.com/job');
  assert.strictEqual(entry.data, data);
  assert.match(entry.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(typeof entry.id === 'string' && entry.id.length > 0);
});

test('buildHistoryEntry falls back to url then placeholder for title', () => {
  const urlOnly = buildHistoryEntry('resume', { url: 'https://example.com/a' });
  assert.strictEqual(urlOnly.title, 'https://example.com/a');

  const neither = buildHistoryEntry('resume', {});
  assert.strictEqual(neither.title, '(无标题)');
});

test('appendHistoryEntry prepends newest and keeps at most five, without mutating input', () => {
  let history = createEmptyHistory();
  for (let i = 1; i <= 6; i += 1) {
    history = appendHistoryEntry(history, 'summary', { id: `e${i}`, mode: 'summary' });
  }
  assert.strictEqual(history.summary.length, 5);
  assert.strictEqual(history.summary[0].id, 'e6');
  assert.strictEqual(history.summary[4].id, 'e2');

  const frozen = createEmptyHistory();
  const next = appendHistoryEntry(frozen, 'resume', { id: 'r1' });
  assert.strictEqual(frozen.resume.length, 0);
  assert.strictEqual(next.resume.length, 1);
  assert.notStrictEqual(frozen, next);
});

test('removeHistoryEntry removes by id within a mode and leaves the other mode intact', () => {
  let history = createEmptyHistory();
  history = appendHistoryEntry(history, 'summary', { id: 's1' });
  history = appendHistoryEntry(history, 'summary', { id: 's2' });
  history = appendHistoryEntry(history, 'resume', { id: 'r1' });

  const after = removeHistoryEntry(history, 'summary', 's1');
  assert.deepStrictEqual(after.summary.map((e) => e.id), ['s2']);
  assert.deepStrictEqual(after.resume.map((e) => e.id), ['r1']);
  assert.strictEqual(history.summary.length, 2);
});
