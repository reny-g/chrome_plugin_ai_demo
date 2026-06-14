const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const raw = fs.readFileSync(
  path.join(__dirname, '..', 'config', 'providers.json'),
  'utf8'
);

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

let config;

test('providers.json 是合法 JSON', () => {
  config = JSON.parse(raw);
  assert.ok(config && typeof config === 'object');
});

test('包含 version 与非空 presets 数组', () => {
  assert.strictEqual(typeof config.version, 'number');
  assert.ok(Array.isArray(config.presets));
  assert.ok(config.presets.length > 0);
});

test('每个预设含 id / label / apiBase 字段', () => {
  for (const p of config.presets) {
    assert.ok(typeof p.id === 'string' && p.id.length > 0, `id 缺失: ${JSON.stringify(p)}`);
    assert.ok(typeof p.label === 'string' && p.label.length > 0, `label 缺失: ${p.id}`);
    assert.ok(typeof p.apiBase === 'string' && p.apiBase.length > 0, `apiBase 缺失: ${p.id}`);
    assert.ok(typeof p.model === 'string', `model 必须是字符串: ${p.id}`);
  }
});

test('预设 id 不重复', () => {
  const ids = config.presets.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('不使用保留 id "custom"', () => {
  assert.ok(!config.presets.some((p) => p.id === 'custom'));
});

test('apiBase 为合法 http(s) URL 且不以 /chat/completions 结尾', () => {
  for (const p of config.presets) {
    const u = new URL(p.apiBase);
    assert.ok(/^https?:$/.test(u.protocol), `协议非法: ${p.id}`);
    assert.ok(
      !/\/chat\/completions\/?$/.test(p.apiBase),
      `apiBase 不应包含 /chat/completions: ${p.id}`
    );
  }
});
