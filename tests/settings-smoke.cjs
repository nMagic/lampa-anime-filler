const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('lampa-anime-filler.js', 'utf8');
const params = [];
const components = [];
let rowQueries = 0;
const storage = new Map([['laf_mark', 'false']]);
const document = {
  head: { appendChild() {} },
  body: null,
  createElement() { return { textContent: '', className: '', appendChild() {} }; },
  querySelectorAll(selector) {
    if (selector !== '.laf-badge' && selector !== '.laf-filler') rowQueries++;
    return [];
  },
  querySelector() { return null; }
};
const context = {
  window: { appready: true },
  document,
  MutationObserver: function () { this.observe = function () {}; },
  Lampa: {
    SettingsApi: {
      addComponent(data) { components.push(data); },
      addParam(data) { params.push(data); }
    },
    Listener: { follow() {} },
    Storage: {
      get(name, fallback) { return storage.has(name) ? storage.get(name) : fallback; },
      set(name, value) { storage.set(name, value); }
    }
  },
  console,
  setTimeout() { return 1; },
  clearTimeout() {},
  Promise
};

vm.runInNewContext(source, context);
assert.equal(context.window.LampaAnimeFiller.version, '0.2.1');
assert.equal(components.length, 1);
assert.equal(params.length, 3);

// Lampa's SettingsApi delegates input to Params.select(name, param.values, default).
// Params.update() then accesses values[name][key] unless values[name] is a string.
// Undefined values caused "Cannot read properties of undefined (reading '')".
for (const p of params) {
  if (p.param.type !== 'input') continue;
  assert.equal(typeof p.param.values, 'string', p.param.name + ' must define values');
  const value = '';
  assert.equal(typeof p.param.values === 'string' ? value : p.param.values[value], '');
}
assert.equal(params.filter(p => p.param.type === 'input').length, 2);

// Lampa stores trigger values as the strings 'true'/'false'.
context.window.LampaAnimeFiller.state.guide = { episodes: {} };
context.window.LampaAnimeFiller.scan();
assert.equal(rowQueries, 0, 'disabled marking must not inspect episode rows');

console.log('Settings smoke test passed (input registration + trigger storage).');
