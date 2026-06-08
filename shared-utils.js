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
    parseAiResumeResponse,
    buildAnalysisMarkdown,
  };
}));
