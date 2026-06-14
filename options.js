// options.js — 设置页逻辑

const DEFAULTS = {
  provider: 'openai',
  apiBase: 'https://ark.cn-beijing.volces.com/api/coding',
  apiKey: '',
  model: 'doubao-seed-2.0-pro',
};

const CUSTOM_PRESET_ID = 'custom';

const $ = (id) => document.getElementById(id);
const els = {
  provider: $('provider'),
  apiBase: $('apiBase'),
  apiKey: $('apiKey'),
  model: $('model'),
  openaiFields: $('openai-fields'),
  presetField: $('preset-field'),
  providerPreset: $('providerPreset'),
  presetNote: $('preset-note'),
  save: $('save'),
  reset: $('reset'),
  tip: $('saved-tip'),
};

let presets = [];

const normalizeBase = (url) => (url || '').trim().replace(/\/$/, '');

function syncFieldVisibility() {
  const provider = els.provider.value;
  els.openaiFields.style.display = provider === 'chrome-ai' ? 'none' : '';
  // 服务商预设仅适用于 OpenAI 兼容协议
  els.presetField.style.display = provider === 'openai' ? '' : 'none';
}

function renderPresetOptions() {
  const options = presets.map(
    (p) => `<option value="${p.id}">${p.label}</option>`
  );
  options.push(`<option value="${CUSTOM_PRESET_ID}">自定义</option>`);
  els.providerPreset.innerHTML = options.join('');
}

function updatePresetNote() {
  const matched = presets.find((p) => p.id === els.providerPreset.value);
  els.presetNote.textContent = matched && matched.note
    ? matched.note
    : '选择服务商可自动填入接口地址与默认模型，仍可手动修改。';
}

// 根据当前 apiBase 反查匹配的预设，匹配不到则视为自定义
function syncPresetFromApiBase() {
  const current = normalizeBase(els.apiBase.value);
  const matched = presets.find((p) => normalizeBase(p.apiBase) === current);
  els.providerPreset.value = matched ? matched.id : CUSTOM_PRESET_ID;
  updatePresetNote();
}

function applyPreset() {
  const matched = presets.find((p) => p.id === els.providerPreset.value);
  if (matched) {
    els.apiBase.value = matched.apiBase;
    if (matched.model) els.model.value = matched.model;
  }
  updatePresetNote();
}

async function loadPresets() {
  try {
    const config = await loadJsonConfig('config/providers.json');
    presets = Array.isArray(config?.presets) ? config.presets : [];
    renderPresetOptions();
  } catch (err) {
    // 配置加载失败时降级为纯手动填写，不阻塞设置页
    console.error('[options] 服务商预设加载失败:', err);
    presets = [];
    els.presetField.style.display = 'none';
  }
}

async function load() {
  await loadPresets();
  const stored = await chrome.storage.local.get(DEFAULTS);
  els.provider.value = stored.provider;
  els.apiBase.value = stored.apiBase;
  els.apiKey.value = stored.apiKey;
  els.model.value = stored.model;
  syncFieldVisibility();
  if (presets.length) syncPresetFromApiBase();
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
els.providerPreset.addEventListener('change', applyPreset);
els.apiBase.addEventListener('input', () => {
  if (presets.length) syncPresetFromApiBase();
});
els.save.addEventListener('click', save);
els.reset.addEventListener('click', reset);

load();
