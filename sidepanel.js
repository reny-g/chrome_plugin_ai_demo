// sidepanel.js — 侧边栏 UI 逻辑

const $ = (id) => document.getElementById(id);
const els = {
  summaryModeTab: $('summary-mode-tab'),
  resumeModeTab: $('resume-mode-tab'),
  summaryModePanel: $('summary-mode-panel'),
  resumeModePanel: $('resume-mode-panel'),
  provider: $('provider-select'),
  btn: $('summarize-btn'),
  status: $('status'),
  result: $('result-area'),
  title: $('page-title'),
  url: $('page-url'),
  summary: $('summary-content'),
  sourceEvidence: $('source-evidence'),
  sourceStats: $('source-stats'),
  sourceContent: $('source-content'),
  copyBtn: $('copy-btn'),
  copySourceBtn: $('copy-source-btn'),
  providerTag: $('provider-tag'),
  options: $('open-options'),
  resumeStatusTag: $('resume-status-tag'),
  resumeMeta: $('resume-meta'),
  resumeFileInput: $('resume-file-input'),
  uploadResumeBtn: $('upload-resume-btn'),
  viewResumeBtn: $('view-resume-btn'),
  clearResumeBtn: $('clear-resume-btn'),
  resumePreview: $('resume-preview'),
  optimizeResumeBtn: $('optimize-resume-btn'),
  resumeResult: $('resume-result-area'),
};

const resumeUtils = window.ResumeOptimizerUtils;
let savedResume = null;

// 初始化：从 storage 读默认 provider
chrome.storage.local.get({ provider: 'openai' }).then((s) => {
  els.provider.value = s.provider;
});

els.summaryModeTab.addEventListener('click', () => setMode('summary'));
els.resumeModeTab.addEventListener('click', () => setMode('resume'));

els.provider.addEventListener('change', () => {
  chrome.storage.local.set({ provider: els.provider.value });
});

els.options.addEventListener('click', () => chrome.runtime.openOptionsPage());

els.btn.addEventListener('click', runSummarize);
els.optimizeResumeBtn.addEventListener('click', runResumeOptimization);

els.uploadResumeBtn.addEventListener('click', () => els.resumeFileInput.click());

els.resumeFileInput.addEventListener('change', async () => {
  const [file] = els.resumeFileInput.files || [];
  if (file) await handleResumeUpload(file);
  els.resumeFileInput.value = '';
});

els.viewResumeBtn.addEventListener('click', () => {
  if (!savedResume?.markdown) return;
  els.resumePreview.textContent = savedResume.markdown;
  els.resumePreview.classList.toggle('hidden');
});

els.clearResumeBtn.addEventListener('click', clearSavedResume);

els.copyBtn.addEventListener('click', async () => {
  const text = els.summary.innerText;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    els.copyBtn.textContent = '已复制 ✓';
    setTimeout(() => (els.copyBtn.textContent = '复制摘要'), 1500);
  } catch (e) {
    showStatus('复制失败：' + e.message, 'error');
  }
});

els.copySourceBtn.addEventListener('click', async () => {
  const text = els.sourceContent.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    els.copySourceBtn.textContent = '已复制 ✓';
    setTimeout(() => (els.copySourceBtn.textContent = '复制原文'), 1500);
  } catch (e) {
    showStatus('复制失败：' + e.message, 'error');
  }
});

setMode('summary');
loadSavedResume();

function setMode(mode) {
  const isResume = mode === 'resume';
  els.summaryModeTab.classList.toggle('active', !isResume);
  els.resumeModeTab.classList.toggle('active', isResume);
  els.summaryModeTab.setAttribute('aria-selected', String(!isResume));
  els.resumeModeTab.setAttribute('aria-selected', String(isResume));
  els.summaryModePanel.classList.toggle('hidden', isResume);
  els.resumeModePanel.classList.toggle('hidden', !isResume);
}

async function loadSavedResume() {
  const stored = await chrome.storage.local.get({ [resumeUtils.RESUME_STORAGE_KEY]: null });
  savedResume = stored[resumeUtils.RESUME_STORAGE_KEY];
  renderResumeState();
}

function renderResumeState() {
  const hasResume = Boolean(savedResume?.markdown);
  els.resumeStatusTag.textContent = hasResume ? '已保存' : '未上传';
  els.resumeMeta.textContent = hasResume
    ? `${savedResume.fileName} · ${savedResume.length.toLocaleString()} 字符 · ${formatResumeTime(savedResume.updatedAt)}`
    : '上传一份 Markdown 简历后，可以根据当前网页 JD 生成优化版本。';
  els.viewResumeBtn.disabled = !hasResume;
  els.clearResumeBtn.disabled = !hasResume;
  els.optimizeResumeBtn.disabled = !hasResume;
  if (!hasResume) {
    els.resumePreview.classList.add('hidden');
    els.resumePreview.textContent = '';
  }
}

async function handleResumeUpload(file) {
  const markdown = await file.text();
  const validation = resumeUtils.validateMarkdownFileMeta(file, markdown);
  if (!validation.ok) {
    showStatus(validation.error, 'error');
    return;
  }

  savedResume = resumeUtils.buildResumeRecord(file.name, markdown);
  await chrome.storage.local.set({ [resumeUtils.RESUME_STORAGE_KEY]: savedResume });
  els.resumePreview.classList.add('hidden');
  els.resumePreview.textContent = '';
  renderResumeState();
  showStatus('简历已保存到浏览器本地。', 'success');
}

async function clearSavedResume() {
  await chrome.storage.local.remove(resumeUtils.RESUME_STORAGE_KEY);
  savedResume = null;
  renderResumeState();
  els.resumeResult.classList.add('hidden');
  els.resumeResult.innerHTML = '';
  showStatus('已清除本地简历。', 'success');
}

function formatResumeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toLocaleString();
}

async function runResumeOptimization() {
  if (!savedResume?.markdown) {
    showStatus('请先上传 Markdown 简历。', 'error');
    return;
  }

  els.optimizeResumeBtn.disabled = true;
  els.resumeResult.classList.add('hidden');
  els.resumeResult.innerHTML = '';
  showStatus('正在读取当前网页并生成简历优化...', 'loading');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'OPTIMIZE_RESUME_FOR_ACTIVE_TAB' });
    if (!response?.ok) throw new Error(response?.error || '未知错误');
    renderResumeOptimizationResult(response.data || {});
    hideStatus();
  } catch (error) {
    showStatus('生成简历优化失败：' + (error?.message || error), 'error');
  } finally {
    els.optimizeResumeBtn.disabled = !savedResume?.markdown;
  }
}

function downloadMarkdown(fileName, markdown) {
  const blob = new Blob([String(markdown || '')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderResumeOptimizationResult(data) {
  const result = data || {};
  els.resumeResult.classList.remove('hidden');

  if (result.parseError) {
    const rawOutput = result.rawOutput || result.raw || '';
    els.resumeResult.innerHTML = `
      <section class="result-block warning-block">
        <h2>格式异常</h2>
        <p>${escapeHtml(result.parseError)}</p>
      </section>
      <section class="result-block">
        <h2>AI 原始输出</h2>
        <pre class="markdown-preview">${escapeHtml(rawOutput)}</pre>
      </section>
    `;
    return;
  }

  const analysisMarkdown = resumeUtils.buildAnalysisMarkdown(result);
  const aspirationalMarkdown = String(result.aspirationalResumeMarkdown || '');
  const groundedMarkdown = String(result.groundedResumeMarkdown || '');
  const resumeFileName = result.resumeFileName || savedResume?.fileName || 'resume.md';
  const aspirationalName = resumeUtils.buildDownloadFileName(resumeFileName, 'aspirational');
  const groundedName = resumeUtils.buildDownloadFileName(resumeFileName, 'grounded');
  const analysisName = resumeUtils.buildDownloadFileName(resumeFileName, 'analysis');

  els.resumeResult.innerHTML = `
    <section class="result-block">
      <div class="section-heading">
        <h2>JD 分析与建议</h2>
        <div class="action-row compact">
          <button id="download-analysis-btn" class="ghost-btn" type="button">下载分析</button>
        </div>
      </div>
      <div class="markdown-body-lite">${renderMarkdown(analysisMarkdown)}</div>
    </section>
    <section class="result-block">
      <div class="section-heading">
        <h2>进阶简历</h2>
        <div class="action-row compact">
          <button id="copy-aspirational-btn" class="ghost-btn" type="button">复制</button>
          <button id="download-aspirational-btn" class="ghost-btn" type="button">下载</button>
        </div>
      </div>
      <div class="markdown-body-lite">${renderMarkdown(aspirationalMarkdown || '暂无进阶简历内容。')}</div>
    </section>
    <section class="result-block">
      <div class="section-heading">
        <h2>稳妥简历</h2>
        <div class="action-row compact">
          <button id="copy-grounded-btn" class="ghost-btn" type="button">复制</button>
          <button id="download-grounded-btn" class="ghost-btn" type="button">下载</button>
        </div>
      </div>
      <div class="markdown-body-lite">${renderMarkdown(groundedMarkdown || '暂无稳妥简历内容。')}</div>
    </section>
  `;

  bindResumeResultButton('copy-aspirational-btn', () => copyResumeMarkdown(aspirationalMarkdown, '进阶简历已复制。'));
  bindResumeResultButton('download-aspirational-btn', () => downloadMarkdown(aspirationalName, aspirationalMarkdown));
  bindResumeResultButton('copy-grounded-btn', () => copyResumeMarkdown(groundedMarkdown, '稳妥简历已复制。'));
  bindResumeResultButton('download-grounded-btn', () => downloadMarkdown(groundedName, groundedMarkdown));
  bindResumeResultButton('download-analysis-btn', () => downloadMarkdown(analysisName, analysisMarkdown));
}

function bindResumeResultButton(id, handler) {
  const button = els.resumeResult.querySelector(`#${id}`);
  if (button) button.addEventListener('click', handler);
}

async function copyResumeMarkdown(markdown, successMessage) {
  try {
    await navigator.clipboard.writeText(String(markdown || ''));
    showStatus(successMessage, 'success');
  } catch (error) {
    showStatus('复制失败：' + (error?.message || error), 'error');
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function runSummarize() {
  els.btn.disabled = true;
  els.result.classList.add('hidden');
  els.sourceEvidence.open = false;
  showStatus('正在抓取页面并请求 AI...', 'loading');

  try {
    const response =
      els.provider.value === 'chrome-ai'
        ? await summarizeWithChromeAI()
        : await summarizeWithRemoteAI();

    renderResult(response.data);

    hideStatus();
    els.result.classList.remove('hidden');
  } catch (err) {
    showStatus('生成失败：' + (err?.message || err), 'error');
  } finally {
    els.btn.disabled = false;
  }
}

async function summarizeWithRemoteAI() {
  const response = await chrome.runtime.sendMessage({
    type: 'SUMMARIZE_ACTIVE_TAB',
    options: { provider: els.provider.value },
  });
  if (!response?.ok) throw new Error(response?.error || '未知错误');
  return response;
}

async function summarizeWithChromeAI() {
  if (!('Summarizer' in self)) {
    throw new Error('当前 Chrome 不支持内置 Summarizer API。请确认 Chrome 版本为 138+，并已满足内置 AI 的系统要求。');
  }

  if (!navigator.userActivation?.isActive) {
    throw new Error('Chrome 要求在用户点击后立即创建 Summarizer，请重新点击“一键生成摘要”。');
  }

  const summarizerPromise = createChromeSummarizer();
  const pageDataPromise = chrome.runtime.sendMessage({ type: 'EXTRACT_ACTIVE_TAB' });
  const [summarizer, pageResponse] = await Promise.all([summarizerPromise, pageDataPromise]);

  if (!pageResponse?.ok) {
    summarizer.destroy?.();
    throw new Error(pageResponse?.error || '未能提取当前网页内容');
  }

  const pageData = pageResponse.data;
  const content =
    pageData.content.length > 12000
      ? pageData.content.slice(0, 12000) + '\n...[内容过长已截断]'
      : pageData.content;

  showStatus('Chrome 内置 AI 正在生成摘要...', 'loading');
  try {
    const summary = await summarizer.summarize(content);
    return {
      ok: true,
      data: {
        title: pageData.title,
        url: pageData.url,
        summary,
        sourceContent: pageData.content,
        sourceLength: pageData.length || pageData.content.length,
        provider: 'chrome-ai',
      },
    };
  } finally {
    summarizer.destroy?.();
  }
}

async function createChromeSummarizer() {
  showStatus('正在检查 Chrome 内置 AI 可用性...', 'loading');
  const options = {
    type: 'key-points',
    format: 'markdown',
    length: 'medium',
  };
  const availability = await self.Summarizer.availability(options);
  if (availability === 'unavailable') {
    throw new Error(
      [
        'Chrome 内置 Summarizer 当前不可用。',
        '请确认：Chrome 版本为 138+；Chrome profile 所在磁盘至少有 22GB 可用空间；设备满足 16GB 内存+4 核 CPU 或 4GB 以上显存；网络不是按流量计费；chrome://on-device-internals 的 Model Status 没有错误。',
        '如果本机还没下载 Gemini Nano，可尝试在 chrome://flags 启用 optimization-guide-on-device-model 和 prompt-api-for-gemini-nano 后重启 Chrome。',
        '另外，Chrome 内置 Gemini Nano 当前主要支持英语、西语、日语、德语、法语，不适合作为中文摘要主路径。',
        `availability=${availability}`,
      ].join('\n')
    );
  }

  return self.Summarizer.create({
    ...options,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        const percent = Math.round((event.loaded || 0) * 100);
        showStatus(`正在下载 Chrome 内置 AI 模型：${percent}%`, 'loading');
      });
    },
  });
}

function renderResult(data) {
  const { title, url, summary, provider, sourceContent = '', sourceLength = 0 } = data;
  els.title.textContent = title || '(无标题)';
  els.url.textContent = url || '';
  els.url.href = url || '#';
  els.summary.innerHTML = renderMarkdown(summary);
  els.sourceContent.textContent = sourceContent || '未获取到可展示的原文。';
  els.sourceStats.textContent = sourceLength ? `${sourceLength.toLocaleString()} 字` : '';
  els.providerTag.textContent =
    provider === 'chrome-ai' ? 'Chrome 内置 Summarizer' :
    provider === 'claude' ? 'Claude' : 'OpenAI / Doubao';
}

function showStatus(msg, kind) {
  els.status.textContent = msg;
  els.status.className = `status ${kind}`;
}
function hideStatus() {
  els.status.className = 'status hidden';
}

// 极简 Markdown 渲染（标题/列表/加粗/代码/段落）
function renderMarkdown(md) {
  const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lines = escape(md).split('\n');
  const out = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^### /.test(line))      { closeList(); out.push(`<h3>${line.slice(4)}</h3>`); }
    else if (/^## /.test(line))  { closeList(); out.push(`<h2>${line.slice(3)}</h2>`); }
    else if (/^# /.test(line))   { closeList(); out.push(`<h1>${line.slice(2)}</h1>`); }
    else if (/^[-*] /.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (line === '') {
      closeList();
      out.push('');
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');

  function closeList() { if (inList) { out.push('</ul>'); inList = false; } }
  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
}
