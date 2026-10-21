const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('lampa-anime-filler.js', 'utf8');
const params = [];
const components = [];
let rowQueries = 0;
const listeners = Object.create(null);
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
    Listener: { follow(event, fn) { (listeners[event] ||= []).push(fn); } },
    Storage: {
      get(name, fallback) { return storage.has(name) ? storage.get(name) : fallback; },
      set(name, value) { storage.set(name, value); }
    }
  },
  console,
  setTimeout() { return 1; },
  clearTimeout() {},
  Promise,
  fetch() {
    return Promise.resolve({ok: true, json() {
      return Promise.resolve([{slug: 'one-piece', title:'One Piece', episodes:[{number:196, type:'Filler'},{number:207,type:'Canon'}]}]);
    }});
  }
};

vm.runInNewContext(source, context);
assert.equal(context.window.LampaAnimeFiller.version, '0.2.2');
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

const full = listeners.full && listeners.full[0];
assert.equal(typeof full, 'function', 'full screen handler must be registered');
full({type: 'complite', data: {movie: {id: 37854, name: 'Ван-Пис', original_name: 'ワンピース'}}, object: {}});
assert.equal(context.window.LampaAnimeFiller.state.slug, 'one-piece',
  'TMDB 37854 must resolve to one-piece regardless of localized title');
assert.equal(context.window.LampaAnimeFiller.state.movie.id, 37854);
Promise.resolve().then(() => Promise.resolve()).then(() => {
  const guide = context.window.LampaAnimeFiller.state.guide;
  assert.ok(guide && guide.episodes[196] === 'filler',
    'One Piece guide must load via fallback dataset');
  console.log('One Piece localized-title lookup test passed.');
}).catch(err => {console.error(err); process.exitCode = 1;});
