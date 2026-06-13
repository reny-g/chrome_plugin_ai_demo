// background.js — Service Worker
// 职责：
// 1. 点击插件图标时打开侧边栏
// 2. 接收 sidepanel 的消息，调用 content script 抓取页面内容
// 3. 调用 OpenAI 兼容接口生成摘要

// ============ 1. 点击图标打开侧边栏 ============
try {
  importScripts('resume-prompts.js', 'shared-utils.js');
} catch (err) {
  console.error('[bg] resume modules load failed:', err);
}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[bg] setPanelBehavior failed:', err));

// ============ 2. 消息路由 ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SUMMARIZE_ACTIVE_TAB') {
    handleSummarize(message.options || {})
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true; // 异步响应
  }

  if (message?.type === 'EXTRACT_ACTIVE_TAB') {
    extractActiveTab()
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === 'OPTIMIZE_RESUME_FOR_ACTIVE_TAB') {
    handleResumeOptimization()
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
});

// ============ 3. 抓取当前页正文 ============
async function extractActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('未找到当前标签页');
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) {
    throw new Error('当前页面类型不支持提取（浏览器内置页面）');
  }

  const [{ result: pageData } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js'],
  }).then(() =>
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__AI_SUMMARY_EXTRACT__?.(),
    })
  );

  if (!pageData?.content) throw new Error('未能从页面提取到正文内容');

  return {
    ...pageData,
    url: tab.url,
  };
}

// ============ 4. 核心流程：抓取 → OpenAI 兼容摘要 ============
async function handleSummarize(options) {
  const pageData = await extractActiveTab();
  const settings = await loadSettings();
  const provider = options.provider || settings.provider || 'openai';

  if (provider === 'builtin' || provider === 'chrome-ai') {
    throw new Error('Chrome 内置 Summarizer 必须在侧边栏页面中调用，不能在后台 Service Worker 中调用');
  }

  const summary = await summarizeWithOpenAI(pageData.content, settings);

  return {
    title: pageData.title,
    url: pageData.url,
    summary,
    sourceContent: pageData.content,
    sourceLength: pageData.length || pageData.content.length,
    provider,
  };
}

// ============ 5. OpenAI / Claude 兼容接口 ============
async function handleResumeOptimization() {
  const utils = self.ResumeOptimizerUtils;
  const prompts = self.ResumeOptimizerPrompts;
  if (!utils) throw new Error('简历优化工具未加载，请刷新扩展后重试');
  if (!prompts) throw new Error('简历优化提示词未加载，请刷新扩展后重试');

  const settings = await loadSettings();
  const provider = settings.provider || 'openai';
  const stored = await chrome.storage.local.get(utils.RESUME_STORAGE_KEY);
  const resumeRecord = stored?.[utils.RESUME_STORAGE_KEY];
  const resumeMarkdown = typeof resumeRecord?.markdown === 'string'
    ? resumeRecord.markdown
    : typeof resumeRecord === 'string'
      ? resumeRecord
      : '';

  if (!resumeMarkdown.trim()) {
    throw new Error('请先上传 Markdown 简历');
  }

  if (provider === 'builtin' || provider === 'chrome-ai') {
    throw new Error('简历优化暂不支持 Chrome 内置 AI，请在设置页选择远程 AI 提供商');
  }

  const pageData = await extractActiveTab();
  const truncationWarnings = [];
  const pageContent = truncateWithWarning(
    pageData.content || '',
    12000,
    '\n...[页面内容过长，已截断]',
    '页面内容超过 12000 字符，已截断后发送给 AI'
  );
  if (pageContent.truncated) truncationWarnings.push(pageContent.warning);

  const resumeContent = truncateWithWarning(
    resumeMarkdown,
    20000,
    '\n...[简历内容过长，已截断]',
    '简历内容超过 20000 字符，已截断后发送给 AI'
  );
  if (resumeContent.truncated) truncationWarnings.push(resumeContent.warning);

  const aiResult = await optimizeResumeWithOpenAI({
    pageTitle: pageData.title,
    pageUrl: pageData.url,
    pageContent: pageContent.text,
    resumeMarkdown: resumeContent.text,
    settings,
  });
  const raw = aiResult.content;
  const promptVersion = prompts.RESUME_PROMPT_VERSION;

  if (aiResult.finishReason === 'length') {
    const error = utils.formatAiServiceError(
      'AI 输出达到长度限制，返回内容被截断。请重试或缩短输入内容',
      aiResult.finishReason,
      aiResult.usage
    );
    console.error('[bg] resume optimization response truncated', {
      prompt_version: prompts.RESUME_PROMPT_VERSION,
      finish_reason: aiResult.finishReason,
      usage: aiResult.usage,
      outputLength: raw.length,
    });
    return {
      title: pageData.title,
      url: pageData.url,
      provider,
      promptVersion: prompts.RESUME_PROMPT_VERSION,
      parseError: error,
      rawOutput: raw,
      warnings: truncationWarnings,
    };
  }

  const parsed = utils.parseAiResumeResponse(raw);

  if (!parsed.ok) {
    const error = utils.formatAiServiceError(
      parsed.error,
      aiResult.finishReason,
      aiResult.usage
    );
    console.error('[bg] resume optimization response parse failed', {
      prompt_version: prompts.RESUME_PROMPT_VERSION,
      finish_reason: aiResult.finishReason,
      usage: aiResult.usage,
      outputLength: raw.length,
      parseError: parsed.error,
    });
    return {
      title: pageData.title,
      url: pageData.url,
      provider,
      promptVersion: prompts.RESUME_PROMPT_VERSION,
      parseError: error,
      rawOutput: raw,
      warnings: truncationWarnings,
    };
  }

  return {
    title: pageData.title,
    url: pageData.url,
    provider,
    promptVersion,
    resumeFileName: resumeRecord?.fileName || '',
    jdAnalysis: parsed.jdAnalysis,
    aspirationalResumeMarkdown: parsed.aspirationalResumeMarkdown,
    groundedResumeMarkdown: parsed.groundedResumeMarkdown,
    aspirationalChangeSummary: parsed.aspirationalChangeSummary,
    groundedChangeSummary: parsed.groundedChangeSummary,
    gapSuggestions: parsed.gapSuggestions,
    warnings: utils.normalizeResumeWarnings(parsed.warnings, parsed.jdAnalysis, truncationWarnings),
  };
}

function truncateWithWarning(text, maxLength, marker, warning) {
  const value = String(text || '');
  if (value.length <= maxLength) {
    return { text: value, truncated: false, warning: '' };
  }

  return {
    text: value.slice(0, maxLength) + marker,
    truncated: true,
    warning,
  };
}

async function summarizeWithOpenAI(content, settings) {
  const { apiBase, apiKey, model } = settings;
  if (!apiKey) throw new Error('请先在设置页填写 API Key');

  // 截断超长内容（保留首 12000 字符，足以覆盖常见文章）
  const truncated = content.length > 12000 ? content.slice(0, 12000) + '\n...[内容过长已截断]' : content;

  const resp = await fetch(`${apiBase.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '请用中文总结以下网页内容，覆盖关键事实、数字、结论和限制条件。不要编造原文没有的信息，尽量避免遗漏重要细节，控制在 300 字以内。',
        },
        { role: 'user', content: truncated },
      ],
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`AI 接口调用失败 (${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const summary = data?.choices?.[0]?.message?.content;
  if (!summary) throw new Error('AI 响应格式异常，未拿到摘要内容');
  return summary;
}

// ============ 6. 设置读取 ============
async function optimizeResumeWithOpenAI({ pageTitle, pageUrl, pageContent, resumeMarkdown, settings }) {
  const utils = self.ResumeOptimizerUtils;
  const prompts = self.ResumeOptimizerPrompts;
  if (!utils) throw new Error('简历优化工具未加载，请刷新扩展后重试');
  if (!prompts) throw new Error('简历优化提示词未加载，请刷新扩展后重试');

  const { apiBase, apiKey, model } = settings;
  if (!apiKey) {
    console.error('[bg] missing API key', { prompt_version: prompts.RESUME_PROMPT_VERSION });
    throw new Error('请先在设置页填写 API Key');
  }

  const messages = prompts.buildResumeOptimizationMessages({
    pageTitle,
    pageUrl,
    pageContent,
    resumeMarkdown,
  });
  const resp = await fetch(`${apiBase.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(utils.buildResumeChatCompletionBody({
      model,
      messages,
    })),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let errorData = null;
    try {
      errorData = JSON.parse(text);
    } catch (_) {
      // Keep the original response text for non-JSON service errors.
    }
    const finishReason =
      errorData?.choices?.[0]?.finish_reason ||
      errorData?.error?.finish_reason ||
      'unknown';
    const errorMessage = utils.formatAiServiceError(
      `AI 接口调用失败 (${resp.status}): ${text.slice(0, 200)}`,
      finishReason,
      errorData?.usage
    );
    console.error('[bg] resume optimization service error', {
      prompt_version: prompts.RESUME_PROMPT_VERSION,
      status: resp.status,
      finish_reason: finishReason,
      usage: errorData?.usage || null,
    });
    throw new Error(errorMessage);
  }

  const data = await resp.json();
  const result = utils.readChatCompletionResult(data);
  if (!result.content) {
    const errorMessage = utils.formatAiServiceError(
      'AI 响应格式异常，未拿到简历优化内容',
      result.finishReason,
      result.usage
    );
    console.error('[bg] resume optimization empty response', {
      prompt_version: prompts.RESUME_PROMPT_VERSION,
      finish_reason: result.finishReason,
      usage: result.usage,
    });
    throw new Error(errorMessage);
  }
  return result;
}

async function loadSettings() {
  const defaults = {
    provider: 'openai',
    apiBase: 'https://ark.cn-beijing.volces.com/api/coding',
    apiKey: '',
    model: 'doubao-seed-2.0-pro',
  };
  const stored = await chrome.storage.local.get(defaults);
  return { ...defaults, ...stored };
}
