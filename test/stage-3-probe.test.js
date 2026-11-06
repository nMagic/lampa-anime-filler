'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// Reuse the stage-1 observer harness without exposing internals in the plugin
// or registering the old tests twice. No runtime dependencies or network.
const oldTests = fs.readFileSync(path.join(__dirname, 'anime-filler.test.js'), 'utf8')
const harnessModule = { exports: {} }
const boundary = oldTests.indexOf("test('initializes immediately")
assert.ok(boundary > 0)
new Function('require', '__dirname', 'module', oldTests.slice(0, boundary) +
    '\nmodule.exports = { createHarness, flush, diagnosticsText, FakeMutationObserver }')(
    require, __dirname, harnessModule)
const { createHarness, flush, diagnosticsText, FakeMutationObserver } = harnessModule.exports

// Entirely synthetic API data. IDs here are not evidence of a live Kodik
// mapping. Real catalogue IDs only exercise namespace consistency checks.
const url = 'https://kodik-api.com/search?token=PRIVATE_TOKEN&limit=100&with_episodes=true&shikimori_id=20'
const link = n => '//kodik.info/seria/' + n + '/synthetic/720p'
function material(overrides = {}) {
    return {
        id: 'serial-7001', title: 'Synthetic Naruto', title_orig: 'Naruto', shikimori_id: '20',
        translation: { id: 609, title: 'AniDUB' },
        seasons: { '1': { episodes: { '1': link(101), '3': link(103) } } },
        ...overrides
    }
}
function setup() {
    const h = createHarness()
    const originalRequest = function UnchangedReguest() {}
    h.lampa.Reguest = originalRequest
    h.run()
    assert.equal(h.lampa.Reguest, originalRequest)
    const a = h.makeActivity({ id: 46260, source: 'tmdb', media_type: 'tv', title: 'Naruto' })
    h.startActivity(a)
    return { h, a }
}
function before(h, params = { url }) { h.emit('request_before', { params }); return params }
function respond(h, params, results) { h.emit('request_secuses', { params, data: { results } }) }
function rows(h, a, m, season = '1') {
    a.root.clear()
    for (const raw of Object.keys(m.seasons[season].episodes)) h.addEpisode(a, {
        season, episode: parseInt(raw), translate_voice: m.translation.title,
        orig_title: m.title_orig || m.title, link: m.seasons[season].episodes[raw]
    })
}
function probeText(h) { return diagnosticsText(h).split('Эксперимент метаданных Kodik:')[1] }

test('observes native Lampa events only and binds all current exact rows to one material/translation', async () => {
    const { h, a } = setup(), m = material(), params = before(h)
    const payload = { results: [m], cookies: 'PRIVATE_COOKIE', headers: { Authorization: 'PRIVATE_AUTH' } }
    const original = JSON.stringify(payload), args = { params, data: payload }
    const beforeParams = JSON.stringify(params)
    const success = function originalSuccess() {}, error = function originalError() {}
    params.complite = success; params.error = error
    h.emit('request_secuses', args)
    assert.equal(JSON.stringify(payload), original)
    assert.equal(params.complite, success); assert.equal(params.error, error)
    assert.equal(JSON.stringify(params), beforeParams)
    rows(h, a, m); await flush()
    const text = probeText(h)
    assert.match(text, /list_bound/)
    assert.match(text, /serial-7001/)
    assert.match(text, /609 \/ AniDUB/)
    assert.match(text, /Исходный Shikimori ID: 20/)
    assert.match(text, /Исходные ключи эпизодов: 1, 3/)
    assert.match(text, /не подтверждены/)
    assert.doesNotMatch(diagnosticsText(h), /PRIVATE_TOKEN|PRIVATE_COOKIE|PRIVATE_AUTH|kodik-api\.com\/search|\/seria\//)
    assert.match(diagnosticsText(h), /Нумерация Kodik подтверждена: нет/)
})

test('an observed response is never treated as a selected or current list on its own', async () => {
    const { h, a } = setup(), m = material()
    respond(h, before(h), [m]); await flush()
    assert.doesNotMatch(probeText(h), /Выбранный материал Kodik/)
    h.addEpisode(a, { orig_title: 'Naruto', link: link(999) }); await flush()
    assert.match(probeText(h), /row_not_joined/)
    assert.doesNotMatch(probeText(h), /serial-7001/)
})

test('updates voice and season from the same response without extra requests or inferred renumbering', async () => {
    const { h, a } = setup(), m = material(), voice = material({ id: 'serial-7002', translation: { id: 735, title: '2x2' },
        seasons: { '1': { episodes: { '1': link(201) } }, '2': { episodes: { '53': link(253), '55': link(255) } } } })
    respond(h, before(h), [m, voice]); rows(h, a, m); await flush()
    assert.match(probeText(h), /serial-7001/)
    rows(h, a, voice); await flush()
    assert.match(probeText(h), /serial-7002/); assert.match(probeText(h), /735 \/ 2x2/)
    rows(h, a, voice, '2'); await flush()
    assert.match(probeText(h), /Строк связано \/ текущий сезон: 2 \/ 2/)
    assert.match(probeText(h), /Исходные ключи эпизодов: 53, 55/)
    assert.match(probeText(h), /unverified/)
})

test('similar-result selection changes source material even when Lampa card is unchanged', async () => {
    const { h, a } = setup(), original = material(), similar = material({ id: 'serial-8001',
        title: 'Synthetic Shippuden', title_orig: 'Naruto Shippuden', shikimori_id: '1735',
        seasons: { '1': { episodes: { '1': link(801) } } } })
    respond(h, before(h), [original]); rows(h, a, original); await flush()
    respond(h, before(h), [similar]); rows(h, a, similar); await flush()
    assert.match(probeText(h), /serial-8001/)
    assert.match(probeText(h), /Shikimori ID: 1735/)
    assert.match(diagnosticsText(h), /Карточка: Naruto/)
    assert.match(diagnosticsText(h), /Нумерация Kodik подтверждена: нет/)
})

test('ignores search-only, playback, proxy, lookalike-host and unrelated requests', async () => {
    const { h, a } = setup(), m = material()
    const ignored = [url.replace('&with_episodes=true', ''), 'https://kodik.info/seria/1/hash/720p',
        'https://kodik-api.com.evil/search?with_episodes=true', 'https://proxy.invalid/' + url,
        'https://elsewhere.invalid/search?with_episodes=true', url.replace('true', 'false'),
        url + '&with_episodes=false', url.replace('https:', 'http:')]
    for (const requestUrl of ignored) respond(h, before(h, { url: requestUrl }), [m])
    respond(h, before(h, { url, type: 'POST' }), [m])
    respond(h, before(h, { url, dataType: 'text' }), [m])
    respond(h, before(h, { url, post_data: { secret: 'private' } }), [m])
    rows(h, a, m); await flush()
    assert.match(probeText(h), /waiting_request/)
    assert.doesNotMatch(probeText(h), /serial-7001/)
})

test('parallel requests, unmatched param objects and late responses cannot replace the current material', async () => {
    const { h, a } = setup(), old = material(), current = material({ id: 'serial-9001',
        seasons: { '1': { episodes: { '1': link(901) } } } })
    const first = before(h), second = before(h)
    respond(h, second, [current]); rows(h, a, current); await flush()
    respond(h, first, [old])
    respond(h, { url }, [old]); await flush()
    assert.match(probeText(h), /serial-9001/)
    assert.doesNotMatch(probeText(h), /serial-7001/)
})

test('old response after activity change cannot acquire the new card or bind newly rendered old rows', async () => {
    const { h, a } = setup(), stale = before(h), m = material()
    const next = h.makeActivity({ id: 31911, source: 'tmdb', media_type: 'tv', title: 'Brotherhood' })
    h.startActivity(next); respond(h, stale, [m]); rows(h, next, m); await flush()
    assert.match(probeText(h), /waiting_request/)
    assert.doesNotMatch(probeText(h), /serial-7001/)
    assert.notEqual(a, next)
})

test('switching balancer and returning rejects an old response and old-generation DOM', async () => {
    const { h, a } = setup(), m = material(), ticket = before(h)
    respond(h, ticket, [m]); rows(h, a, m); await flush()
    h.lampa.Storage.set('online_mod_balanser', 'rezka'); await flush()
    assert.doesNotMatch(probeText(h), /Выбранный материал Kodik/)
    h.lampa.Storage.set('online_mod_balanser', 'kodik')
    respond(h, ticket, [m]); await flush()
    assert.match(diagnosticsText(h), /old_generation_visible/)
    assert.doesNotMatch(probeText(h), /serial-7001/)
    respond(h, before(h), [m]); rows(h, a, m); await flush()
    assert.match(probeText(h), /list_bound/)
})

test('history reuses evidence for existing nodes, while pending requests from a past activation stay invalid', async () => {
    const { h, a } = setup(), m = material(), ticket = before(h)
    respond(h, ticket, [m]); rows(h, a, m); await flush()
    h.leaveActivity(a); await flush()
    assert.doesNotMatch(probeText(h), /Выбранный материал Kodik/)
    h.returnActivity(a); await flush()
    assert.match(probeText(h), /list_bound/)
    respond(h, ticket, [material({ id: 'serial-1234' })]); await flush()
    assert.match(probeText(h), /serial-7001/)
})

test('missing, prefixed and nonstandard IDs are not silently promoted to MAL or episode classifications', async () => {
    const { h, a } = setup()
    for (const [id, status] of [[null, /shikimori_missing/], ['z20', /prefixed_namespace_unverified: z20/],
        ['zz20', /prefixed_namespace_unverified: zz20/], ['20abc', /shikimori_missing/], ['https://secret', /shikimori_missing/]]) {
        const m = material({ shikimori_id: id })
        respond(h, before(h), [m]); rows(h, a, m); await flush()
        assert.match(probeText(h), status)
        assert.match(diagnosticsText(h), /Нумерация Kodik подтверждена: нет/)
    }
})

test('one selected material requires all rows, original title, exact links and a unique translation', async () => {
    const { h, a } = setup(), m = material(), sameLinks = material({ id: 'serial-9999' })
    respond(h, before(h), [m, sameLinks]); rows(h, a, m); await flush()
    assert.match(probeText(h), /ambiguous_material_or_translation/)
    respond(h, before(h), [m]); a.root.clear()
    h.addEpisode(a, { episode: 1, orig_title: 'Naruto', link: link(101) }); await flush()
    assert.match(probeText(h), /incomplete_list/)
    rows(h, a, m)
    h.addEpisode(a, { episode: 1, orig_title: 'Naruto', link: link(101) }); await flush()
    assert.match(probeText(h), /ambiguous_material_or_translation/)
    a.root.clear(); h.addEpisode(a, { orig_title: 'Other result', link: link(101) }); await flush()
    assert.match(probeText(h), /row_not_joined/)
})

test('retains raw episode keys and does not infer a source numbering scheme from parseInt output', async () => {
    const { h, a } = setup(), m = material({ seasons: { '1': { episodes: { '12.5': link(125), '15a': link(150) } } } })
    respond(h, before(h), [m]); rows(h, a, m); await flush()
    assert.match(probeText(h), /Исходные ключи эпизодов: 12.5, 15a/)
    assert.match(probeText(h), /не подтверждены/)
})

test('late response cannot relabel already existing nodes, even if links and numbers match', async () => {
    const { h, a } = setup(), m = material()
    rows(h, a, m)
    respond(h, before(h), [m]); await flush()
    assert.match(probeText(h), /row_not_joined/)
    assert.doesNotMatch(probeText(h), /serial-7001/)
})

test('errors, malformed and oversized responses fail closed without leaking error payloads', async () => {
    const { h, a } = setup(), m = material()
    h.emit('request_error', { params: before(h), error: { responseText: 'SECRET_ERROR' } })
    assert.match(probeText(h), /request_error/)
    respond(h, before(h), new Array(101).fill(m))
    assert.match(probeText(h), /invalid_or_oversized_response/)
    respond(h, before(h), [material({ seasons: { '1': { episodes: Object.fromEntries(Array.from({ length: 25001 }, (_, i) => [i + 1, link(i + 1)])) } } })])
    rows(h, a, m); await flush()
    assert.match(probeText(h), /invalid_or_oversized_response/)
    assert.doesNotMatch(diagnosticsText(h), /SECRET_ERROR/)
})

test('initial request before Activity.active changes is captured, without publishing an inactive list', async () => {
    const { h } = setup(), a = h.makeActivity(), m = material()
    h.emit('activity', { component: 'online_mod', type: 'init', object: a })
    respond(h, before(h), [m]); rows(h, a, m); await flush()
    assert.doesNotMatch(probeText(h), /list_bound/)
    h.setActive(a); h.emit('activity', { component: 'online_mod', type: 'start', object: a }); await flush()
    assert.match(probeText(h), /list_bound/)
})

test('opening and closing diagnostics performs no request, write, player call or event argument mutation', async () => {
    const { h, a } = setup(), m = material()
    let playerCalls = 0
    h.lampa.Player = { play() { playerCalls++ }, playlist() { playerCalls++ } }
    respond(h, before(h), [m]); rows(h, a, m); await flush()
    const writes = h.calls.storageSets.length, template = h.lampa.Template.get, reguest = h.lampa.Reguest
    for (let i = 0; i < 3; i++) {
        h.openParam('anime_filler_diagnostics').buttons[0].onSelect()
        h.calls.modals.at(-1).onBack()
    }
    assert.equal(h.calls.storageSets.length, writes)
    assert.equal(playerCalls, 0)
    assert.equal(h.lampa.Template.get, template); assert.equal(h.lampa.Reguest, reguest)
    assert.equal(h.calls.listeners.request_before.length, 1)
})

test('namespace consistency uses typed resolver areas without mutating the existing resolver', async () => {
    const h = createHarness(), root = path.join(__dirname, '..')
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json')))
    function XHR() {}
    XHR.prototype.open = function (method, target) { this.target = target }
    XHR.prototype.send = function () {
        this.status = 200
        this.responseText = fs.readFileSync(path.join(root, 'data', this.target.endsWith('manifest.json') ? 'manifest.json' : manifest.file), 'utf8')
        this.onload()
    }
    h.context.XMLHttpRequest = XHR
    h.run()
    const a = h.makeActivity({ id: 46260, source: 'tmdb', media_type: 'tv', title: 'Naruto' })
    h.startActivity(a)
    for (const [id, expected] of [['20', /candidate_consistent_with_card/], ['1735', /candidate_conflicts_with_card/]]) {
        const m = material({ shikimori_id: id })
        respond(h, before(h), [m]); rows(h, a, m); await flush()
        assert.match(probeText(h), expected)
        assert.match(diagnosticsText(h), /Нумерация Kodik подтверждена: нет/)
        assert.match(diagnosticsText(h), /mal:20/)
    }
    const direct = h.makeActivity({ mal_id: 40748, anilist_id: 113415, title: 'Synthetic direct ID card' })
    h.startActivity(direct)
    const directMaterial = material({ shikimori_id: '40748' })
    respond(h, before(h), [directMaterial]); rows(h, direct, directMaterial); await flush()
    assert.match(probeText(h), /candidate_consistent_with_card/)
    const hunter = h.makeActivity({ id: 45952, source: 'tmdb', media_type: 'tv', title: 'Hunter 1999' })
    h.startActivity(hunter)
    const noClassifications = material({ shikimori_id: '136' })
    respond(h, before(h), [noClassifications]); rows(h, hunter, noClassifications); await flush()
    assert.match(probeText(h), /candidate_consistent_with_card/)
    assert.match(diagnosticsText(h), /classification_missing/)
    assert.match(diagnosticsText(h), /Нумерация Kodik подтверждена: нет/)
})

test('same numeric AniList ID is not evidence of a MAL identity', async () => {
    const { h, a } = setup(), m = material({ shikimori_id: '113415' })
    respond(h, before(h), [m]); rows(h, a, m); await flush()
    assert.match(probeText(h), /mal:113415/)
    assert.doesNotMatch(probeText(h), /namespace_confirmed|mal:40748/)
})

test('recreated activity cannot reuse evidence captured by the previous root or a pending request', async () => {
    const { h, a } = setup(), m = material(), pending = before(h)
    respond(h, pending, [m]); rows(h, a, m); await flush()
    h.recreateActivity(a)
    respond(h, pending, [m]); rows(h, a, m); await flush()
    assert.doesNotMatch(probeText(h), /Выбранный материал Kodik/)
    respond(h, before(h), [m]); rows(h, a, m); await flush()
    assert.match(probeText(h), /list_bound/)
})

test('malformed event or response getters cannot interrupt another event subscriber', async () => {
    const { h } = setup()
    const event = {}; Object.defineProperty(event, 'params', { get() { throw Error('SECRET_GETTER') } })
    assert.doesNotThrow(() => h.emit('request_before', event))
    assert.doesNotThrow(() => h.emit('request_secuses', event))
    assert.doesNotThrow(() => h.emit('request_error', event))
    const payload = {}; Object.defineProperty(payload, 'results', { get() { throw Error('SECRET_RESPONSE') } })
    assert.doesNotThrow(() => h.emit('request_secuses', { params: before(h), data: payload }))
    assert.match(probeText(h), /invalid_response/)
    assert.doesNotMatch(diagnosticsText(h), /SECRET_GETTER|SECRET_RESPONSE/)
})
