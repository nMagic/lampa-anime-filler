(function () {
    'use strict'

    var PLUGIN_NAME = 'Anime Filler'
    var PLUGIN_VERSION = '0.3.1'
    var COMPONENT_ID = 'anime_filler'
    var ABOUT_PARAM_ID = 'anime_filler_about'
    var DIAGNOSTICS_PARAM_ID = 'anime_filler_diagnostics'
    var READY_FLAG = 'lampa_anime_filler_ready'
    var ONLINE_MOD_COMPONENT = 'online_mod'
    var KODIK_SETTINGS_COMPONENT = 'online_mod_kodik'
    var initialized = false
    var templateMetadata = typeof WeakMap === 'function' ? new WeakMap() : null
    var activityGenerations = typeof WeakMap === 'function' ? new WeakMap() : null
    var observer = null
    var observedActivity = null
    var observedRoot = null
    var scanTimer = null
    var generation = 0
    var generationCounter = 0

    var state = {
        onlineModDetected: false,
        kodikDetected: false,
        activityActive: false,
        sourceCandidate: '',
        sourceConfirmed: '',
        card: null,
        season: '',
        voice: '',
        episodes: [],
        exactRows: 0,
        confirmedRows: 0,
        unconfirmedHostname: '',
        status: 'inactive',
        reason: 'online_mod_inactive'
    }

    var SETTINGS_ICON = '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<circle cx="22" cy="22" r="16" stroke="currentColor" stroke-width="3"/>' +
        '<path d="M22 19V31" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="22" cy="13" r="2" fill="currentColor"/>' +
        '</svg>'

    // A preview is a self-contained immutable publication. Compatible schema-1 datasets
    // can be refreshed independently through its manifest in a future stable channel.
    var DATA_BASE = 'https://nmagic.github.io/lampa-anime-filler/previews/stage-2-4307753703a7-cachefix-1/data/'
    var DATA_CACHE_KEY = 'anime_filler_data_v1_' + DATA_BASE
    var DATA_CHECK_INTERVAL = 12 * 60 * 60 * 1000
    var dataState = { status: 'idle', origin: '', version: '', sourceDate: '', validation: '', error: '', dataset: null }
    var classification = { status: 'no_card', reason: 'no_card', records: [], targets: [], links: [], candidates: 0, tmdb: '', media: '' }
    var dataBusy = false
    var dataChecked = 0
    var dataManifest = null
    var dataRaw = ''
    var cacheRead = false
    var dataAttempted = 0

    function dataError(code) { var error = new Error(code); error.dataCode = code; return error }
    function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key) }
    function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) }
    function positiveId(value) {
        if (typeof value !== 'number' && typeof value !== 'string') return ''
        var text = String(value)
        return /^[1-9][0-9]*$/.test(text) && Number(text) <= 9007199254740991 ? text : ''
    }

    // SHA-256 over UTF-8, including on engines without WebCrypto. No dependencies.
    function dataHash(text) {
        var bytes = unescape(encodeURIComponent(text))
        var words = [], i, j, t, a, b, c, d, e, f, g, h, s0, s1, ch, maj, temp1, temp2
        var constants = [1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]
        var result = [1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]
        function rotate(x, n) { return (x >>> n) | (x << (32 - n)) }
        for (i = 0; i < bytes.length; i++) words[i >> 2] = (words[i >> 2] || 0) | (bytes.charCodeAt(i) << (24 - (i % 4) * 8))
        words[bytes.length >> 2] = (words[bytes.length >> 2] || 0) | (0x80 << (24 - (bytes.length % 4) * 8))
        var end = (((bytes.length + 8) >> 6) + 1) * 16
        words[end - 2] = Math.floor(bytes.length / 536870912)
        words[end - 1] = bytes.length * 8
        for (i = 0; i < end; i += 16) {
            var w = []
            for (j = 0; j < 64; j++) {
                if (j < 16) w[j] = words[i + j] | 0
                else {
                    s0 = rotate(w[j - 15], 7) ^ rotate(w[j - 15], 18) ^ (w[j - 15] >>> 3)
                    s1 = rotate(w[j - 2], 17) ^ rotate(w[j - 2], 19) ^ (w[j - 2] >>> 10)
                    w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0
                }
            }
            a = result[0]; b = result[1]; c = result[2]; d = result[3]; e = result[4]; f = result[5]; g = result[6]; h = result[7]
            for (j = 0; j < 64; j++) {
                s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25); ch = (e & f) ^ (~e & g)
                temp1 = (h + s1 + ch + constants[j] + w[j]) | 0
                s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22); maj = (a & b) ^ (a & c) ^ (b & c)
                temp2 = (s0 + maj) | 0
                h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0
            }
            t = [a,b,c,d,e,f,g,h]
            for (j = 0; j < 8; j++) result[j] = (result[j] + t[j]) | 0
        }
        return result.map(function (v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8) }).join('')
    }

    function parseManifest(raw) {
        var m
        try { m = JSON.parse(raw) } catch (error) { throw dataError('invalid_json') }
        if (!plain(m) || m.schema !== 1) throw dataError('incompatible_schema')
        if (!/^[a-f0-9]{64}$/.test(m.sha256) || m.version !== m.sha256 || m.file !== 'dataset.' + m.sha256 + '.json' || typeof m.bytes !== 'number' || m.bytes < 1 || m.bytes > 5000000 || typeof m.sourceDate !== 'string' || !plain(m.counts)) throw dataError('invalid_manifest')
        return m
    }

    function validateDataset(raw, manifest) {
        if (unescape(encodeURIComponent(raw)).length !== manifest.bytes || dataHash(raw) !== manifest.sha256) throw dataError('hash_mismatch')
        var data
        try { data = JSON.parse(raw) } catch (error) { throw dataError('invalid_json') }
        if (!plain(data) || data.schema !== 1) throw dataError('incompatible_schema')
        if (data.source !== 'AniFillerPedia' || !Array.isArray(data.records) || !plain(data.tmdb) || !plain(data.identifiers) || !plain(data.counts) || !plain(data.upstream) || !data.upstream.afp || data.upstream.afp.date !== manifest.sourceDate || !plain(data.notices)) throw dataError('invalid_dataset')
        Object.keys(data.identifiers).forEach(function (id) {
            if (!/^(mal|anilist):[1-9][0-9]*$/.test(id) || !/^(mal|anilist):[1-9][0-9]*$/.test(data.identifiers[id])) throw dataError('invalid_dataset')
        })
        var seen = {}, ids = {}, total = 0
        data.records.forEach(function (record) {
            if (!plain(record) || typeof record.id !== 'string' || !record.id || own(seen, record.id) || typeof record.title !== 'string' || (!positiveId(record.mal) && !positiveId(record.anilist)) || (record.mal !== null && !positiveId(record.mal)) || (record.anilist !== null && !positiveId(record.anilist)) || !Array.isArray(record.ranges) || !record.ranges.length || !plain(record.counts) || !plain(record.numbering) || record.numbering.kind !== 'source_entry' || record.numbering.kodikConfirmed !== false || ['valid', 'issues'].indexOf(record.integrity) === -1 || !Array.isArray(record.issues)) throw dataError('invalid_dataset')
            seen[record.id] = true
            ;['mal', 'anilist'].forEach(function (ns) {
                if (record[ns]) {
                    var key = ns + ':' + record[ns]
                    if (own(ids, key)) throw dataError('identifier_conflict')
                    ids[key] = true
                }
            })
            var previous = 0, counts = { canon: 0, filler: 0, mixed: 0 }
            record.ranges.forEach(function (r) {
                if (!Array.isArray(r) || r.length !== 3 || typeof r[0] !== 'number' || typeof r[1] !== 'number' || !positiveId(r[0]) || !positiveId(r[1]) || r[0] <= previous || r[1] < r[0] || ['canon', 'filler', 'mixed'].indexOf(r[2]) === -1) throw dataError('invalid_dataset')
                previous = r[1]; counts[r[2]] += r[1] - r[0] + 1
            })
            if (record.numbering.min !== record.ranges[0][0] || record.numbering.max !== previous) throw dataError('invalid_dataset')
            ;['canon', 'filler', 'mixed'].forEach(function (key) {
                if (counts[key] !== record.counts[key]) throw dataError('invalid_dataset')
                total += counts[key]
            })
        })
        Object.keys(data.tmdb).forEach(function (card) {
            if (!/^tmdb_(show|movie):[1-9][0-9]*$/.test(card) || !Array.isArray(data.tmdb[card])) throw dataError('invalid_dataset')
            data.tmdb[card].forEach(function (edge) {
                if (!plain(edge) || !/^(mal|anilist):[1-9][0-9]*$/.test(edge.target) || (edge.source !== card && !new RegExp('^' + card + ':s[0-9]+$').test(edge.source)) || !plain(edge.ranges)) throw dataError('invalid_dataset')
                Object.keys(edge.ranges).forEach(function (r) {
                    if (!/^[0-9]+(?:-[0-9]*)?$/.test(r) || (edge.ranges[r] !== null && (typeof edge.ranges[r] !== 'string' || !/^[0-9]+(?:-[0-9]*)?(?:,[0-9]+(?:-[0-9]*)?)*(?:\|-?[0-9]+)?$/.test(edge.ranges[r])))) throw dataError('invalid_dataset')
                })
            })
        })
        if (total !== data.counts.episodes || data.records.length !== data.counts.works) throw dataError('invalid_dataset')
        Object.keys(manifest.counts).forEach(function (key) { if (manifest.counts[key] !== data.counts[key]) throw dataError('invalid_dataset') })
        return data
    }

    function fetchDataText(url, done) {
        if (typeof XMLHttpRequest !== 'function') { done(dataError('transport_unavailable')); return }
        var xhr, timer, finished = false
        function finish(error, text) {
            if (finished) return
            finished = true
            if (timer) clearTimeout(timer)
            done(error, text)
        }
        try {
            xhr = new XMLHttpRequest()
            xhr.open('GET', url, true)
            xhr.onload = function () { finish(xhr.status >= 200 && xhr.status < 300 ? null : dataError('http_error'), xhr.responseText) }
            xhr.onerror = function () { finish(dataError('network_error')) }
            xhr.ontimeout = function () { finish(dataError('timeout')) }
            timer = setTimeout(function () { finish(dataError('timeout')); try { xhr.abort() } catch (ignored) {} }, 15000)
            xhr.send()
        } catch (error) { finish(dataError('network_error')) }
    }

    function acceptDataset(raw, manifest, data, origin) {
        dataRaw = raw; dataManifest = manifest
        dataState.dataset = data; dataState.status = 'ready'; dataState.origin = origin
        dataState.version = manifest.version; dataState.sourceDate = manifest.sourceDate
        dataState.validation = 'sha256_schema_valid'; dataState.error = ''
    }

    function cacheEnvelope(value) {
        // Storage.get() decodes JSON in Lampa, while some compatible hosts
        // return the serialized string. Accept either representation.
        if (typeof value === 'string') value = JSON.parse(value)
        if (!plain(value)) throw dataError('cache_invalid')
        return value
    }

    function saveDataCache() {
        try {
            var value = JSON.stringify({ manifest: dataManifest, raw: dataRaw, checked: dataChecked })
            var writeFailed = false
            Lampa.Storage.set(DATA_CACHE_KEY, value, true, function () { writeFailed = true })
            // get() may return its in-memory copy even if persistence failed.
            // value() bypasses that copy in Lampa and reads localStorage directly.
            var saved = typeof Lampa.Storage.value === 'function' ?
                Lampa.Storage.value(DATA_CACHE_KEY, '') : Lampa.Storage.get(DATA_CACHE_KEY, '')
            if (writeFailed || JSON.stringify(cacheEnvelope(saved)) !== value) throw dataError('cache_write_failed')
        } catch (error) { dataState.error = 'cache_write_failed' }
    }

    function loadClassifications() {
        if (!cacheRead) {
            cacheRead = true
            try {
                var saved = Lampa.Storage.get(DATA_CACHE_KEY, '')
                if (saved) {
                    saved = cacheEnvelope(saved)
                    var manifest = parseManifest(JSON.stringify(saved.manifest))
                    acceptDataset(saved.raw, manifest, validateDataset(saved.raw, manifest), 'cache')
                    dataChecked = typeof saved.checked === 'number' && isFinite(saved.checked) && saved.checked <= Date.now() ? saved.checked : 0
                }
            } catch (error) { dataState.error = 'cache_invalid' }
        }
        resolveClassifications()
        if (dataBusy || (dataState.dataset && Date.now() - dataChecked < DATA_CHECK_INTERVAL) || (dataAttempted && Date.now() - dataAttempted < 60000)) return
        dataAttempted = Date.now()
        dataBusy = true
        dataState.status = dataState.dataset ? 'checking' : 'loading'
        function failure(error) {
            dataBusy = false
            dataState.status = dataState.dataset ? 'ready' : 'unavailable'
            dataState.error = error.dataCode || 'invalid_dataset'
            resolveClassifications()
        }
        fetchDataText(DATA_BASE + 'manifest.json', function (error, raw) {
            if (error) { failure(error); return }
            var next
            try { next = parseManifest(raw) } catch (problem) { failure(problem); return }
            if (dataState.dataset && next.version === dataState.version) {
                try { validateDataset(dataRaw, next) } catch (problem) { failure(problem); return }
                dataChecked = Date.now(); dataBusy = false; dataState.status = 'ready'; dataState.error = ''
                saveDataCache(); resolveClassifications(); return
            }
            fetchDataText(DATA_BASE + next.file, function (error, bytes) {
                if (error) { failure(error); return }
                var data
                try { data = validateDataset(bytes, next) } catch (problem) { failure(problem); return }
                acceptDataset(bytes, next, data, 'network')
                dataBusy = false; dataChecked = Date.now()
                saveDataCache()
                // Global dataset request: always resolve the CURRENT card, never the
                // card that originally triggered this shared, single-flight request.
                resolveClassifications()
            })
        })
    }

    function resolveClassifications() {
        var result = { status: 'unconfirmed', reason: 'no_card', records: [], targets: [], links: [], candidates: 0, tmdb: '', media: '' }
        classification = result
        var card = state.card, data = dataState.dataset
        if (!card) return
        if (!data) { result.reason = 'data_unavailable'; return }
        var media = card.media_type === 'tv' || card.media_type === 'movie' ? card.media_type : ''
        var type = card.type === 'tv' || card.type === 'movie' ? card.type : ''
        if (media && type && media !== type) { result.reason = 'identifier_conflict'; return }
        media = media || type
        if (!media && card.first_air_date && !card.release_date) media = 'tv'
        if (!media && card.release_date && !card.first_air_date) media = 'movie'
        result.media = media
        var tmdb = positiveId(card.tmdb_id)
        if ((available(card.tmdb_id) && !tmdb) || (available(card.mal_id) && !positiveId(card.mal_id)) || (available(card.anilist_id) && !positiveId(card.anilist_id))) { result.reason = 'invalid_identifier'; return }
        if (card.source === 'tmdb') {
            var nativeId = positiveId(card.id)
            if (available(card.id) && !nativeId) { result.reason = 'invalid_identifier'; return }
            if (tmdb && nativeId && tmdb !== nativeId) { result.reason = 'identifier_conflict'; return }
            tmdb = tmdb || nativeId
        }
        result.tmdb = tmdb
        var direct = []
        if (positiveId(card.mal_id)) direct.push('mal:' + card.mal_id)
        if (positiveId(card.anilist_id)) direct.push('anilist:' + card.anilist_id)
        if (tmdb && !media) { result.reason = 'media_type_missing'; return }
        var key = tmdb ? 'tmdb_' + (media === 'tv' ? 'show' : 'movie') + ':' + tmdb : ''
        result.links = key && own(data.tmdb, key) ? data.tmdb[key] : []
        result.links.forEach(function (edge) { if (result.targets.indexOf(edge.target) === -1) result.targets.push(edge.target) })
        if (direct.length && result.targets.length && direct.some(function (id) { return result.targets.indexOf(id) === -1 })) { result.reason = 'identifier_conflict'; return }
        var targets = result.targets.length ? result.targets : direct
        result.records = data.records.filter(function (r) { return targets.indexOf('mal:' + r.mal) !== -1 || targets.indexOf('anilist:' + r.anilist) !== -1 })
        if (direct.length > 1 && (!own(data.identifiers, direct[0]) || !own(data.identifiers, direct[1]) || data.identifiers[direct[0]] !== data.identifiers[direct[1]])) { result.records = []; result.reason = 'identifier_conflict'; return }
        if (!result.targets.length) result.targets = direct
        var areas = []
        targets.forEach(function (t) {
            var area = own(data.identifiers, t) ? data.identifiers[t] : t
            if (areas.indexOf(area) === -1) areas.push(area)
        })
        result.candidates = areas.length
        if (!targets.length) { result.reason = tmdb ? 'mapping_missing' : 'namespace_missing'; return }
        if (result.candidates > 1) { result.status = 'multiple_areas'; result.reason = 'multiple_areas'; return }
        if (!result.records.length) { result.reason = 'classification_missing'; return }
        result.candidates = 1; result.status = 'confirmed_id'; result.reason = 'numbering_unverified'
    }

    function appendClassificationDiagnostics(body) {
        appendDiagnostic(body, translate('anime_filler_classifications'), 'AniFillerPedia')
        appendDiagnostic(body, translate('anime_filler_data_state'), dataState.status)
        appendDiagnostic(body, translate('anime_filler_data_version'), displayValue(dataState.version))
        appendDiagnostic(body, translate('anime_filler_data_date'), displayValue(dataState.sourceDate))
        appendDiagnostic(body, translate('anime_filler_data_origin'), displayValue(dataState.origin))
        appendDiagnostic(body, translate('anime_filler_validation'), dataState.validation ? reasonText(dataState.validation) : displayValue(''))
        appendDiagnostic(body, translate('anime_filler_data_error'), dataState.error ? reasonText(dataState.error) : translate('anime_filler_no'))
        var counts = dataState.dataset && dataState.dataset.counts
        appendDiagnostic(body, translate('anime_filler_data_count'), counts ? counts.works + ' / ' + counts.episodes : displayValue(''))
        appendDiagnostic(body, 'TMDB / TV/Movie', displayValue(classification.tmdb) + ' / ' + displayValue(classification.media))
        appendDiagnostic(body, 'MAL / AniList', displayValue(classification.targets.join(', ')))
        appendDiagnostic(body, translate('anime_filler_matches'), String(classification.candidates))
        appendDiagnostic(body, translate('anime_filler_identity'), classification.status + ' — ' + reasonText(classification.reason))
        classification.records.forEach(function (record) {
            appendDiagnostic(body, translate('anime_filler_source_work'), record.title + ' [' + record.id + ']')
            appendDiagnostic(body, translate('anime_filler_class_count'), String(record.counts.canon + record.counts.filler + record.counts.mixed))
            appendDiagnostic(body, 'Canon / Filler / Mixed', record.counts.canon + ' / ' + record.counts.filler + ' / ' + record.counts.mixed)
            appendDiagnostic(body, translate('anime_filler_integrity'), record.integrity + (record.issues.length ? ' — ' + record.issues.map(function (issue) { var parts = issue.split(':'); return reasonText('integrity_' + parts[0]) + (parts.length > 1 ? ' [' + parts.slice(1).join(':') + ']' : '') }).join('; ') : ''))
            appendDiagnostic(body, translate('anime_filler_numbering'), record.numbering.file + ' [' + record.numbering.min + '–' + record.numbering.max + ']')
        })
        appendDiagnostic(body, translate('anime_filler_numbering_kodik'), translate('anime_filler_no') + ' — ' + reasonText('numbering_unverified'))
        classification.links.forEach(function (edge) { appendDiagnostic(body, 'AniBridge', edge.source + ' → ' + edge.target + ' ' + JSON.stringify(edge.ranges)) })
        if (dataState.dataset) appendDiagnostic(body, translate('anime_filler_attribution'), dataState.dataset.notices.attribution + ' ' + dataState.dataset.notices.license)
    }

    function translate(key) {
        return Lampa.Lang.translate(key)
    }

    function closeInfo() {
        Lampa.Modal.close()
        Lampa.Controller.toggle('settings_component')
    }

    function showInfo() {
        var body = $('<div></div>')

        body.append($('<div></div>').text(PLUGIN_NAME))
        body.append($('<div></div>').text(
            Lampa.Lang.translate('anime_filler_version') + ': ' + PLUGIN_VERSION
        ))

        Lampa.Modal.open({
            title: PLUGIN_NAME,
            html: body,
            size: 'small',
            buttons: [
                {
                    name: Lampa.Lang.translate('anime_filler_close'),
                    onSelect: closeInfo
                }
            ],
            onBack: closeInfo
        })
    }

    function appendDiagnostic(body, label, value) {
        body.append($('<div></div>').text(label + ': ' + value))
    }

    function available(value) {
        return value !== undefined && value !== null && value !== ''
    }

    function displayValue(value) {
        return available(value) ? String(value) : translate('anime_filler_not_available')
    }

    function cardIdentifiers(card) {
        if (!card) return translate('anime_filler_not_available')

        var values = []
        var fields = [
            ['source', 'source'],
            ['id', 'id'],
            ['tmdb', 'tmdb_id'],
            ['imdb', 'imdb_id'],
            ['kinopoisk', 'kinopoisk_id']
        ]

        fields.forEach(function (field) {
            if (available(card[field[1]])) values.push(field[0] + '=' + card[field[1]])
        })

        return values.length ? values.join('; ') : translate('anime_filler_not_available')
    }

    function displayEpisodes(episodes) {
        if (!episodes.length) return translate('anime_filler_not_available')
        if (episodes.length <= 50) return episodes.join(', ')

        var hasGaps = false
        for (var i = 1; i < episodes.length; i++) {
            if (episodes[i] !== episodes[i - 1] + 1) {
                hasGaps = true
                break
            }
        }

        return episodes[0] + '–' + episodes[episodes.length - 1] +
            '; ' + episodes.length + ' ' + translate('anime_filler_items') +
            '; ' + translate(hasGaps ? 'anime_filler_has_gaps' : 'anime_filler_no_gaps')
    }

    function reasonText(reason) {
        var key = 'anime_filler_reason_' + reason
        var value = translate(key)
        return value === key ? reason : value + ' (' + reason + ')'
    }

    function refreshDetection() {
        state.onlineModDetected = Boolean(
            Lampa.Component && Lampa.Component.get && Lampa.Component.get(ONLINE_MOD_COMPONENT)
        )
        state.kodikDetected = Boolean(
            Lampa.SettingsApi && Lampa.SettingsApi.getComponent &&
            Lampa.SettingsApi.getComponent(KODIK_SETTINGS_COMPONENT)
        )
    }

    function refreshDiagnosticAvailability() {
        refreshDetection()
        if (state.activityActive) return

        if (state.onlineModDetected) {
            state.status = 'inactive'
            state.reason = 'online_mod_inactive'
        }
        else {
            state.status = 'online_mod_missing'
            state.reason = 'online_mod_missing'
        }
    }

    function showDiagnostics() {
        refreshDiagnosticAvailability()

        var body = $('<div></div>')
        var card = state.card

        appendDiagnostic(body, translate('anime_filler_version'), PLUGIN_VERSION)
        appendDiagnostic(body, translate('anime_filler_online_mod'), translate(state.onlineModDetected ? 'anime_filler_yes' : 'anime_filler_no'))
        appendDiagnostic(body, translate('anime_filler_kodik_module'), translate(state.kodikDetected ? 'anime_filler_yes' : 'anime_filler_no'))
        appendDiagnostic(body, translate('anime_filler_activity'), state.activityActive ? 'Online_Mod' : translate('anime_filler_inactive'))
        appendDiagnostic(body, translate('anime_filler_candidate'), displayValue(state.sourceCandidate))
        appendDiagnostic(body, translate('anime_filler_confirmed_source'), displayValue(state.sourceConfirmed))
        appendDiagnostic(body, translate('anime_filler_card'), displayValue(card && card.title))
        appendDiagnostic(body, translate('anime_filler_card_ids'), cardIdentifiers(card))
        appendDiagnostic(body, translate('anime_filler_season'), displayValue(state.season))
        appendDiagnostic(body, translate('anime_filler_voice'), displayValue(state.voice))
        appendDiagnostic(body, translate('anime_filler_episode_count'), String(state.episodes.length))
        appendDiagnostic(body, translate('anime_filler_episodes'), displayEpisodes(state.episodes))
        appendDiagnostic(body, translate('anime_filler_exact_rows'), String(state.exactRows))
        appendDiagnostic(body, translate('anime_filler_confirmed_rows'), String(state.confirmedRows))
        appendDiagnostic(body, translate('anime_filler_status'), state.status)
        appendDiagnostic(body, translate('anime_filler_reason'), reasonText(state.reason))
        if (state.unconfirmedHostname) {
            appendDiagnostic(body, translate('anime_filler_hostname'), state.unconfirmedHostname)
        }

        appendClassificationDiagnostics(body)

        Lampa.Modal.open({
            title: translate('anime_filler_diagnostics'),
            html: body,
            size: 'small',
            buttons: [{ name: translate('anime_filler_close'), onSelect: closeInfo }],
            onBack: closeInfo
        })
    }

    function registerTranslations() {
        Lampa.Lang.add({
            anime_filler_classifications: {"ru": "Классификации", "en": "Classifications"},
            anime_filler_data_state: {"ru": "Состояние набора", "en": "Dataset state"},
            anime_filler_data_version: {"ru": "Версия набора", "en": "Dataset version"},
            anime_filler_data_date: {"ru": "Дата исходных данных", "en": "Source date"},
            anime_filler_data_origin: {"ru": "Загрузка: сеть/кеш", "en": "Load: network/cache"},
            anime_filler_validation: {"ru": "Проверка данных", "en": "Data validation"},
            anime_filler_data_error: {"ru": "Ошибка данных", "en": "Data error"},
            anime_filler_data_count: {"ru": "Произведений / классификаций", "en": "Works / classifications"},
            anime_filler_matches: {"ru": "Возможных соответствий", "en": "Possible matches"},
            anime_filler_identity: {"ru": "Идентификация", "en": "Identification"},
            anime_filler_source_work: {"ru": "Запись источника", "en": "Source entry"},
            anime_filler_class_count: {"ru": "Доступных классификаций", "en": "Available classifications"},
            anime_filler_integrity: {"ru": "Целостность записи", "en": "Entry integrity"},
            anime_filler_numbering: {"ru": "Область нумерации", "en": "Numbering scope"},
            anime_filler_numbering_kodik: {"ru": "Нумерация Kodik подтверждена", "en": "Kodik numbering confirmed"},
            anime_filler_attribution: {"ru": "Источник и лицензия", "en": "Source and license"},
            anime_filler_reason_no_card: {"ru": "карточка не открыта", "en": "no current card"},
            anime_filler_reason_data_unavailable: {"ru": "набор данных ещё недоступен", "en": "dataset is unavailable"},
            anime_filler_reason_invalid_identifier: {"ru": "некорректный внешний ID", "en": "invalid external ID"},
            anime_filler_reason_identifier_conflict: {"ru": "внешние ID противоречат друг другу", "en": "conflicting external IDs"},
            anime_filler_reason_media_type_missing: {"ru": "тип TMDB TV/Movie не установлен", "en": "TMDB TV/Movie type is missing"},
            anime_filler_reason_mapping_missing: {"ru": "связь TMDB отсутствует в наборе", "en": "TMDB mapping is absent"},
            anime_filler_reason_namespace_missing: {"ru": "нет ID с подтверждённым провайдером", "en": "no ID with a confirmed provider"},
            anime_filler_reason_classification_missing: {"ru": "связь ID есть, классификаций нет", "en": "ID mapping exists; classifications are absent"},
            anime_filler_reason_multiple_areas: {"ru": "несколько областей; требуется уточнение сезона и нумерации", "en": "multiple areas; season and numbering must be verified"},
            anime_filler_reason_numbering_unverified: {"ru": "установление ID не подтверждает нумерацию Kodik", "en": "ID resolution does not verify Kodik numbering"},
            anime_filler_reason_sha256_schema_valid: {"ru": "SHA-256 и схема проверены; подпись не используется", "en": "SHA-256 and schema verified; no signature"},
            anime_filler_reason_invalid_json: {"ru": "повреждённый JSON", "en": "invalid JSON"},
            anime_filler_reason_incompatible_schema: {"ru": "несовместимая схема данных", "en": "incompatible data schema"},
            anime_filler_reason_invalid_manifest: {"ru": "некорректный manifest", "en": "invalid manifest"},
            anime_filler_reason_hash_mismatch: {"ru": "размер или SHA-256 не совпадает", "en": "size or SHA-256 mismatch"},
            anime_filler_reason_invalid_dataset: {"ru": "некорректная структура набора", "en": "invalid dataset structure"},
            anime_filler_reason_transport_unavailable: {"ru": "XMLHttpRequest недоступен", "en": "XMLHttpRequest is unavailable"},
            anime_filler_reason_http_error: {"ru": "ошибка HTTP при загрузке", "en": "HTTP load error"},
            anime_filler_reason_network_error: {"ru": "сетевая ошибка", "en": "network error"},
            anime_filler_reason_timeout: {"ru": "истекло время загрузки", "en": "load timed out"},
            anime_filler_reason_cache_invalid: {"ru": "сохранённый кеш повреждён", "en": "cached data is invalid"},
            anime_filler_reason_cache_write_failed: {"ru": "не удалось сохранить кеш; данные доступны в памяти", "en": "cache could not be saved; data remains in memory"},
            anime_filler_reason_integrity_franchise_scope: {"ru": "часть серий относится к другим произведениям; эти серии исключены из данной области", "en": "some episodes belong to other works and are excluded from this scope"},
            anime_filler_reason_integrity_invalid_episode: {"ru": "строка с некорректным номером исключена", "en": "row with invalid episode number was excluded"},
            anime_filler_reason_integrity_unknown_or_uncited: {"ru": "неизвестная категория или отсутствующая ссылка на источник; эпизод неизвестен", "en": "unknown category or missing citation; episode remains unknown"},
            anime_filler_reason_integrity_classification_conflict: {"ru": "классификации конфликтуют; эпизод неизвестен", "en": "conflicting classifications; episode remains unknown"},
            anime_filler_reason_integrity_duplicate: {"ru": "одинаковые повторяющиеся строки учтены один раз", "en": "identical duplicate rows counted once"},
            anime_filler_about: {
                ru: 'О плагине',
                en: 'About'
            },
            anime_filler_diagnostics: { ru: 'Диагностика', en: 'Diagnostics' },
            anime_filler_version: {
                ru: 'Версия',
                en: 'Version'
            },
            anime_filler_close: {
                ru: 'Закрыть',
                en: 'Close'
            },
            anime_filler_yes: { ru: 'да', en: 'yes' },
            anime_filler_no: { ru: 'нет', en: 'no' },
            anime_filler_not_available: { ru: 'не предоставлено', en: 'not provided' },
            anime_filler_inactive: { ru: 'неактивна', en: 'inactive' },
            anime_filler_online_mod: { ru: 'Online_Mod обнаружен', en: 'Online_Mod detected' },
            anime_filler_kodik_module: { ru: 'Модуль Kodik обнаружен', en: 'Kodik module detected' },
            anime_filler_activity: { ru: 'Текущая activity', en: 'Current activity' },
            anime_filler_candidate: { ru: 'Ожидаемый балансер', en: 'Expected balancer' },
            anime_filler_confirmed_source: { ru: 'Подтверждённый источник', en: 'Confirmed source' },
            anime_filler_card: { ru: 'Карточка', en: 'Card' },
            anime_filler_card_ids: { ru: 'Идентификаторы карточки', en: 'Card identifiers' },
            anime_filler_season: { ru: 'Сезон', en: 'Season' },
            anime_filler_voice: { ru: 'Озвучка', en: 'Voice' },
            anime_filler_episode_count: { ru: 'Эпизодов', en: 'Episodes' },
            anime_filler_episodes: { ru: 'Номера эпизодов', en: 'Episode numbers' },
            anime_filler_exact_rows: { ru: 'Строк с точными номерами', en: 'Rows with exact numbers' },
            anime_filler_confirmed_rows: { ru: 'Строк Kodik подтверждено', en: 'Kodik rows confirmed' },
            anime_filler_hostname: { ru: 'Hostname неподтверждённой ссылки', en: 'Unconfirmed link hostname' },
            anime_filler_status: { ru: 'Статус', en: 'Status' },
            anime_filler_reason: { ru: 'Причина', en: 'Reason' },
            anime_filler_items: { ru: 'элементов', en: 'items' },
            anime_filler_has_gaps: { ru: 'есть пропуски', en: 'has gaps' },
            anime_filler_no_gaps: { ru: 'без пропусков', en: 'no gaps' },
            anime_filler_reason_online_mod_missing: { ru: 'компонент Online_Mod не зарегистрирован', en: 'Online_Mod component is not registered' },
            anime_filler_reason_online_mod_inactive: { ru: 'activity Online_Mod неактивна', en: 'Online_Mod activity is inactive' },
            anime_filler_reason_source_not_kodik: { ru: 'выбран другой балансер', en: 'another balancer is selected' },
            anime_filler_reason_list_not_ready: { ru: 'новый список ещё не подтверждён', en: 'the new list is not confirmed yet' },
            anime_filler_reason_missing_source_candidate: { ru: 'ожидаемый балансер не определён', en: 'the expected balancer is unknown' },
            anime_filler_reason_missing_link: { ru: 'ссылка эпизода не предоставлена', en: 'episode link is not provided' },
            anime_filler_reason_unsupported_link_form: { ru: 'неподтверждённая форма ссылки', en: 'unconfirmed link form' },
            anime_filler_reason_unknown_link_hostname: { ru: 'неподтверждённый hostname ссылки', en: 'unconfirmed link hostname' },
            anime_filler_reason_unknown_link_path: { ru: 'неподтверждённый путь ссылки', en: 'unconfirmed link path' },
            anime_filler_reason_old_generation_visible: { ru: 'в DOM остаются строки прошлого поколения', en: 'rows from an older generation remain in the DOM' },
            anime_filler_reason_no_exact_episode_metadata: { ru: 'нет точных структурированных метаданных эпизодов', en: 'exact structured episode metadata is unavailable' },
            anime_filler_reason_empty_visible_list: { ru: 'видимый список эпизодов пуст', en: 'the visible episode list is empty' },
            anime_filler_reason_ambiguous_visible_list: { ru: 'одновременно видны разные сезоны или озвучки', en: 'multiple seasons or voices are visible' },
            anime_filler_reason_activity_unavailable: { ru: 'DOM activity недоступен', en: 'activity DOM is unavailable' },
            anime_filler_reason_observer_unavailable: { ru: 'WeakMap или MutationObserver недоступен', en: 'WeakMap or MutationObserver is unavailable' },
            anime_filler_reason_kodik_confirmed: { ru: 'список подтверждён по структурированным данным и ссылкам Kodik', en: 'the list is confirmed by structured data and Kodik links' }
        })
    }

    function registerSettings() {
        Lampa.SettingsApi.addComponent({
            component: COMPONENT_ID,
            name: PLUGIN_NAME,
            icon: SETTINGS_ICON
        })

        Lampa.SettingsApi.addParam({
            component: COMPONENT_ID,
            param: {
                name: ABOUT_PARAM_ID,
                type: 'button'
            },
            field: {
                name: Lampa.Lang.translate('anime_filler_about')
            },
            onChange: showInfo
        })

        Lampa.SettingsApi.addParam({
            component: COMPONENT_ID,
            param: { name: DIAGNOSTICS_PARAM_ID, type: 'button' },
            field: { name: translate('anime_filler_diagnostics') },
            onChange: showDiagnostics
        })
    }

    function clearEpisodeSnapshot(status, reason) {
        state.sourceConfirmed = ''
        state.season = ''
        state.voice = ''
        state.episodes = []
        state.exactRows = 0
        state.confirmedRows = 0
        state.unconfirmedHostname = ''
        state.status = status
        state.reason = reason
    }

    function safeHostname(authority) {
        if (!authority || authority.indexOf('@') !== -1) return ''
        var hostname = authority.toLowerCase().replace(/\.$/, '').replace(/:[0-9]+$/, '')
        return /^[a-z0-9.-]+$/.test(hostname) ? hostname.slice(0, 255) : ''
    }

    function inspectKodikLink(link) {
        var result = { confirmed: false, reason: 'missing_link', hostname: '' }
        if (typeof link !== 'string' || !link.trim()) return result

        var match = link.trim().match(/^(https?:)?\/\/([^\/?#]+)(\/[^?#]*)?$/i)
        if (!match) {
            result.reason = 'unsupported_link_form'
            return result
        }

        var authority = match[2].toLowerCase()
        result.hostname = safeHostname(authority)
        if (authority !== result.hostname) {
            result.reason = 'unknown_link_hostname'
            return result
        }
        if (['kodik.info', 'kodik.cc', 'kodikplayer.com'].indexOf(result.hostname) === -1) {
            result.reason = 'unknown_link_hostname'
            return result
        }

        var pathname = match[3] || '/'
        if (!/^\/seria\/[^\/]+\/[^\/]+\/[^\/]+\/?$/.test(pathname)) {
            result.reason = 'unknown_link_path'
            return result
        }

        result.confirmed = true
        result.reason = 'kodik_confirmed'
        return result
    }

    function resultRoot(result) {
        if (!result) return null
        if (result[0] && typeof result[0] === 'object') return result[0]
        return typeof result === 'object' ? result : null
    }

    function exactEpisode(element) {
        return Boolean(element && available(element.season) &&
            typeof element.episode === 'number' && isFinite(element.episode) &&
            Math.floor(element.episode) === element.episode)
    }

    function rememberTemplateResult(result, element) {
        if (!templateMetadata || !exactEpisode(element)) return
        var root = resultRoot(result)
        if (!root) return

        var source = inspectKodikLink(element.link)
        templateMetadata.set(root, {
            season: String(element.season),
            episode: element.episode,
            voice: available(element.translate_voice) ? String(element.translate_voice) : '',
            generation: generation,
            sourceConfirmed: source.confirmed,
            sourceReason: source.reason,
            sourceHostname: source.hostname
        })
    }

    function installTemplateObserver() {
        if (!Lampa.Template || typeof Lampa.Template.get !== 'function') return
        var originalGet = Lampa.Template.get

        Lampa.Template.get = function () {
            var result = originalGet.apply(this, arguments)
            if (arguments[0] === 'online_mod') rememberTemplateResult(result, arguments[1])
            return result
        }
    }

    function copyCard(activityObject) {
        var movie = activityObject && activityObject.movie
        if (!movie) return null

        return {
            title: movie.title || movie.name || movie.original_title || movie.original_name || '',
            source: movie.source || activityObject.source || '',
            id: movie.id,
            tmdb_id: movie.tmdb_id,
            imdb_id: movie.imdb_id,
            kinopoisk_id: movie.kinopoisk_id,
            mal_id: movie.mal_id,
            anilist_id: movie.anilist_id,
            original_title: movie.original_title,
            original_name: movie.original_name,
            release_date: movie.release_date,
            first_air_date: movie.first_air_date,
            media_type: movie.media_type,
            type: movie.type,
            original_language: movie.original_language
        }
    }

    function resolveSourceCandidate(activityObject) {
        var candidate = Lampa.Storage.get('online_mod_balanser', 'cdnvideohub')
        var movie = activityObject && activityObject.movie

        if (Lampa.Storage.field('online_mod_save_last_balanser') === true && movie && available(movie.id)) {
            var last = Lampa.Storage.cache('online_mod_last_balanser', 200, {}) || {}
            if (available(last[movie.id])) candidate = last[movie.id]
        }

        return available(candidate) ? String(candidate) : ''
    }

    function activityRoot(activityObject) {
        try {
            return activityObject && activityObject.activity &&
                activityObject.activity.render && activityObject.activity.render(true)
        }
        catch (error) {
            return null
        }
    }

    function disconnectObserver() {
        if (observer) observer.disconnect()
        observer = null
        if (scanTimer !== null) {
            clearTimeout(scanTimer)
            scanTimer = null
        }
    }

    function queueScan() {
        if (scanTimer !== null) return
        scanTimer = setTimeout(function () {
            scanTimer = null
            scanCurrentList()
        }, 0)
    }

    function isCurrentActivity() {
        return Boolean(Lampa.Activity && Lampa.Activity.active &&
            Lampa.Activity.active() === observedActivity)
    }

    function listNodes() {
        if (!observedRoot || !observedRoot.querySelectorAll) return []
        return Array.prototype.slice.call(observedRoot.querySelectorAll('.online'))
    }

    function scanCurrentList() {
        if (!observedActivity || !isCurrentActivity()) return

        if (!templateMetadata || typeof MutationObserver !== 'function') {
            clearEpisodeSnapshot('observer_unavailable', 'observer_unavailable')
            return
        }
        if (!observedRoot) {
            clearEpisodeSnapshot('activity_unavailable', 'activity_unavailable')
            return
        }
        if (state.sourceCandidate && state.sourceCandidate !== 'kodik') {
            clearEpisodeSnapshot('not_kodik', 'source_not_kodik')
            return
        }

        var nodes = listNodes()
        var metadata = []
        var oldGenerationVisible = false

        nodes.forEach(function (node) {
            var item = templateMetadata.get(node)
            if (!item) return
            if (item.generation !== generation) oldGenerationVisible = true
            else metadata.push(item)
        })

        if (oldGenerationVisible) {
            clearEpisodeSnapshot('waiting_for_list', 'old_generation_visible')
            return
        }
        if (!metadata.length) {
            clearEpisodeSnapshot(
                nodes.length ? 'no_exact_episode_metadata' : 'empty_visible_list',
                nodes.length ? 'no_exact_episode_metadata' : 'empty_visible_list'
            )
            return
        }

        state.exactRows = metadata.length
        state.confirmedRows = metadata.filter(function (item) { return item.sourceConfirmed }).length

        var unconfirmed = metadata.filter(function (item) { return !item.sourceConfirmed })
        if (!state.sourceCandidate) {
            state.sourceConfirmed = ''
            state.season = ''
            state.voice = ''
            state.episodes = []
            state.status = 'source_unknown'
            state.reason = 'missing_source_candidate'
            state.unconfirmedHostname = unconfirmed[0] && unconfirmed[0].sourceHostname || ''
            return
        }
        if (unconfirmed.length) {
            state.sourceConfirmed = ''
            state.season = ''
            state.voice = ''
            state.episodes = []
            state.status = 'source_unknown'
            state.reason = unconfirmed[0].sourceReason
            state.unconfirmedHostname = unconfirmed[0].sourceHostname
            return
        }

        var groups = {}
        metadata.forEach(function (item) { groups[item.season + '\u0000' + item.voice] = true })
        var groupKeys = Object.keys(groups)
        if (groupKeys.length !== 1) {
            state.sourceConfirmed = ''
            state.season = ''
            state.voice = ''
            state.episodes = []
            state.status = 'ambiguous_visible_list'
            state.reason = 'ambiguous_visible_list'
            state.unconfirmedHostname = ''
            return
        }

        var parts = groupKeys[0].split('\u0000')
        var episodes = []
        metadata.forEach(function (item) {
            if (episodes.indexOf(item.episode) === -1) episodes.push(item.episode)
        })
        episodes.sort(function (a, b) { return a - b })

        state.sourceConfirmed = 'kodik'
        state.season = parts[0]
        state.voice = parts[1]
        state.episodes = episodes
        state.unconfirmedHostname = ''
        state.status = 'ready'
        state.reason = 'kodik_confirmed'
    }

    function beginActivity(activityObject, isNewActivity) {
        disconnectObserver()
        if (isNewActivity || !activityGenerations || !activityGenerations.has(activityObject)) {
            generationCounter += 1
            generation = generationCounter
            if (activityGenerations) activityGenerations.set(activityObject, generation)
        }
        else generation = activityGenerations.get(activityObject)
        observedActivity = activityObject
        observedRoot = activityRoot(activityObject)
        state.activityActive = true
        state.card = copyCard(activityObject)
        loadClassifications()
        state.sourceCandidate = resolveSourceCandidate(activityObject)
        clearEpisodeSnapshot(
            state.sourceCandidate === 'kodik' ? 'waiting_for_list' : (state.sourceCandidate ? 'not_kodik' : 'source_unknown'),
            state.sourceCandidate === 'kodik' ? 'list_not_ready' : (state.sourceCandidate ? 'source_not_kodik' : 'missing_source_candidate')
        )

        if (!templateMetadata || typeof MutationObserver !== 'function') {
            clearEpisodeSnapshot('observer_unavailable', 'observer_unavailable')
            return
        }
        if (!observedRoot) {
            clearEpisodeSnapshot('activity_unavailable', 'activity_unavailable')
            return
        }

        observer = new MutationObserver(queueScan)
        observer.observe(observedRoot, { childList: true, subtree: true })
    }

    function leaveActivity(status, reason) {
        disconnectObserver()
        observedActivity = null
        observedRoot = null
        state.activityActive = false
        state.sourceCandidate = ''
        state.card = null
        resolveClassifications()
        clearEpisodeSnapshot(status, reason)
    }

    function handleActivity(event) {
        if (!event || !event.object) return

        if (event.component === ONLINE_MOD_COMPONENT) {
            if (event.type === 'init') beginActivity(event.object, true)
            else if (event.type === 'start' || event.type === 'archive') {
                if (observedActivity !== event.object) beginActivity(event.object, false)
                state.activityActive = true
                queueScan()
            }
            else if (event.type === 'destroy') {
                if (activityGenerations) activityGenerations.delete(event.object)
                if (observedActivity === event.object) leaveActivity('inactive', 'online_mod_inactive')
            }
        }
        else if (event.type === 'start' && observedActivity) {
            leaveActivity('inactive', 'online_mod_inactive')
        }
    }

    function handleStorageChange(event) {
        if (!observedActivity || !event || event.name !== 'online_mod_balanser') return

        generationCounter += 1
        generation = generationCounter
        if (activityGenerations) activityGenerations.set(observedActivity, generation)
        state.sourceCandidate = available(event.value) ? String(event.value) : ''
        clearEpisodeSnapshot(
            state.sourceCandidate === 'kodik' ? 'waiting_for_list' : (state.sourceCandidate ? 'not_kodik' : 'source_unknown'),
            state.sourceCandidate === 'kodik' ? 'list_not_ready' : (state.sourceCandidate ? 'source_not_kodik' : 'missing_source_candidate')
        )
        queueScan()
    }

    function installRuntimeObservers() {
        installTemplateObserver()
        Lampa.Listener.follow('activity', handleActivity)

        if (Lampa.Storage && Lampa.Storage.listener && Lampa.Storage.listener.follow) {
            Lampa.Storage.listener.follow('change', handleStorageChange)
        }

        refreshDetection()
        var active = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active()
        if (active && active.component === ONLINE_MOD_COMPONENT) {
            beginActivity(active, false)
            state.activityActive = true
            queueScan()
        }
        else if (!state.onlineModDetected) {
            state.status = 'online_mod_missing'
            state.reason = 'online_mod_missing'
        }
    }

    function init() {
        if (initialized) return
        initialized = true
        registerTranslations()
        registerSettings()
        installRuntimeObservers()
    }

    function startPlugin() {
        window[READY_FLAG] = true

        if (window.appready) init()
        else {
            Lampa.Listener.follow('app', function (event) {
                if (event.type === 'ready') init()
            })
        }
    }

    if (!window[READY_FLAG]) startPlugin()
})()
