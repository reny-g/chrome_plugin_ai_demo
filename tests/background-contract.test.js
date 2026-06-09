const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('loads resume prompts before shared utilities', () => {
  const promptImportIndex = source.indexOf("'resume-prompts.js'");
  const utilsImportIndex = source.indexOf("'shared-utils.js'");

  assert.ok(promptImportIndex >= 0);
  assert.ok(promptImportIndex < utilsImportIndex);
});

test('builds resume messages through the prompt module', () => {
  assert.match(source, /prompts\.buildResumeOptimizationMessages\(\{/);
});

test('returns and logs the prompt version without logging prompt content', () => {
  assert.match(source, /promptVersion:\s*prompts\.RESUME_PROMPT_VERSION/);
  assert.match(source, /prompt_version:\s*prompts\.RESUME_PROMPT_VERSION/);
  assert.match(source, /parseError:\s*`\$\{error\}; prompt_version=\$\{prompts\.RESUME_PROMPT_VERSION\}`/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*messages/s);
});
