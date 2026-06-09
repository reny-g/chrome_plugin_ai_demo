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

  function buildJobDownloadFileName(fileName, kind, companyName, jobTitle, date) {
    const base = sanitizeBaseName(fileName);
    const context = [companyName, jobTitle]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map(sanitizeBaseName);
    const safeKind = sanitizeBaseName(kind || 'download');
    return [base, ...context, safeKind, formatDate(date)].join('-') + '.md';
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
      'jdAnalysis 必须是 object，字段包括：isLikelyJobDescription(boolean)、confidence(high|medium|low)、companyName、jobTitle、coreResponsibilities、requiredSkills、preferredSkills、softSkills、keywords。',
      'jdAnalysis 用于概括页面/JD 的公司名称、岗位、职责、硬性要求、加分项、关键词和内容可信度；无法确定公司名称时 companyName 返回未知公司。',
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

  function stripMarkdownInlineFormatting(value) {
    return String(value || '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(`+)(.*?)\1/g, '$2')
      .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
      .replace(/(^|[^\w])([*_])([^*_]+?)\2(?=$|[^\w])/g, '$1$3');
  }

  function normalizeMarkdownComparableText(value) {
    const text = stripMarkdownInlineFormatting(
      String(value || '')
        .normalize('NFC')
        .replace(/\r\n?/g, '\n')
        .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, '')
        .replace(/^\s{0,3}(?:`{3,}|~{3,}).*$/gm, '')
    ).toLowerCase();

    const characters = Array.from(text);
    const isWordCharacter = (character) => (
      Boolean(character) && /[\p{L}\p{N}]/u.test(character)
    );
    const keptTechnicalPunctuation = new Set(['.', '+', '#', '/', '-']);

    return characters
      .map((character, index) => {
        if (!/[\p{P}\p{S}]/u.test(character)) return character;
        if (!keptTechnicalPunctuation.has(character)) return '';

        const previous = characters[index - 1];
        const next = characters[index + 1];
        if (character === '+' || character === '#') {
          return isWordCharacter(previous) || previous === '+' ? character : '';
        }
        if (character === '.') {
          const isDotNetPrefix = characters.slice(index, index + 4).join('') === '.net'
            && !isWordCharacter(characters[index + 4]);
          return isDotNetPrefix || (isWordCharacter(previous) && isWordCharacter(next))
            ? character
            : '';
        }
        if (character === '-') {
          return /\d/.test(previous || '') && /\d/.test(next || '') ? character : '';
        }
        return isWordCharacter(previous) && isWordCharacter(next) ? character : '';
      })
      .join('')
      .replace(/\s+/g, '');
  }

  function parseMarkdownBlocks(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const headingPath = [];
    const blocks = [];
    let pendingType = null;
    let pendingLines = [];
    let codeFence = null;

    const isTableDelimiterRow = (line) => {
      const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      const cells = trimmed.split('|').map((cell) => cell.trim());
      return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
    };
    const isTableRow = (line) => line.includes('|') && Boolean(line.trim());
    const currentSection = () => (
      headingPath.filter(Boolean).join(' / ') || '未分区'
    );
    const appendBlock = (type, text) => {
      const value = text.trim();
      if (!value) return;
      blocks.push({
        section: currentSection(),
        type,
        text: value,
        normalized: normalizeMarkdownComparableText(value),
        index: blocks.length,
      });
    };
    const flushPending = () => {
      if (!pendingType) return;
      appendBlock(pendingType, pendingLines.join('\n'));
      pendingType = null;
      pendingLines = [];
    };
    const startOrAppend = (type, line) => {
      if (pendingType !== type) {
        flushPending();
        pendingType = type;
      }
      pendingLines.push(line);
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (codeFence) {
        pendingLines.push(line);
        const closeMatch = line.match(/^\s{0,3}(`+|~+)\s*$/);
        if (
          closeMatch &&
          closeMatch[1][0] === codeFence.character &&
          closeMatch[1].length >= codeFence.length
        ) {
          flushPending();
          codeFence = null;
        }
        continue;
      }

      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (fenceMatch) {
        flushPending();
        pendingType = 'code';
        pendingLines = [line];
        codeFence = {
          character: fenceMatch[1][0],
          length: fenceMatch[1].length,
        };
        continue;
      }

      const headingMatch = line.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*$/);
      if (headingMatch) {
        flushPending();
        const level = headingMatch[1].length;
        const heading = stripMarkdownInlineFormatting(
          headingMatch[2].replace(/[ \t]+#+[ \t]*$/, '')
        ).trim();
        headingPath.length = level;
        headingPath[level - 1] = heading;
        continue;
      }

      if (!line.trim()) {
        flushPending();
        continue;
      }

      const listMatch = line.match(/^\s{0,3}(?:[-+*]|\d+[.)])[ \t]+(.*)$/);
      if (listMatch) {
        flushPending();
        pendingType = 'list';
        pendingLines = [line];
        continue;
      }

      if (pendingType === 'list' && /^(?: {2,}|\t)\S/.test(line)) {
        pendingLines.push(line);
        continue;
      }

      const quoteMatch = line.match(/^\s{0,3}>[ \t]?(.*)$/);
      if (quoteMatch) {
        startOrAppend('quote', line);
        continue;
      }

      if (
        isTableRow(line) &&
        lineIndex + 1 < lines.length &&
        isTableDelimiterRow(lines[lineIndex + 1])
      ) {
        flushPending();
        const tableLines = [line, lines[lineIndex + 1]];
        lineIndex += 2;
        while (lineIndex < lines.length && isTableRow(lines[lineIndex])) {
          tableLines.push(lines[lineIndex]);
          lineIndex += 1;
        }
        lineIndex -= 1;
        appendBlock('table', tableLines.join('\n'));
        continue;
      }

      startOrAppend('paragraph', line.trim());
    }

    flushPending();
    return blocks;
  }

  function textBigrams(value) {
    const text = normalizeMarkdownComparableText(value).replace(/\s+/g, '');
    if (!text) return new Set();
    if (text.length < 2) return new Set([text]);

    const result = new Set();
    for (let index = 0; index < text.length - 1; index += 1) {
      result.add(text.slice(index, index + 2));
    }
    return result;
  }

  function textSimilarity(left, right) {
    const leftTokens = textBigrams(left);
    const rightTokens = textBigrams(right);
    if (!leftTokens.size && !rightTokens.size) return 1;
    if (!leftTokens.size || !rightTokens.size) return 0;

    let intersection = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) intersection += 1;
    }
    return (2 * intersection) / (leftTokens.size + rightTokens.size);
  }

  function compareMarkdownDocuments(originalMarkdown, optimizedMarkdown) {
    const originalBlocks = parseMarkdownBlocks(originalMarkdown);
    const optimizedBlocks = parseMarkdownBlocks(optimizedMarkdown);
    const matchedOriginal = new Set();
    const matchedOptimized = new Set();
    const exactPairs = [];
    const diffs = [];

    for (const optimized of optimizedBlocks) {
      const original = originalBlocks.find((candidate) =>
        !matchedOriginal.has(candidate.index) &&
        candidate.type === optimized.type &&
        candidate.normalized &&
        candidate.normalized === optimized.normalized
      );
      if (!original) continue;

      matchedOriginal.add(original.index);
      matchedOptimized.add(optimized.index);
      exactPairs.push({ original, optimized });
    }

    for (const pair of exactPairs) {
      const isReordered = exactPairs.some((other) =>
        other !== pair &&
        Math.sign(pair.original.index - other.original.index) !==
          Math.sign(pair.optimized.index - other.optimized.index)
      );
      if (!isReordered) continue;

      diffs.push({
        section: pair.optimized.section,
        type: 'reordered',
        original: pair.original.text,
        optimized: pair.optimized.text,
        originalIndex: pair.original.index,
        optimizedIndex: pair.optimized.index,
      });
    }

    for (const optimized of optimizedBlocks) {
      if (matchedOptimized.has(optimized.index)) continue;

      let bestMatch = null;
      for (const original of originalBlocks) {
        if (matchedOriginal.has(original.index) || original.type !== optimized.type) {
          continue;
        }

        const similarity = textSimilarity(original.text, optimized.text);
        const sectionBonus = original.section === optimized.section ? 0.12 : 0;
        const score = similarity + sectionBonus;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { original, score, similarity };
        }
      }

      if (bestMatch && bestMatch.score >= 0.52 && bestMatch.similarity >= 0.4) {
        matchedOriginal.add(bestMatch.original.index);
        matchedOptimized.add(optimized.index);
        diffs.push({
          section: optimized.section,
          type: 'modified',
          original: bestMatch.original.text,
          optimized: optimized.text,
          originalIndex: bestMatch.original.index,
          optimizedIndex: optimized.index,
        });
      }
    }

    for (const original of originalBlocks) {
      if (matchedOriginal.has(original.index)) continue;
      diffs.push({
        section: original.section,
        type: 'removed',
        original: original.text,
        optimized: '',
        originalIndex: original.index,
        optimizedIndex: -1,
      });
    }

    for (const optimized of optimizedBlocks) {
      if (matchedOptimized.has(optimized.index)) continue;
      diffs.push({
        section: optimized.section,
        type: 'added',
        original: '',
        optimized: optimized.text,
        originalIndex: -1,
        optimizedIndex: optimized.index,
      });
    }

    return diffs.sort((left, right) => {
      const leftIndex = left.optimizedIndex >= 0 ? left.optimizedIndex : left.originalIndex;
      const rightIndex = right.optimizedIndex >= 0 ? right.optimizedIndex : right.originalIndex;
      return leftIndex - rightIndex;
    });
  }

  function inferFactStatus(diff) {
    if (/\[待补充：[^\]]+\]/.test(diff.optimized || '')) return 'placeholder';
    if (diff.type === 'reordered') return 'reordered';
    if (diff.type === 'removed') return 'removed';
    if (diff.type === 'modified') return 'rephrased';
    return 'risk';
  }

  function mergeResumeChanges(localDiffs, changeSummary) {
    const normalizedSummary = normalizeChangeSummary(changeSummary);
    const aiChanges = normalizedSummary.changes;
    const usedAiIndexes = new Set();

    const changes = (Array.isArray(localDiffs) ? localDiffs : []).map((diff) => {
      let bestMatch = null;

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
            : 1;
        const optimizedScore = diff.optimized
          ? textSimilarity(change.optimized, diff.optimized)
          : change.optimized
            ? 0
            : 1;
        const score = sectionScore + originalScore * 0.35 + optimizedScore * 0.4;

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { change, index, score };
        }
      });

      if (bestMatch && bestMatch.score >= 0.62) {
        usedAiIndexes.add(bestMatch.index);
        return {
          ...diff,
          reason: bestMatch.change.reason,
          jdMatch: bestMatch.change.jdMatch,
          factStatus: ['added', 'removed', 'reordered'].includes(diff.type)
            ? inferFactStatus(diff)
            : bestMatch.change.factStatus,
        };
      }

      return {
        ...diff,
        reason: '未提供优化原因',
        jdMatch: [],
        factStatus: inferFactStatus(diff),
      };
    });

    return {
      summary: normalizedSummary.summary,
      changes,
    };
  }

  function reportList(items, emptyText) {
    return items.length
      ? items.map((item) => `- ${String(item)}`).join('\n')
      : `- ${emptyText}`;
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

  function buildResumeComparisonMarkdown(input) {
    const source = input || {};
    const kind = source.kind === 'grounded' ? 'grounded' : 'aspirational';
    const versionTitle = kind === 'grounded' ? '稳妥简历' : '进阶简历';
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

    for (const change of merged.changes) {
      counts[change.factStatus] = (counts[change.factStatus] || 0) + 1;
    }

    const placeholders = Array.from(new Set(
      String(source.optimizedMarkdown || '').match(/\[待补充：[^\]]+\]/g) || []
    ));
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
      `# ${versionTitle}优化对比报告`,
      '',
      '## 基本信息',
      '',
      `- 原简历：${source.resumeFileName || 'resume.md'}`,
      `- 目标岗位：${source.jobTitle || '未命名岗位'}`,
      `- 生成时间：${source.generatedAt || new Date().toISOString()}`,
      `- 版本：${versionTitle}`,
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
      `- 待补充：${placeholders.length}`,
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
      reportList(
        reordered.map((change) => `${change.section}：${change.optimized}`),
        '暂无'
      ),
      '',
      '## 待补充内容',
      '',
      reportList(placeholders, '暂无'),
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
      if ('companyName' in jdAnalysis && typeof jdAnalysis.companyName !== 'string') {
        missing.push('jdAnalysis.companyName');
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
    buildJobDownloadFileName,
    buildResumeOptimizationMessages,
    buildResumeChatCompletionBody,
    readChatCompletionResult,
    formatAiServiceError,
    normalizeChangeSummary,
    normalizeMarkdownComparableText,
    parseMarkdownBlocks,
    textSimilarity,
    compareMarkdownDocuments,
    mergeResumeChanges,
    buildResumeComparisonMarkdown,
    parseAiResumeResponse,
    normalizeResumeWarnings,
    buildAnalysisMarkdown,
  };
}));
