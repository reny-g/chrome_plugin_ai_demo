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
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
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
      '必须返回一个 JSON object，字段包括：jdAnalysis、aspirationalResumeMarkdown、groundedResumeMarkdown、aspirationalChangeSummary、groundedChangeSummary、gapSuggestions、warnings。',
      'jdAnalysis 必须是 object，字段包括：isLikelyJobDescription(boolean)、confidence(high|medium|low)、jobTitle、coreResponsibilities、requiredSkills、preferredSkills、softSkills、keywords。',
      'jdAnalysis 用于概括页面/JD 的岗位、职责、硬性要求、加分项、关键词和内容可信度。',
      'aspirationalResumeMarkdown 和 groundedResumeMarkdown 都必须是完整 Markdown 简历，不是片段或修改建议。',
      'aspirationalChangeSummary 和 groundedChangeSummary 必须分别说明对应版本的实质变化，结构为 {"summary": string[], "changes": change[]}。',
      '每个 change 必须包含 section、original、optimized、reason、jdMatch(string[])、factStatus；section、original、optimized、reason 都必须是 string。',
      'factStatus 只允许 rephrased、strengthened、reordered、removed、placeholder、risk。',
      '只描述有实质变化的段落，每个版本的 changes 最多 20 项，summary 和 change 说明保持紧凑。',
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

  function buildResumeChatCompletionBody(input) {
    const source = input || {};
    return {
      model: source.model,
      messages: Array.isArray(source.messages) ? source.messages : [],
      temperature: 0.2,
      max_tokens: 16384,
      stream: false,
    };
  }

  function readChatCompletionResult(data) {
    const choice = data?.choices?.[0] || {};
    return {
      content: choice?.message?.content || '',
      finishReason: choice?.finish_reason || 'unknown',
      usage: data?.usage || null,
    };
  }

  function formatAiServiceError(message, finishReason, usage) {
    const reason = finishReason || 'unknown';
    const details = [`finish_reason=${reason}`];
    if (usage && Number.isFinite(usage.completion_tokens)) {
      details.push(`completion_tokens=${usage.completion_tokens}`);
    }
    if (usage && Number.isFinite(usage.total_tokens)) {
      details.push(`total_tokens=${usage.total_tokens}`);
    }
    return `${message} (${details.join(', ')})`;
  }

  function stripJsonFence(raw) {
    const text = String(raw || '').trim();
    const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : text;
  }

  function normalizeChangeSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { summary: [], changes: [] };
    }

    const summary = (Array.isArray(value.summary) ? value.summary : [])
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim());
    const validFactStatuses = new Set([
      'rephrased',
      'strengthened',
      'reordered',
      'removed',
      'placeholder',
      'risk',
    ]);
    const changes = [];

    for (const change of Array.isArray(value.changes) ? value.changes : []) {
      if (changes.length >= 20) break;
      if (!change || typeof change !== 'object' || Array.isArray(change)) continue;
      if (
        typeof change.section !== 'string' ||
        typeof change.original !== 'string' ||
        typeof change.optimized !== 'string' ||
        typeof change.reason !== 'string'
      ) {
        continue;
      }

      const section = change.section.trim();
      const original = change.original.trim();
      const optimized = change.optimized.trim();
      const reason = change.reason.trim();
      if (
        !section ||
        (!original && !optimized) ||
        !reason ||
        !validFactStatuses.has(change.factStatus)
      ) {
        continue;
      }

      changes.push({
        section,
        original,
        optimized,
        reason,
        jdMatch: (Array.isArray(change.jdMatch) ? change.jdMatch : [])
          .filter((item) => typeof item === 'string' && item.trim())
          .map((item) => item.trim()),
        factStatus: change.factStatus,
      });
    }

    return { summary, changes };
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

    const jdAnalysis = data.jdAnalysis && typeof data.jdAnalysis === 'object' && !Array.isArray(data.jdAnalysis)
      ? data.jdAnalysis
      : null;
    if (!jdAnalysis) {
      missing.push('jdAnalysis');
    } else {
      const requiredJdFields = [
        'isLikelyJobDescription',
        'confidence',
        'jobTitle',
        'coreResponsibilities',
        'requiredSkills',
        'preferredSkills',
        'softSkills',
        'keywords',
      ];
      for (const field of requiredJdFields) {
        if (!(field in jdAnalysis)) {
          missing.push(`jdAnalysis.${field}`);
        }
      }
      for (const field of ['coreResponsibilities', 'requiredSkills', 'preferredSkills', 'softSkills', 'keywords']) {
        if (field in jdAnalysis && !Array.isArray(jdAnalysis[field])) {
          missing.push(`jdAnalysis.${field}`);
        }
      }
      if ('isLikelyJobDescription' in jdAnalysis && typeof jdAnalysis.isLikelyJobDescription !== 'boolean') {
        missing.push('jdAnalysis.isLikelyJobDescription');
      }
      if ('confidence' in jdAnalysis && !['high', 'medium', 'low'].includes(jdAnalysis.confidence)) {
        missing.push('jdAnalysis.confidence');
      }
      if ('jobTitle' in jdAnalysis && typeof jdAnalysis.jobTitle !== 'string') {
        missing.push('jdAnalysis.jobTitle');
      }
    }

    if (missing.length) {
      return { ok: false, error: `Missing or invalid required field(s): ${missing.join(', ')}`, raw };
    }

    return {
      ok: true,
      jdAnalysis,
      aspirationalResumeMarkdown: data.aspirationalResumeMarkdown,
      groundedResumeMarkdown: data.groundedResumeMarkdown,
      gapSuggestions: Array.isArray(data.gapSuggestions) ? data.gapSuggestions : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      aspirationalChangeSummary: normalizeChangeSummary(data.aspirationalChangeSummary),
      groundedChangeSummary: normalizeChangeSummary(data.groundedChangeSummary),
    };
  }

  function normalizeResumeWarnings(warnings, jdAnalysis, extraWarnings) {
    const normalized = [];
    if (jdAnalysis && jdAnalysis.isLikelyJobDescription === false) {
      normalized.push('页面可能不是招聘 JD，请谨慎参考生成结果。');
    }
    for (const warning of Array.isArray(warnings) ? warnings : []) {
      if (warning) normalized.push(String(warning));
    }
    for (const warning of Array.isArray(extraWarnings) ? extraWarnings : []) {
      if (warning) normalized.push(String(warning));
    }
    return Array.from(new Set(normalized));
  }

  function listSection(items, emptyText) {
    if (!Array.isArray(items) || items.length === 0) {
      return `- ${emptyText}`;
    }

    return items.map((item) => `- ${String(item)}`).join('\n');
  }

  function formatGapSuggestion(gap) {
    if (!gap || typeof gap !== 'object' || Array.isArray(gap)) {
      return String(gap);
    }

    const area = gap.area ? String(gap.area) : '未分类';
    const suggestion = gap.suggestion ? String(gap.suggestion) : '暂无具体建议';
    const reason = gap.reason ? `（原因：${String(gap.reason)}）` : '';
    return `${area}：${suggestion}${reason}`;
  }

  function gapSuggestionsSection(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return '- 暂无补充建议';
    }

    return items.map((item) => `- ${formatGapSuggestion(item)}`).join('\n');
  }

  function buildAnalysisMarkdown(data) {
    const source = data || {};
    const jdAnalysis = source.jdAnalysis || {};
    const title = jdAnalysis.title || jdAnalysis.jobTitle || '未命名岗位';
    const skills = Array.isArray(jdAnalysis.skills) ? jdAnalysis.skills : [];
    const isLikelyJobDescription = jdAnalysis.isLikelyJobDescription === true
      ? '是'
      : jdAnalysis.isLikelyJobDescription === false
        ? '否'
        : '不确定';
    const confidence = jdAnalysis.confidence ? String(jdAnalysis.confidence) : '未提供';

    return [
      '# JD 分析与补充建议',
      '',
      `## 岗位标题`,
      '',
      String(title),
      '',
      '## JD 判断',
      '',
      `- 是否像 JD：${isLikelyJobDescription}`,
      `- 置信度：${confidence}`,
      '',
      '## 技能要求',
      '',
      listSection(skills, '暂无技能要求'),
      '',
      '## 核心职责',
      '',
      listSection(jdAnalysis.coreResponsibilities, '暂无核心职责'),
      '',
      '## 必备技能',
      '',
      listSection(jdAnalysis.requiredSkills, '暂无必备技能'),
      '',
      '## 加分技能',
      '',
      listSection(jdAnalysis.preferredSkills, '暂无加分技能'),
      '',
      '## 软技能',
      '',
      listSection(jdAnalysis.softSkills, '暂无软技能'),
      '',
      '## 关键词',
      '',
      listSection(jdAnalysis.keywords, '暂无关键词'),
      '',
      '## 补充建议',
      '',
      gapSuggestionsSection(source.gapSuggestions),
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
    buildResumeChatCompletionBody,
    readChatCompletionResult,
    formatAiServiceError,
    normalizeChangeSummary,
    parseAiResumeResponse,
    normalizeResumeWarnings,
    buildAnalysisMarkdown,
  };
}));
