// sidepanel.js — 侧边栏 UI 逻辑

const $ = (id) => document.getElementById(id);
const els = {
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
};

// 初始化：从 storage 读默认 provider
chrome.storage.local.get({ provider: 'openai' }).then((s) => {
  els.provider.value = s.provider;
});

els.provider.addEventListener('change', () => {
  chrome.storage.local.set({ provider: els.provider.value });
});

els.options.addEventListener('click', () => chrome.runtime.openOptionsPage());

els.btn.addEventListener('click', runSummarize);

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
