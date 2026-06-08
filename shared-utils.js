(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ResumeOptimizerUtils = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const RESUME_STORAGE_KEY = 'resumeMarkdownProfile';

  function validateMarkdownFileMeta(file, markdown) {
    const name = file && typeof file.name === 'string' ? file.name : '';
    if (!/\.md$/i.test(name)) {
      return { ok: false, error: 'Please select a Markdown .md file.' };
    }

    if (typeof markdown !== 'string' || markdown.trim().length === 0) {
      return { ok: false, error: 'Markdown file is empty.' };
    }

    return { ok: true };
  }

  function buildResumeRecord(fileName, markdown, nowIso) {
    const text = typeof markdown === 'string' ? markdown : '';
    return {
      markdown: text,
      fileName,
      updatedAt: nowIso || new Date().toISOString(),
      length: text.length,
    };
  }

  function sanitizeBaseName(fileName) {
    const raw = String(fileName || '').replace(/\.md$/i, '');
    const cleaned = raw
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/^\.+|\.+$/g, '')
      .trim();

    return cleaned || 'resume';
  }

  function formatDate(date) {
    if (date instanceof Date) {
      return date.toISOString().slice(0, 10);
    }

    const value = date ? String(date) : new Date().toISOString();
    return value.slice(0, 10);
  }

  function buildDownloadFileName(fileName, kind, date) {
    const base = sanitizeBaseName(fileName);
    const safeKind = sanitizeBaseName(kind || 'download');
    return `${base}-${safeKind}-${formatDate(date)}.md`;
  }

  function buildResumeOptimizationMessages(input) {
    const source = input || {};
    const pageTitle = String(source.pageTitle || '未命名页面');
    const pageUrl = String(source.pageUrl || '未知 URL');
    const pageContent = String(source.pageContent || '');
    const resumeMarkdown = String(source.resumeMarkdown || '');

    const systemPrompt = [
      '你是严谨的 JD 简历优化助手。',
      '只输出有效 JSON，不要输出 Markdown 代码块、解释、前后缀或多余文本。',
      '必须返回一个 JSON object，字段包括：jdAnalysis、aspirationalResumeMarkdown、groundedResumeMarkdown、gapSuggestions、warnings。',
      'jdAnalysis 用于概括页面/JD 的岗位、职责、硬性要求、加分项、关键词和内容可信度。',
      'aspirationalResumeMarkdown 和 groundedResumeMarkdown 都必须是完整 Markdown 简历，不是片段或修改建议。',
      '两份简历都必须尽量保留原简历的结构、标题层级、语气、排版风格和已有内容组织。',
      'aspirationalResumeMarkdown 可以面向 JD 强化表达，但凡需要新增而原简历缺少证据的内容，必须使用 [待补充：具体内容] 占位。',
      'groundedResumeMarkdown 不要添加原简历中不存在的事实，只能重排、改写、强调或删减原简历中已有事实。',
      'gapSuggestions 必须列出为了匹配 JD 需要候选人真实补充或核实的信息。',
      'warnings 必须提示弱 JD、非招聘页面、页面内容疑似截断、简历内容疑似截断、证据不足或事实风险。',
    ].join('\n');

    const userPrompt = [
      '请基于以下当前页面内容/JD 候选文本和原始 Markdown 简历，生成两版优化后的完整 Markdown 简历。',
      '',
      '## 当前页面标题',
      pageTitle,
      '',
      '## 当前页面 URL',
      pageUrl,
      '',
      '## 当前页面内容/JD 候选文本',
      pageContent,
      '',
      '## 原始 Markdown 简历',
      resumeMarkdown,
    ].join('\n');

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  function stripJsonFence(raw) {
    const text = String(raw || '').trim();
    const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : text;
  }

  function parseAiResumeResponse(raw) {
    let data;
    try {
      data = JSON.parse(stripJsonFence(raw));
    } catch (error) {
      return { ok: false, error: `Invalid JSON response: ${error.message}`, raw };
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'AI response must be a JSON object.', raw };
    }

    const missing = [];
    if (typeof data.aspirationalResumeMarkdown !== 'string' || !data.aspirationalResumeMarkdown.trim()) {
      missing.push('aspirationalResumeMarkdown');
    }
    if (typeof data.groundedResumeMarkdown !== 'string' || !data.groundedResumeMarkdown.trim()) {
      missing.push('groundedResumeMarkdown');
    }

    if (missing.length) {
      return { ok: false, error: `Missing required field(s): ${missing.join(', ')}`, raw };
    }

    const jdAnalysis = data.jdAnalysis && typeof data.jdAnalysis === 'object' && !Array.isArray(data.jdAnalysis)
      ? data.jdAnalysis
      : {};

    return {
      ok: true,
      jdAnalysis,
      aspirationalResumeMarkdown: data.aspirationalResumeMarkdown,
      groundedResumeMarkdown: data.groundedResumeMarkdown,
      gapSuggestions: Array.isArray(data.gapSuggestions) ? data.gapSuggestions : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
    };
  }

  function listSection(items, emptyText) {
    if (!Array.isArray(items) || items.length === 0) {
      return `- ${emptyText}`;
    }

    return items.map((item) => `- ${String(item)}`).join('\n');
  }

  function buildAnalysisMarkdown(data) {
    const source = data || {};
    const jdAnalysis = source.jdAnalysis || {};
    const title = jdAnalysis.title || jdAnalysis.jobTitle || '未命名岗位';
    const skills = Array.isArray(jdAnalysis.skills) ? jdAnalysis.skills : [];

    return [
      '# JD 分析与补充建议',
      '',
      `## 岗位标题`,
      '',
      String(title),
      '',
      '## 技能要求',
      '',
      listSection(skills, '暂无技能要求'),
      '',
      '## 补充建议',
      '',
      listSection(source.gapSuggestions, '暂无补充建议'),
      '',
      '## 风险提醒',
      '',
      listSection(source.warnings, '暂无风险提醒'),
      '',
    ].join('\n');
  }

  return {
    RESUME_STORAGE_KEY,
    validateMarkdownFileMeta,
    buildResumeRecord,
    sanitizeBaseName,
    buildDownloadFileName,
    buildResumeOptimizationMessages,
    parseAiResumeResponse,
    buildAnalysisMarkdown,
  };
}));
