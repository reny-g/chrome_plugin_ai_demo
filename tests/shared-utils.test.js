const assert = require('node:assert');

const {
  validateMarkdownFileMeta,
  buildResumeRecord,
  sanitizeBaseName,
  buildDownloadFileName,
  buildResumeOptimizationMessages,
  parseAiResumeResponse,
  normalizeResumeWarnings,
  buildAnalysisMarkdown,
  buildResumeChatCompletionBody,
  readChatCompletionResult,
  formatAiServiceError,
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
  assert.match(messages[1].content, /Senior Frontend Engineer/);
  assert.match(messages[1].content, /https:\/\/example\.com\/jobs\/frontend/);
  assert.match(messages[1].content, /React, Chrome Extension, and accessibility/);
  assert.match(messages[1].content, /# Resume/);
  assert.match(messages[1].content, /Built browser extension features/);
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
  });
});

test('parseAiResumeResponse parses fenced JSON', () => {
  const result = parseAiResumeResponse('```json\n{"jdAnalysis":{"isLikelyJobDescription":true,"confidence":"medium","jobTitle":"后端工程师","coreResponsibilities":[],"requiredSkills":[],"preferredSkills":[],"softSkills":[],"keywords":[]},"aspirationalResumeMarkdown":"# A","groundedResumeMarkdown":"# G"}\n```');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.jdAnalysis.jobTitle, '后端工程师');
  assert.deepStrictEqual(result.gapSuggestions, []);
  assert.deepStrictEqual(result.warnings, []);
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
