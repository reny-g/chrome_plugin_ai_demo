const assert = require('node:assert');

const {
  validateMarkdownFileMeta,
  buildResumeRecord,
  sanitizeBaseName,
  buildDownloadFileName,
  parseAiResumeResponse,
  buildAnalysisMarkdown,
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
  assert.strictEqual(sanitizeBaseName('my<bad>:resume?.md'), 'mybadresume');
  assert.strictEqual(sanitizeBaseName('////.md'), 'resume');
});

test('buildDownloadFileName includes sanitized base, kind, and date', () => {
  const fileName = buildDownloadFileName('my<bad>:resume?.md', 'analysis', new Date('2026-06-08T12:34:56Z'));

  assert.strictEqual(fileName, 'mybadresume-analysis-2026-06-08.md');
});

test('parseAiResumeResponse parses direct JSON', () => {
  const result = parseAiResumeResponse(JSON.stringify({
    jdAnalysis: { title: '前端工程师', skills: ['React'] },
    aspirationalResumeMarkdown: '# 冲刺版',
    groundedResumeMarkdown: '# 稳健版',
    gapSuggestions: ['补充项目指标'],
    warnings: ['缺少岗位年限'],
  }));

  assert.deepStrictEqual(result, {
    ok: true,
    jdAnalysis: { title: '前端工程师', skills: ['React'] },
    aspirationalResumeMarkdown: '# 冲刺版',
    groundedResumeMarkdown: '# 稳健版',
    gapSuggestions: ['补充项目指标'],
    warnings: ['缺少岗位年限'],
  });
});

test('parseAiResumeResponse parses fenced JSON', () => {
  const result = parseAiResumeResponse('```json\n{"jdAnalysis":{"title":"后端工程师"},"aspirationalResumeMarkdown":"# A","groundedResumeMarkdown":"# G"}\n```');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.jdAnalysis.title, '后端工程师');
  assert.deepStrictEqual(result.gapSuggestions, []);
  assert.deepStrictEqual(result.warnings, []);
});

test('parseAiResumeResponse reports missing required resume fields', () => {
  const raw = '{"jdAnalysis":{"title":"数据分析师"},"aspirationalResumeMarkdown":"# A"}';
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
