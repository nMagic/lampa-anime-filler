'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {createHash} = require('node:crypto')

const root = path.join(__dirname, '..')
const cataloguePath = 'tools/mapper-facts/catalog.json'
const fixturePath = 'test/fixtures/stage-3c-catalog-audit.json'
const BEGIN = '    // BEGIN GENERATED MAPPER CATALOGUE'
const END = '    // END GENERATED MAPPER CATALOGUE'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const id = value => Number.isSafeInteger(value) && value > 0
const bound = value => id(value) && value <= 25000
const canonicalId = value => typeof value === 'string' && id(Number(value)) && String(Number(value)) === value
const compareText = (a,b) => a < b ? -1 : a > b ? 1 : 0
const kinds = {TV:'tv', OVA:'ova', ONA:'ona', MOVIE:'movie', SPECIAL:'special'}
const statuses = {FINISHED:'released', ONGOING:'ongoing', UPCOMING:'anons'}

function readInputs(directory = root) {
    const lock = JSON.parse(fs.readFileSync(path.join(directory, 'tools/mapper-facts/inputs.lock.json')))
    assert.equal(lock.schema, 1)
    assert.match(lock.auditRevision, /^[a-z0-9-]+$/)
    function read(relative) {
        const bytes = fs.readFileSync(path.join(directory, relative))
        assert.equal(hash(bytes), lock.files[relative], 'SHA-256 mismatch: ' + relative)
        return JSON.parse(bytes)
    }
    const manifest = read('data/manifest.json')
    assert.equal(manifest.version, lock.datasetVersion)
    assert.equal(manifest.sha256, lock.datasetVersion)
    assert.equal(manifest.file, 'dataset.' + lock.datasetVersion + '.json')
    assert.equal(lock.files['data/' + manifest.file], lock.datasetVersion)
    return {lock, dataset:read('data/' + manifest.file), sourceLock:read('data/inputs.lock.json'),
        historical:read(fixturePath), catalogue:read(cataloguePath)}
}

function checkRecord(record) {
    const counts = {canon:0, filler:0, mixed:0}
    let end = 0
    for (const range of record.ranges) {
        const [first,last,category] = range
        assert.ok(range.length === 3 && bound(first) && bound(last) && first > end && last >= first &&
            Object.hasOwn(counts, category), 'Invalid or overlapping AFP ranges: ' + record.id)
        counts[category] += last - first + 1
        end = last
    }
    assert.equal(record.numbering.min, record.ranges[0]?.[0], record.id)
    assert.equal(record.numbering.max, end, record.id)
    assert.deepEqual(counts, record.counts)
}

function uniqueEdge(edges, key) {
    return Object.keys(edges).length === 1 && Object.hasOwn(edges, key)
}

function localEdge(edges, key, total) {
    const range = '1-' + total
    return uniqueEdge(edges, key) && uniqueEdge(edges[key], range) && edges[key][range] === range
}

function areaRefusal(row, record, owners, inputs) {
    const {mal, anilist, shikimori, manami} = row
    const {dataset, sourceLock, lock} = inputs
    const malKey = 'mal:' + mal
    const aniListKey = 'anilist:' + anilist
    if (!id(mal) || !id(anilist) || !record || record.mal !== mal || record.anilist !== anilist ||
        owners.get(malKey)?.length !== 1 || dataset.identifiers[malKey] !== malKey || dataset.identifiers[aniListKey] !== malKey ||
        !['exact_upstream_catalog_key','locked_upstream_scope_supplement'].includes(row.afpBinding) ||
        row.afpBoundIds.anilist !== anilist || ![null,mal].includes(row.afpBoundIds.mal) ||
        !uniqueEdge(row.malToAniList, aniListKey) || !uniqueEdge(row.aniListToMal, malKey)) return 'identity_unverified_or_conflicting'
    if (shikimori.id !== String(mal) || shikimori.malId !== shikimori.id ||
        !lock.provenance.shikimori.some(batch => batch.file === row.shikimoriBatch && digest(batch.responseSha256)) ||
        kinds[manami.type] !== shikimori.kind || statuses[manami.status] !== shikimori.status ||
        !Number.isSafeInteger(shikimori.episodes) || shikimori.episodes < 0 ||
        (shikimori.status === 'released' && (!bound(shikimori.episodes) || manami.episodesField !== shikimori.episodes))) {
        return 'catalog_missing_or_conflicting'
    }
    if (record.integrity !== 'valid' || record.issues.length) return 'record_integrity_issues'
    if (!digest(row.afpSourceSha256) || sourceLock.files[record.numbering.file] !== row.afpSourceSha256) return 'afp_source_unverified'
    if (record.numbering.min !== 1 || !bound(record.numbering.max)) return 'afp_scope_incompatible'
    if (shikimori.kind !== 'tv' || !['released','ongoing'].includes(shikimori.status)) return 'catalog_format_or_status_unsupported'
    return ''
}

function build(inputs) {
    const {lock, dataset, historical, catalogue} = inputs
    assert.equal(catalogue.schema, 1)
    assert.equal(historical.datasetVersion, lock.datasetVersion)
    assert.deepEqual([...new Set(Object.values(dataset.identifiers))].map(key => Number(key.slice(4))).sort((a,b) => a-b),
        historical.verifiedCanonicalMalIds)
    const owners = new Map()
    const records = new Map()
    let classified = 0
    for (const record of dataset.records) {
        checkRecord(record)
        assert.ok(!records.has(record.id), 'Duplicate AFP record ID')
        records.set(record.id, record)
        classified += Object.values(record.counts).reduce((total, count) => total + count, 0)
        for (const area of new Set(['mal:' + record.mal, dataset.identifiers['anilist:' + record.anilist]])) {
            owners.set(area, [...(owners.get(area) || []), record])
        }
    }
    assert.equal(records.size, dataset.counts.works)
    assert.equal(classified, dataset.counts.episodes)
    const facts = {}, ongoing = {}, excluded = {}
    const seenMal = new Set(), seenRecords = new Set()
    for (const row of catalogue.areas) {
        const {mal, anilist, shikimori} = row
        assert.ok(!seenMal.has(mal) && !seenRecords.has(row.record), 'Duplicate catalogue area')
        seenMal.add(mal)
        seenRecords.add(row.record)
        const record = records.get(row.record)
        const refusal = areaRefusal(row, record, owners, inputs)
        if (refusal) { excluded[mal] = refusal; continue }
        if (shikimori.status === 'ongoing') {
            ongoing[mal] = {record:record.id, anilist:String(anilist), alternateNumbering:Boolean(row.alternateNumberingSource), proofs:[]}
            continue
        }
        const total = shikimori.episodes
        const end = record.numbering.max
        const explicitPrefix = row.afpPrefix?.length === 2 && row.afpPrefix[0] === 1 && row.afpPrefix[1] === end
        if (end > total || (end < total && !explicitPrefix) ||
            !localEdge(row.malToAniList, 'anilist:' + anilist, total) || !localEdge(row.aniListToMal, 'mal:' + mal, total)) {
            excluded[mal] = 'afp_local_scope_unverified'
            continue
        }
        const legacy = lock.legacyTupleSource[mal]
        facts[mal] = [total, record.id, legacy ? parseTuple(legacy)[2] : false]
    }
    assert.deepEqual(seenRecords, new Set(records.keys()))
    for (const row of catalogue.withoutAfp) {
        assert.ok(!seenMal.has(Number(row.id)) && !owners.has('mal:' + row.id))
        assert.ok(Object.hasOwn(lock.legacyTupleSource, row.id) && row.id === row.malId && row.kind === 'tv' &&
            row.status === 'released' && bound(row.episodes))
        facts[row.id] = [row.episodes, null, false]
    }
    for (const row of historical.facts) {
        const saved = lock.legacyTupleSource[row.id]
        assert.equal(row.id, row.malId)
        assert.equal(row.kind, 'tv')
        assert.equal(row.status, 'released')
        assert.equal(formatTuple(facts[row.id]), saved, 'Legacy tuple changed: ' + row.id)
        assert.equal(facts[row.id][0], row.episodes)
    }
    assert.equal(Object.keys(lock.legacyTupleSource).length, historical.facts.length)
    assert.deepEqual(Object.keys(facts).filter(key => facts[key][2]), ['269','1735'])
    for (const item of catalogue.prefixEvidence) {
        const target = ongoing[item.mal]
        assert.ok(target && item.record === target.record && item.scheme === 'afp-local-tv' &&
            item.method === 'independent-episode-crosswalk-v1' && item.first === 1 && bound(item.through) &&
            /^serial-[1-9][0-9]{0,24}$/.test(item.material) && canonicalId(item.translation) &&
            canonicalId(item.season) && digest(item.captureSha256) && digest(item.crosswalkSha256) &&
            digest(item.orderedLinksSha256), 'Invalid prefix evidence')
        assert.ok(!target.proofs.some(p => p.material === item.material && p.translation === item.translation &&
            p.season === item.season), 'Ambiguous prefix evidence')
        target.proofs.push({material:item.material, translation:item.translation, season:item.season,
            through:item.through, sha256:item.orderedLinksSha256})
    }
    for (const {proofs} of Object.values(ongoing)) proofs.sort((a,b) =>
        compareText(a.material, b.material) || Number(a.translation) - Number(b.translation) || Number(a.season) - Number(b.season))
    return {facts, ongoing, excluded}
}

function parseTuple(source) { return JSON.parse(source.replaceAll("'", '"')) }

function formatTuple(tuple) {
    const [total, record, sparse] = tuple
    assert.ok(record === null || /^[a-z0-9-]+$/.test(record))
    return `[${total}, ${record === null ? 'null' : "'" + record + "'"}, ${sparse}]`
}

function render(lock, {facts, ongoing}) {
    const sortedEntries = object => Object.entries(object).sort(([a],[b]) => Number(a) - Number(b))
    const factsLines = sortedEntries(facts).map(([mal, tuple]) => `        '${mal}': ${formatTuple(tuple)}`)
    const ongoingLines = sortedEntries(ongoing).map(([mal, row]) => `        '${mal}': ${JSON.stringify(row)}`)
    return [BEGIN, `    var MAPPER_AUDIT = '${lock.auditRevision}'`,
        `    var MAPPER_DATA_VERSION = '${lock.datasetVersion}'`,
        '    // [Independent total, exact AFP record or null, legacy sparse permission]',
        '    var MAPPER_FACTS = {', factsLines.join(',\n'), '    }',
        '    var MAPPER_ONGOING = {', ongoingLines.join(',\n'), '    }', END].join('\n')
}

function updateBlock(source, block) {
    const first = source.indexOf(BEGIN)
    const last = source.indexOf(END)
    assert.ok(first >= 0 && last > first && first === source.lastIndexOf(BEGIN) &&
        last === source.lastIndexOf(END), 'Generated catalogue markers missing or duplicated')
    return source.slice(0, first) + block + source.slice(last + END.length)
}

if (require.main === module) {
    const mode = process.argv[2] || '--check'
    assert.ok(['--check','--write','--report'].includes(mode), 'Use --check, --write or --report')
    const inputs = readInputs()
    const result = build(inputs)
    if (mode === '--report') {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
        const file = path.join(root, 'anime-filler.js')
        const source = fs.readFileSync(file, 'utf8')
        const updated = updateBlock(source, render(inputs.lock, result))
        if (mode === '--write') fs.writeFileSync(file, updated)
        else assert.equal(hash(source), hash(updated), 'Generated mapper catalogue differs. Run with --write.')
    }
}

module.exports = {readInputs, build, render, updateBlock}
