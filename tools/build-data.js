'use strict'
// Build-time only. node tools/build-data.js AFP_CHECKOUT MAPPINGS_JSON OUTPUT_DIR [COVERAGE_JSON]
// Inputs are pinned in data/inputs.lock.json. No network, clock, or runtime dependencies.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const positive = n => Number.isSafeInteger(n) && n > 0
const object = v => v && typeof v === 'object' && !Array.isArray(v)
const stable = v => Array.isArray(v) ? v.map(stable) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v
const serialize = v => JSON.stringify(stable(v)) + '\n'

function parseEpisodes(data) {
    const issues = []
    const episodes = new Map()
    const blocked = new Set()
    if (!object(data) || typeof data.series_title !== 'string' || !Array.isArray(data.episodes) || !Array.isArray(data.citation_sources)) throw Error('invalid_structure')
    const citations = new Set(data.citation_sources.filter(object).map(c => c.id))
    for (const e of data.episodes) {
        if (!object(e) || !positive(e.episode_number)) { issues.push('invalid_episode'); continue }
        const n = e.episode_number
        if (!['canon', 'filler', 'mixed'].includes(e.status) || !Array.isArray(e.citation_ids) || !e.citation_ids.length || e.citation_ids.some(id => !citations.has(id))) {
            issues.push('unknown_or_uncited:' + n); blocked.add(n); episodes.delete(n); continue
        }
        if (episodes.has(n)) {
            if (episodes.get(n) !== e.status) { issues.push('classification_conflict:' + n); blocked.add(n); episodes.delete(n) }
            else issues.push('duplicate:' + n)
        } else if (!blocked.has(n)) episodes.set(n, e.status)
    }
    return { episodes: [...episodes].sort((a, b) => a[0] - b[0]), issues }
}

function ranges(episodes) {
    const result = []
    for (const [n, category] of episodes) {
        const last = result[result.length - 1]
        if (last && last[1] + 1 === n && last[2] === category) last[1] = n
        else result.push([n, n, category])
    }
    return result
}

function build(files, catalog, mappings, lock) {
    if (!Array.isArray(catalog) || !object(mappings) || !mappings.$meta || !/^3\./.test(mappings.$meta.schema_version)) throw Error('invalid_inputs')
    const records = [], coverage = [], identities = new Set()
    for (const file of Object.keys(files).sort()) {
        const data = files[file]
        let parsed
        try { parsed = parseEpisodes(data) } catch (e) { coverage.push({ file, result: 'invalid_structure' }); continue }
        const row = { file, title: data.series_title, sourceEpisodes: data.episodes.length, issues: parsed.issues }
        // Exact upstream primary-key join (load_episodes.py::find_series_id), never a fuzzy title match.
        const candidates = catalog.filter(c => object(c) && c.title === data.series_title)
        const supplement = lock.identities[file]
        let ids = supplement || (candidates.length === 1 ? candidates[0] : null)
        if (!ids) { coverage.push({ ...row, result: 'no_confirmed_identifier' }); continue }
        let mal = ids.mal_id, anilist = ids.anilist_id
        if ((mal != null && !positive(mal)) || (anilist != null && !positive(anilist)) || (!mal && !anilist)) { coverage.push({ ...row, result: 'no_confirmed_identifier' }); continue }
        // No invented MAL=AniList shortcut: use the explicit AniBridge ID edge.
        if (anilist && !mal) {
            const ms = Object.keys(mappings['anilist:' + anilist] || {}).filter(k => /^mal:\d+$/.test(k))
            if (ms.length === 1) mal = Number(ms[0].split(':')[1])
        }
        if (mal && anilist && !Object.prototype.hasOwnProperty.call(mappings['mal:' + mal] || {}, 'anilist:' + anilist)) {
            coverage.push({ ...row, result: 'identifier_conflict' }); continue
        }
        if (lock.review[file]) { coverage.push({ ...row, result: 'requires_review', reason: lock.review[file] }); continue }
        // A catalog entry must not absorb classifications outside its proven scope.
        if (file === 'gintama-episodes.json') {
            parsed.episodes = parsed.episodes.filter(e => e[0] <= 201)
            parsed.issues.push('franchise_scope:202-369_not_bound_to_mal918')
        }
        if (!parsed.episodes.length) { coverage.push({ ...row, result: 'incomplete_data' }); continue }
        const keys = [mal && 'mal:' + mal, anilist && 'anilist:' + anilist].filter(Boolean)
        if (keys.some(k => identities.has(k))) { coverage.push({ ...row, result: 'identifier_conflict' }); continue }
        keys.forEach(k => identities.add(k))
        const counts = { canon: 0, filler: 0, mixed: 0 }
        parsed.episodes.forEach(e => counts[e[1]]++)
        const record = {
            id: file.replace('-episodes.json', ''), title: data.series_title,
            mal: mal || null, anilist: anilist || null, ranges: ranges(parsed.episodes), counts,
            integrity: parsed.issues.length ? 'issues' : 'valid', issues: parsed.issues,
            numbering: { kind: 'source_entry', file, min: parsed.episodes[0][0], max: parsed.episodes[parsed.episodes.length - 1][0], kodikConfirmed: false },
            identityEvidence: supplement ? supplement.evidence : 'series-candidates.json exact primary key; load_episodes.py::find_series_id',
            research: data.research_status,
            citations: data.citation_sources
        }
        records.push(record)
        coverage.push({ ...row, result: 'accepted', mal: record.mal, anilist: record.anilist, classifications: parsed.episodes.length, counts })
    }
    // Keep ALL MAL/AniList areas of a related TMDB card, including parts without classifications.
    const tmdb = {}
    for (const source of Object.keys(mappings).sort()) {
        if (!/^tmdb_(show:\d+:s\d+|movie:\d+)$/.test(source)) continue
        const targets = mappings[source]
        if (!object(targets)) throw Error('invalid_mapping_targets')
        const relevant = Object.keys(targets).some(k => identities.has(k))
        const caseIds = lock.caseIds || []
        const caseRelevant = Object.keys(targets).some(k => caseIds.includes(k))
        if (!relevant && !caseRelevant) continue
        const card = source.replace(/:s\d+$/, '')
        if (!tmdb[card]) tmdb[card] = []
        for (const target of Object.keys(targets).sort()) {
            if (!/^(mal|anilist):[1-9]\d*$/.test(target)) continue
            const rs = targets[target]
            if (!object(rs) || Object.keys(rs).some(r => !/^\d+(?:-\d*)?$/.test(r) || (rs[r] !== null && (typeof rs[r] !== 'string' || !/^\d+(?:-\d*)?(?:,\d+(?:-\d*)?)*(?:\|-?\d+)?$/.test(rs[r]))))) throw Error('invalid_mapping_ranges')
            tmdb[card].push({ source, target, ranges: rs })
        }
    }
    const mappedRecords = records.filter(r => Object.values(tmdb).some(edges => edges.some(e => e.target === 'mal:' + r.mal || e.target === 'anilist:' + r.anilist))).length
    const counts = { processed: coverage.length, works: records.length, episodes: records.reduce((s, r) => s + Object.values(r.counts).reduce((a, b) => a + b, 0), 0), mappedWorks: mappedRecords, tmdbCards: Object.keys(tmdb).length, idLinks: Object.values(tmdb).reduce((s, es) => s + es.length, 0), conflicts: coverage.reduce((n, r) => n + (r.issues || []).filter(i => i.startsWith('classification_conflict')).length, 0), kodikConfirmed: 0 }
    const identifiers = {}
    const external = new Set(Object.values(tmdb).flatMap(es => es.map(e => e.target)))
    records.forEach(r => { if (r.mal) external.add('mal:' + r.mal); if (r.anilist) external.add('anilist:' + r.anilist) })
    for (const id of [...external].sort()) {
        const links = Object.keys(mappings[id] || {}).filter(k => /^mal:[1-9]\d*$/.test(k))
        identifiers[id] = id.startsWith('anilist:') && links.length === 1 ? links[0] : id
    }
    const dataset = { schema: 1, source: 'AniFillerPedia', upstream: lock.upstream, notices: lock.notices, records, tmdb, identifiers, counts }
    const raw = serialize(dataset), sha256 = hash(raw)
    const manifest = { schema: 1, version: sha256, file: 'dataset.' + sha256 + '.json', sha256, bytes: Buffer.byteLength(raw), sourceDate: lock.upstream.afp.date, counts }
    return { raw, manifest, coverage: { counts, records: coverage } }
}

if (require.main === module) {
    const [afp, mappingFile, out, coverageFile] = process.argv.slice(2)
    if (!afp || !mappingFile || !out) throw Error('Usage: node tools/build-data.js AFP_CHECKOUT MAPPINGS_JSON OUTPUT_DIR [COVERAGE_JSON]')
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/inputs.lock.json')))
    if (cp.execFileSync('git', ['-C', afp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== lock.upstream.afp.sha) throw Error('AFP commit mismatch')
    const mappingBytes = fs.readFileSync(mappingFile)
    if (hash(mappingBytes) !== lock.upstream.anibridge.assetSha256) throw Error('AniBridge asset hash mismatch')
    const files = {}
    for (const [name, digest] of Object.entries(lock.files)) {
        const bytes = fs.readFileSync(path.join(afp, 'data/bootstrap', name))
        if (hash(bytes) !== digest) throw Error('Input hash mismatch: ' + name)
        if (name.endsWith('-episodes.json')) {
            try { files[name] = JSON.parse(bytes) } catch (error) { files[name] = null }
        }
    }
    const result = build(files, JSON.parse(fs.readFileSync(path.join(afp, 'data/bootstrap/series-candidates.json'))), JSON.parse(mappingBytes), lock)
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, result.manifest.file), result.raw)
    fs.writeFileSync(path.join(out, 'manifest.json'), serialize(result.manifest))
    if (coverageFile) fs.writeFileSync(coverageFile, JSON.stringify(result.coverage, null, 2) + '\n')
    console.log(JSON.stringify(result.manifest))
}
module.exports = { parseEpisodes, ranges, build, hash, serialize }
