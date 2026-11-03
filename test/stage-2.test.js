'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const { parseEpisodes, ranges, build, hash, serialize } = require('../tools/build-data')
const root = path.join(__dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json')))
const raw = fs.readFileSync(path.join(root, 'data', manifest.file), 'utf8')
const dataset = JSON.parse(raw)
const plugin = fs.readFileSync(path.join(root, 'anime-filler.js'), 'utf8')
// Access closure-local functions only inside the VM. The shipping plugin exposes no API.
const instrumented = plugin.replace("    if (!window[READY_FLAG]) startPlugin()", `
    window.testing = { dataHash: dataHash, validateDataset: validateDataset, parseManifest: parseManifest,
      state: state, dataState: dataState, resolve: resolveClassifications, load: loadClassifications,
      result: function () { return classification }, base: DATA_BASE, cacheKey: DATA_CACHE_KEY,
      expire: function () { dataChecked = 0; dataAttempted = 0 },
      init: init, begin: beginActivity, leave: leaveActivity, diagnostics: showDiagnostics }
`)

function harness(options = {}) {
    const pending = [], timers = new Map(), storage = options.storage || {}, writes = [], modals = [], events = {}, params = []
    let timerId = 0, language = options.language || 'ru', translations = {}, active = null
    function node() { return { texts: [], append(n) { this.texts.push(n); return this }, text(t) { this.value = t; return this }, allText() { return [this.value || '', ...this.texts.map(n => n.allText())].join('\n') } } }
    function XHR() { pending.push(this) }
    XHR.prototype.open = function (method, url) { this.url = url }
    XHR.prototype.send = function () {}
    XHR.prototype.abort = function () { this.aborted = true }
    XHR.prototype.respond = function (text, status = 200) { this.status = status; this.responseText = text; this.onload() }
    const lampa = {
        Lang: { add(v) { Object.assign(translations, v) }, translate(k) { return translations[k] ? translations[k][language] : k } },
        Storage: { get(k, d) { if (options.readError) throw Error('storage'); return k in storage ? storage[k] : d }, set(k, v) { if (options.writeError) throw Error('quota'); if (!options.silentWriteError) storage[k] = v; writes.push([k, v]) }, field() {}, listener: { follow() {} } },
        SettingsApi: { addComponent() {}, addParam(p) { params.push(p) }, getComponent() {} },
        Component: { get() {} }, Listener: { follow(k, f) { events[k] = f } },
        Template: { get() {} }, Activity: { active() { return active } },
        Modal: { open(p) { modals.push(p) } }, Controller: { toggle() {} }
    }
    const context = vm.createContext({ window: {}, Lampa: lampa, $: node,
        XMLHttpRequest: options.noXHR ? undefined : XHR,
        setTimeout(f) { const id = ++timerId; timers.set(id, f); return id }, clearTimeout(id) { timers.delete(id) },
        MutationObserver: undefined
    })
    vm.runInContext(instrumented, context)
    const api = context.window.testing
    return { api, pending, storage, writes, params, modals, events,
        request() { assert.ok(pending.length); return pending.shift() },
        timeout() { const [id, fn] = timers.entries().next().value; timers.delete(id); fn() },
        setCard(card) { api.state.card = card; api.resolve(); return api.result() },
        ready() { api.dataState.dataset = JSON.parse(raw) },
        load() { api.load() },
        finish() { this.request().respond(JSON.stringify(manifest)); this.request().respond(raw) },
        diagnostic() { api.diagnostics(); return modals.at(-1).html.allText() },
        start(card) { active = { component: 'online_mod', movie: card, activity: { render() { return null } } }; api.begin(active, true); return active },
        language(value) { language = value }
    }
}
const sourceEntry = episodes => ({ series_title: 'Naruto', research_status: 'fixture', citation_sources: [{ id: 'source', url: null }], episodes })
const ep = (n, status) => ({ episode_number: n, status, citation_ids: ['source'] })
const tv = (id, extra = {}) => ({ id, source: 'tmdb', media_type: 'tv', title: 'ignored title', ...extra })
const copy = x => JSON.parse(JSON.stringify(x))
const reManifest = data => { const bytes = JSON.stringify(data); return { raw: bytes, manifest: { ...manifest, sha256: hash(bytes), version: hash(bytes), bytes: Buffer.byteLength(bytes), counts: data.counts } } }

// Actual bootstrap field names and episode categories (Naruto 1, 7 and 26).
test('bootstrap parsing preserves all categories and sparse numbering', () => {
    const p = parseEpisodes(sourceEntry([ep(1, 'canon'), ep(7, 'mixed'), ep(26, 'filler')]))
    assert.deepEqual(p.episodes, [[1, 'canon'], [7, 'mixed'], [26, 'filler']])
    assert.deepEqual(ranges(p.episodes), [[1, 1, 'canon'], [7, 7, 'mixed'], [26, 26, 'filler']])
})
test('duplicate rows are reported; conflicting and unknown rows remain unknown', () => {
    const p = parseEpisodes(sourceEntry([ep(1, 'canon'), ep(1, 'canon'), ep(2, 'filler'), ep(2, 'mixed'), ep(2, 'filler'), ep(3, 'anime_canon'), ep(3, 'canon'), ep(6, 'canon')]))
    assert.deepEqual(p.episodes, [[1, 'canon'], [6, 'canon']])
    assert.ok(p.issues.includes('duplicate:1')); assert.ok(p.issues.includes('classification_conflict:2')); assert.ok(p.issues.includes('unknown_or_uncited:3'))
})
test('empty, malformed, invalid-number and uncited episode inputs', () => {
    assert.throws(() => parseEpisodes({ episodes: [] }), /invalid_structure/)
    assert.deepEqual(parseEpisodes(sourceEntry([])).episodes, [])
    assert.deepEqual(parseEpisodes(sourceEntry([ep(-1, 'canon'), ep('1', 'canon'), { ...ep(3, 'canon'), citation_ids: ['absent'] }])).episodes, [])
})
test('generator validates IDs, conflicts and produces byte-identical output', () => {
    const files = { 'naruto-episodes.json': sourceEntry([ep(1, 'canon'), ep(3, 'filler')]) }
    const catalog = [{ title: 'Naruto', mal_id: 20, anilist_id: 20 }]
    const mappings = { $meta: { schema_version: '3.0.3' }, 'mal:20': { 'anilist:20': {} }, 'anilist:20': { 'mal:20': {} }, 'tmdb_show:46260:s1': { 'mal:20': { '1-220': '1-220' }, 'anilist:20': { '1-220': '1-220' } } }
    const lock = { identities: {}, review: {}, upstream: { afp: { date: '2026-10-02' } }, notices: {} }
    const a = build(files, catalog, mappings, lock), b = build(files, catalog, mappings, lock)
    assert.equal(a.raw, b.raw); assert.equal(serialize(a.manifest), serialize(b.manifest))
    assert.equal(a.manifest.sha256, hash(a.raw)); assert.equal(a.manifest.bytes, Buffer.byteLength(a.raw))
    assert.equal(a.coverage.counts.works, 1)
    assert.equal(build(files, [{ ...catalog[0], mal_id: -20 }], mappings, lock).coverage.counts.works, 0)
    assert.equal(build(files, [{ ...catalog[0], anilist_id: 99 }], mappings, lock).coverage.records[0].result, 'identifier_conflict')
    assert.equal(build({ broken: {} }, catalog, mappings, lock).coverage.records[0].result, 'invalid_structure')
    assert.equal(build({ absent: sourceEntry([]) }, catalog, mappings, lock).coverage.records[0].result, 'incomplete_data')
    assert.equal(build(files, [{ ...catalog[0], title: 'Other' }], mappings, lock).coverage.records[0].result, 'no_confirmed_identifier')
})
test('published manifest, dataset, SHA-256 and full schema agree', () => {
    const h = harness()
    assert.equal(h.api.dataHash(raw), hash(raw)); assert.equal(h.api.parseManifest(JSON.stringify(manifest)).version, hash(raw))
    assert.equal(h.api.validateDataset(raw, manifest).records.length, dataset.counts.works)
    assert.equal(dataset.counts.processed, 138)
    assert.ok(dataset.records.some(r => r.integrity === 'issues'))
    assert.ok(dataset.records.every(r => r.numbering.kodikConfirmed === false))
})
test('portable SHA-256 matches standard vectors, Unicode and block boundaries', () => {
    const h = harness()
    for (const text of ['', 'abc', 'Привет 世界 🐈', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1024)]) assert.equal(h.api.dataHash(text), hash(text))
})
test('runtime rejects bad JSON, schema, hash, counts, duplicate IDs and unknown categories', () => {
    const h = harness()
    assert.throws(() => h.api.parseManifest('{'), /invalid_json/)
    assert.throws(() => h.api.parseManifest('{"schema":2}'), /incompatible_schema/)
    assert.throws(() => h.api.parseManifest(JSON.stringify({ ...manifest, file: '../dataset.json' })), /invalid_manifest/)
    assert.throws(() => h.api.validateDataset(raw + ' ', manifest), /hash_mismatch/)
    for (const mutate of [d => { d.schema = 2 }, d => { d.counts.episodes++ }, d => { d.records.push(d.records[0]) }, d => { d.records[0].ranges[0][2] = 'anime_canon' }, d => { d.records[0].ranges[1][0] = 0 }]) {
        const d = copy(dataset); mutate(d); const v = reManifest(d)
        assert.throws(() => h.api.validateDataset(v.raw, v.manifest))
    }
    const v = '{broken'; assert.throws(() => h.api.validateDataset(v, { ...manifest, sha256: hash(v), bytes: v.length }), /invalid_json/)
})
test('unambiguous TMDB → MAL → classifications and unknown episode semantics', () => {
    const h = harness(); h.ready()
    const r = h.setCard(tv(46260))
    assert.equal(r.status, 'confirmed_id'); assert.equal(r.records.length, 1); assert.equal(r.records[0].mal, 20)
    assert.equal(r.reason, 'numbering_unverified'); assert.equal(r.records[0].numbering.kodikConfirmed, false)
    assert.equal(r.records[0].ranges.some(range => 9999 >= range[0] && 9999 <= range[1]), false)
    assert.equal(h.setCard(tv(31910)).records[0].mal, 1735)
})
test('namespace, TMDB type, explicit IDs and conflicting IDs are handled conservatively', () => {
    const h = harness(); h.ready()
    assert.equal(h.setCard({ id: 46260, media_type: 'tv', title: 'Naruto' }).reason, 'namespace_missing')
    assert.equal(h.setCard(tv(46260, { source: 'kinopoisk' })).reason, 'namespace_missing')
    assert.equal(h.setCard(tv(46260, { media_type: '' })).reason, 'media_type_missing')
    assert.equal(h.setCard(tv(46260, { media_type: '', first_air_date: '2002-10-03' })).status, 'confirmed_id')
    assert.equal(h.setCard(tv(46260, { media_type: 'movie' })).records.length, 0)
    assert.equal(h.setCard({ source: 'kinopoisk', tmdb_id: 46260, type: 'tv' }).status, 'confirmed_id')
    assert.equal(h.setCard(tv(46260, { tmdb_id: 31910 })).reason, 'identifier_conflict')
    assert.equal(h.setCard(tv(46260, { media_type: 'tv', type: 'movie' })).reason, 'identifier_conflict')
    assert.equal(h.setCard(tv(46260, { mal_id: 1735 })).reason, 'identifier_conflict')
    assert.equal(h.setCard({ mal_id: 20, anilist_id: 1735 }).reason, 'identifier_conflict')
    assert.equal(h.setCard(tv(46260, { tmdb_id: true })).reason, 'invalid_identifier')
    assert.equal(h.setCard({ mal_id: 20 }).status, 'confirmed_id')
    assert.equal(h.setCard({ mal_id: 20, anilist_id: 20 }).status, 'confirmed_id')
    assert.equal(h.setCard(tv(999999999, { title: 'Naruto' })).reason, 'mapping_missing')
})
test('Bleach retains original, TYBW parts and unclassified future part as separate areas', () => {
    const h = harness(); h.ready(); const r = h.setCard(tv(30984))
    assert.equal(r.status, 'multiple_areas'); assert.equal(r.candidates, 5)
    assert.deepEqual(Array.from(r.records, r => r.mal).sort((a,b) => a-b), [269, 41467, 53998, 56784])
    assert.ok(r.targets.includes('mal:60636'))
    assert.ok(r.links.some(e => e.source === 'tmdb_show:30984:s2' && e.target === 'mal:53998' && e.ranges['14-26'] === '1-13'))
})
test('real remakes, separate adaptations and unsupported records do not collapse', () => {
    const h = harness(); h.ready()
    assert.equal(h.setCard(tv(37863)).records[0].mal, 121)
    assert.equal(h.setCard(tv(31911)).records[0].mal, 5114)
    const one = h.setCard(tv(37854)); assert.ok(one.records.some(r => r.mal === 21))
    for (const [id, mal] of [[45952, 136], [46298, 11061], [85991, 38680]]) {
        const r = h.setCard(tv(id)); assert.ok(r.targets.includes('mal:' + mal)); assert.equal(r.records.length, 0)
        assert.ok(['classification_missing','multiple_areas'].includes(r.reason))
    }
    const fma = dataset.records.find(r => r.mal === 121)
    assert.ok(fma.counts.filler > 0); assert.match(fma.research, /2003/)
})
test('initial network load commits validated data and cache only after full validation', () => {
    const h = harness(); h.load(); assert.equal(h.api.dataState.status, 'loading'); assert.equal(h.writes.length, 0)
    h.request().respond(JSON.stringify(manifest)); assert.equal(h.writes.length, 0)
    h.request().respond(raw); assert.equal(h.api.dataState.status, 'ready'); assert.equal(h.api.dataState.origin, 'network')
    assert.equal(h.api.dataState.validation, 'sha256_schema_valid'); assert.equal(h.writes.length, 1)
    h.load(); assert.equal(h.pending.length, 0)
})
test('fresh cache is revalidated, reused offline and scoped to this preview', () => {
    const h = harness(); h.load(); h.finish()
    const next = harness({ storage: h.storage, noXHR: true }); next.load()
    assert.equal(next.api.dataState.origin, 'cache'); assert.equal(next.api.dataState.status, 'ready'); assert.equal(next.pending.length, 0)
    assert.match(next.api.cacheKey, /previews\/stage-2-/)
})
test('unchanged manifest does not download dataset again', () => {
    const h = harness(); h.load(); h.finish(); h.api.expire(); h.load()
    h.request().respond(JSON.stringify(manifest)); assert.equal(h.pending.length, 0); assert.equal(h.api.dataState.status, 'ready')
})
for (const failure of ['http_error', 'network_error', 'timeout', 'invalid_json', 'incompatible_schema', 'hash_mismatch']) test('last good cache survives ' + failure, () => {
    const h = harness(); h.load(); h.finish(); const saved = h.storage[h.api.cacheKey]
    h.api.expire(); h.load(); const req = h.request()
    if (failure === 'http_error') req.respond('', 503)
    else if (failure === 'network_error') req.onerror()
    else if (failure === 'timeout') { h.timeout(); req.respond('{}') }
    else if (failure === 'invalid_json') req.respond('{')
    else if (failure === 'incompatible_schema') req.respond('{"schema":2}')
    else { req.respond(JSON.stringify({ ...manifest, version: 'a'.repeat(64), sha256: 'a'.repeat(64), file: 'dataset.' + 'a'.repeat(64) + '.json' })); h.request().respond(raw) }
    assert.equal(h.api.dataState.status, 'ready'); assert.equal(h.api.dataState.error, failure)
    assert.equal(h.storage[h.api.cacheKey], saved); assert.equal(h.api.dataState.version, manifest.version)
})
test('first offline run, corrupt cache and missing transport have no invented data', () => {
    const h = harness(); h.storage[h.api.cacheKey] = '{broken'; h.load(); h.request().onerror()
    assert.equal(h.api.dataState.status, 'unavailable'); assert.equal(h.api.dataState.dataset, null)
    assert.equal(h.setCard(tv(46260)).reason, 'data_unavailable')
    h.load(); assert.equal(h.pending.length, 0) // bounded retry rate
    const no = harness({ noXHR: true }); no.load(); assert.equal(no.api.dataState.error, 'transport_unavailable')
})
test('quota and silent persistence errors keep a valid in-memory dataset', () => {
    for (const opts of [{ writeError: true }, { silentWriteError: true }]) {
        const h = harness(opts); h.load(); h.finish()
        assert.equal(h.api.dataState.status, 'ready'); assert.equal(h.api.dataState.error, 'cache_write_failed')
        assert.equal(h.setCard(tv(46260)).status, 'confirmed_id')
    }
})
test('a stale cache with schema corruption is replaced only by valid network data', () => {
    const h = harness(); h.storage[h.api.cacheKey] = JSON.stringify({ manifest: { schema: 99 }, raw })
    h.load(); assert.equal(h.api.dataState.dataset, null); h.finish(); assert.equal(h.api.dataState.status, 'ready')
})
test('slow responses resolve current card, and never resurrect a departed activity', () => {
    const h = harness(); h.start(tv(46260)); h.start(tv(31910))
    assert.equal(h.pending.length, 1); h.finish()
    assert.equal(h.api.result().records[0].mal, 1735)
    h.start(tv(30984)); assert.equal(h.api.result().status, 'multiple_areas')
    h.api.expire(); h.load(); h.api.leave('inactive', 'online_mod_inactive'); h.request().respond(JSON.stringify(manifest))
    assert.equal(h.api.result().reason, 'no_card'); assert.equal(h.api.state.card, null)
})
test('history restores identity and repeated diagnostics has no requests or writes in RU/EN', () => {
    const h = harness(); h.api.init(); h.start(tv(46260)); h.finish()
    h.api.leave('inactive', 'online_mod_inactive'); h.start(tv(31910)); h.start(tv(46260))
    assert.equal(h.api.result().records[0].mal, 20)
    const writes = h.writes.length, requests = h.pending.length
    for (const lang of ['ru','en']) { h.language(lang); const text = h.diagnostic(); assert.match(text, /AniFillerPedia/); assert.match(text, /Canon \/ Filler \/ Mixed/); assert.match(text, /CC BY-NC-SA/); assert.doesNotMatch(text, /anime_filler_reason_/) }
    assert.equal(h.writes.length, writes); assert.equal(h.pending.length, requests)
})

test('expired cache recovers offline and a compatible changed manifest replaces data independently of JS', () => {
    const first = harness(); first.load(); first.finish()
    const envelope = JSON.parse(first.storage[first.api.cacheKey]); envelope.checked = 1
    first.storage[first.api.cacheKey] = JSON.stringify(envelope)
    const offline = harness({ storage: copy(first.storage) }); offline.load(); offline.request().onerror()
    assert.equal(offline.api.dataState.origin, 'cache'); assert.equal(offline.api.dataState.status, 'ready')
    assert.equal(offline.setCard(tv(46260)).status, 'confirmed_id')
    const changed = copy(dataset); changed.notices.changes += ' Compatible update fixture.'
    const next = reManifest(changed); next.manifest.file = 'dataset.' + next.manifest.sha256 + '.json'
    offline.api.expire(); offline.load(); offline.request().respond(JSON.stringify(next.manifest)); offline.request().respond(next.raw)
    assert.equal(offline.api.dataState.version, next.manifest.sha256)
    assert.equal(offline.api.dataState.origin, 'network'); assert.equal(offline.api.dataState.error, '')
})

test('classification diagnostics lists separate areas without aggregating their statistics', () => {
    const h = harness(); h.api.init(); h.start(tv(30984)); h.finish()
    const text = h.diagnostic()
    assert.equal((text.match(/Запись источника:/g) || []).length, 4)
    assert.equal((text.match(/Canon \/ Filler \/ Mixed:/g) || []).length, 4)
    assert.match(text, /mal:60636/); assert.match(text, /Возможных соответствий: 5/)
    assert.match(text, /multiple_areas/)
})
