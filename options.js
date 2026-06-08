// options.js — 设置页逻辑

const DEFAULTS = {
  provider: 'openai',
  apiBase: 'https://ark.cn-beijing.volces.com/api/coding',
  apiKey: '',
  model: 'doubao-seed-2.0-pro',
};

const $ = (id) => document.getElementById(id);
const els = {
  provider: $('provider'),
  apiBase: $('apiBase'),
  apiKey: $('apiKey'),
  model: $('model'),
  openaiFields: $('openai-fields'),
  save: $('save'),
  reset: $('reset'),
  tip: $('saved-tip'),
};

function syncFieldVisibility() {
  els.openaiFields.style.display = els.provider.value === 'chrome-ai' ? 'none' : '';
}

async function load() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  els.provider.value = stored.provider;
  els.apiBase.value = stored.apiBase;
  els.apiKey.value = stored.apiKey;
  els.model.value = stored.model;
  syncFieldVisibility();
}

async function save() {
  const data = {
    provider: els.provider.value,
    apiBase: els.apiBase.value.trim() || DEFAULTS.apiBase,
    apiKey: els.apiKey.value.trim(),
    model: els.model.value.trim() || DEFAULTS.model,
  };
  await chrome.storage.local.set(data);
  els.tip.classList.add('show');
  setTimeout(() => els.tip.classList.remove('show'), 1500);
}

async function reset() {
  await chrome.storage.local.set(DEFAULTS);
  load();
}

els.provider.addEventListener('change', syncFieldVisibility);
els.save.addEventListener('click', save);
els.reset.addEventListener('click', reset);

load();
