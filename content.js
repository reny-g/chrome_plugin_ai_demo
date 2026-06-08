// content.js — 通过 chrome.scripting 注入到目标页面
// 暴露一个全局函数，供 background 二次调用拿到提取结果

(function () {
  if (window.__AI_SUMMARY_EXTRACT__) return; // 防止重复注入

  // 干扰元素的选择器：脚本、样式、导航、广告、评论等
  const NOISE_SELECTORS = [
    'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
    'header', 'footer', 'nav', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.advertisement', '.ad', '.ads', '.sidebar', '.comments', '.comment-list',
  ];

  // 常见正文容器候选选择器（按优先级）
  const ARTICLE_CANDIDATES = [
    'article',
    '[role="article"]',
    'main',
    '.article-content', '.post-content', '.entry-content', '.markdown-body',
    '#content', '.content',
  ];

  /** 克隆节点并移除噪声元素 */
  function cleanClone(node) {
    const clone = node.cloneNode(true);
    NOISE_SELECTORS.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });
    return clone;
  }

  /** 计算节点的"正文密度"得分：文本长度 - 链接文本长度 */
  function scoreNode(node) {
    const text = (node.innerText || '').trim();
    if (text.length < 100) return 0;
    const linkText = Array.from(node.querySelectorAll('a'))
      .reduce((sum, a) => sum + (a.innerText || '').length, 0);
    // 链接占比高的（如导航列表）降权
    const linkRatio = linkText / text.length;
    return text.length * (1 - Math.min(linkRatio, 0.9));
  }

  /** 主提取逻辑 */
  function extract() {
    // 1. 优先尝试常见正文容器
    for (const sel of ARTICLE_CANDIDATES) {
      const el = document.querySelector(sel);
      if (el && (el.innerText || '').trim().length > 200) {
        const cleaned = cleanClone(el);
        return finalize(cleaned.innerText);
      }
    }

    // 2. 兜底：遍历 body 下所有候选块，挑得分最高的
    const blocks = document.body.querySelectorAll('div, section, article');
    let best = null;
    let bestScore = 0;
    blocks.forEach((b) => {
      const s = scoreNode(b);
      if (s > bestScore) {
        bestScore = s;
        best = b;
      }
    });
    if (best) {
      const cleaned = cleanClone(best);
      return finalize(cleaned.innerText);
    }

    // 3. 最终兜底：整页文本
    const cleaned = cleanClone(document.body);
    return finalize(cleaned.innerText);
  }

  function finalize(text) {
    const normalized = (text || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return {
      title: document.title || '',
      url: location.href,
      content: normalized,
      length: normalized.length,
    };
  }

  window.__AI_SUMMARY_EXTRACT__ = extract;
})();
