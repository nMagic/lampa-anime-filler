'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {createHash} = require('node:crypto')
const {execFileSync} = require('node:child_process')
const {readInputs, build, render, updateBlock} = require('../tools/build-mapper-facts')

// Reuse the existing VM and Online_Mod event harness without registering the 3C/3E tests twice.
const old = fs.readFileSync(path.join(__dirname, 'stage-3c-mapper.test.js'), 'utf8')
const mod = {exports:{}}
new Function('require', '__dirname', 'module',
    old.slice(0, old.indexOf("test('real catalogue audit")) +
    '\nmodule.exports = {setup, material, bind, row, before, respond, rows, flush, diagnosticsText, totals}'
)(require, __dirname, mod)
const {setup, material, bind, row, before, respond, rows, flush, diagnosticsText, totals} = mod.exports

const inputs = readInputs()
const {facts, ongoing, excluded} = build(inputs)
Object.assign(totals, Object.fromEntries(Object.entries(facts).map(([mal, tuple]) => [mal,tuple[0]])))
const source = fs.readFileSync(path.join(__dirname, '../anime-filler.js'), 'utf8')
const labels = {canon:'Canon', filler:'Filler', mixed:'Mixed', unknown:'Неизвестно'}
const badge = entry => entry.node.querySelectorAll('.anime-filler-episode-label')[0]?.textContent
const hash = data => createHash('sha256').update(data).digest('hex')

test('4B offline generator reproduces the committed catalogue and all thirteen literal legacy tuples', () => {
    assert.equal(Object.keys(facts).length, 124)
    assert.equal(Object.keys(facts).length - Object.keys(inputs.lock.legacyTupleSource).length, 111)
    assert.deepEqual(Object.keys(facts).filter(id => facts[id][2]), ['269','1735'])
    assert.deepEqual(Object.keys(ongoing), ['21','235'])
    assert.ok(Object.values(ongoing).every(area => area.proofs.length === 0))
    assert.equal(Object.keys(excluded).length, 7)
    const block = render(inputs.lock, build(inputs))
    const reversed = structuredClone(inputs)
    reversed.catalogue.areas.reverse()
    assert.equal(render(inputs.lock, build(reversed)), block)
    assert.equal(updateBlock(source, block), source)
    for (const [id, original] of Object.entries(inputs.lock.legacyTupleSource)) {
        assert.equal(source.split("'" + id + "': ")[1].split('\n')[0].replace(/,$/, ''), original)
    }
    execFileSync(process.execPath, ['tools/build-mapper-facts.js', '--check'], {
        cwd:path.join(__dirname, '..'), env:{PATH:process.env.PATH, HTTP_PROXY:'http://127.0.0.1:1', HTTPS_PROXY:'http://127.0.0.1:1'}
    })
})

test('4B rejects modified pinned bytes, catalogue conflicts and damaged AFP ranges', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afp-mapper-'))
    t.after(() => fs.rmSync(dir, {recursive:true, force:true}))
    const lockFile = 'tools/mapper-facts/inputs.lock.json'
    const catalogueFile = 'tools/mapper-facts/catalog.json'
    for (const relative of [lockFile, ...Object.keys(inputs.lock.files)]) {
        fs.mkdirSync(path.dirname(path.join(dir, relative)), {recursive:true})
        fs.copyFileSync(path.join(__dirname, '..', relative), path.join(dir, relative))
    }
    fs.appendFileSync(path.join(dir, catalogueFile), ' ')
    assert.throws(() => readInputs(dir), /SHA-256 mismatch/)
    const changed = mutate => {
        const next = structuredClone(inputs)
        const target = next.catalogue.areas.find(r => r.mal === 34566)
        mutate(target, next)
        return build(next)
    }
    for (const mutate of [
        r => { r.shikimori.kind = 'ova' },
        r => { r.shikimori.status = 'ongoing' },
        r => { r.shikimori.episodes -= 1 },
        r => { r.shikimori.malId = '20' },
        r => { r.shikimoriBatch = 'unlocked.json' },
        r => { r.malToAniList['anilist:20'] = {'1-293':'1-293'} },
        r => { r.aniListToMal['mal:34566'] = {'1-293':'2-294'} },
        r => { r.afpBoundIds.anilist = 20 },
        r => { r.afpSourceSha256 = '1'.repeat(64) }
    ]) assert.ok(changed(mutate).excluded[34566])
    assert.throws(() => changed((r, next) => next.catalogue.areas.push(r)), /Duplicate catalogue area/)
    assert.throws(() => changed((r, next) => {
        next.dataset.records.find(record => record.id === r.record).ranges.unshift([1,1,'filler'])
    }), /overlapping AFP ranges/)
    const wrongScope = changed((r, next) => {
        const d = next.catalogue.areas.find(record => record.mal === 407)
        delete d.afpPrefix
    })
    assert.equal(wrongScope.excluded[407], 'afp_local_scope_unverified')
})

test('4B proof generation checks identity, absolute beginning, bounds and conflicting attestations', () => {
    const proof = {mal:21, record:'one-piece', scheme:'afp-local-tv', method:'independent-episode-crosswalk-v1',
        first:1, through:9, material:'serial-730001', translation:'609', season:'1', captureSha256:'1'.repeat(64),
        crosswalkSha256:'2'.repeat(64), orderedLinksSha256:'3'.repeat(64)}
    const generate = evidence => {
        const next = structuredClone(inputs)
        next.catalogue.prefixEvidence = evidence
        return build(next)
    }
    assert.deepEqual(generate([proof]).ongoing[21].proofs, [{
        material:proof.material, translation:proof.translation, season:proof.season,
        through:proof.through, sha256:proof.orderedLinksSha256
    }])
    for (const changes of [
        {mal:20}, {record:'meitantei-conan'}, {scheme:'international'}, {first:2}, {through:0}, {through:25001},
        {crosswalkSha256:'missing'}, {method:'length-and-title'}, {material:'movie-1'}, {translation:'0609'}
    ]) assert.throws(() => generate([{...proof,...changes}]), /Invalid prefix evidence/)
    assert.throws(() => generate([proof,{...proof,through:10}]), /Ambiguous prefix evidence/)
})

test('4B renders each of 124 complete synthetic R1 lists with real AFP data', async () => {
    const byId = new Map(inputs.dataset.records.map(record => [record.id, record]))
    const counts = {canon:0, filler:0, mixed:0, unknown:0}
    for (const [mal, [total, recordId]] of Object.entries(facts)) {
        const s = setup({mal_id:Number(mal)})
        const entries = await bind(s, material(mal, {season:'2'}))
        const summary = s.api.summary()
        assert.equal(summary.canonicalArea, 'mal:' + mal)
        assert.equal(summary.rule, 'R1', mal)
        assert.equal(summary.gates.length, 9)
        assert.ok(summary.gates.every(gate => gate.status === 'passed'))
        const record = byId.get(recordId)
        for (const entry of entries) {
            const n = entry.element.episode
            const category = record?.ranges.find(([a,b]) => a <= n && n <= b)?.[2]
            const mapped = s.api.metadata(entry.node).mapping
            assert.equal(mapped.malEpisode, n)
            assert.equal(mapped.afpEpisode, record ? n : null)
            assert.equal(mapped.recordId, recordId)
            assert.equal(mapped.category, category || null)
            assert.equal(mapped.skipEligible, false)
            assert.equal(badge(entry), labels[category || 'unknown'])
            if (!category) assert.equal(mapped.reason, !record ? 'classification_missing' :
                n > record.numbering.max ? 'classification_outside_snapshot' : 'classification_gap')
            counts[category || 'unknown']++
        }
        assert.equal(entries.length, total)
    }
    assert.deepEqual(counts, {canon:4408, filler:1076, mixed:327, unknown:60})
})

test('4B keeps the audited R1 refusals and the two existing R2 exceptions', async () => {
    for (const [id, missing] of [[1735,58],[269,177]]) {
        const s = setup()
        const entries = await bind(s, material(id, {missing:[missing]}))
        assert.equal(s.api.summary().rule, 'R2')
        assert.equal(row(s, entries, missing + 1).afpEpisode, missing + 1)
    }
    for (const id of Object.keys(excluded)) {
        const record = inputs.dataset.records.find(record => record.mal === Number(id))
        totals[id] = record.numbering.max
        const s = setup()
        const entries = await bind(s, material(id))
        assert.equal(s.api.summary().reason, 'catalog_policy_unavailable')
        assert.ok(entries.every(entry => badge(entry) === labels.unknown))
    }
    for (const [id, options, reason] of [
        [6702, {missing:[175]}, 'numbering_boundary_mismatch'],
        [34566, {missing:[30]}, 'sparse_area_unapproved']
    ]) {
        const s = setup()
        assert.ok((await bind(s, material(id, options))).every(entry => badge(entry) === labels.unknown))
        assert.equal(s.api.summary().reason, reason)
    }
    const gin = setup()
    gin.api.facts['918'] = [201,'gintama',false]
    assert.ok((await bind(gin, material(918))).every(entry => badge(entry) === labels.unknown))
    assert.equal(gin.api.summary().rule, 'R1')
    assert.ok(gin.api.labels().reasons.record_integrity_issues)
})

function prefixMaterial(count, {id = 21, start = 1, shift = 0, ...options} = {}) {
    totals[id] = count
    const result = material(id, options)
    if (start !== 1 || shift) {
        const season = result.seasons[Object.keys(result.seasons)[0]]
        season.episodes = Object.fromEntries(Object.values(season.episodes).map((link, i) => [
            start + i, shift ? link.replace('/seria/', '/seria/' + shift) : link
        ]))
    }
    return result
}

// Test-only evidence for mock opaque URLs. Production is deliberately proof-free.
function attest(s, material, through) {
    const id = material.shikimori_id
    const season = Object.keys(material.seasons)[0]
    const links = Array.from({length:through}, (_,i) => material.seasons[season].episodes[i+1].trim())
    const translation = String(material.translation.id)
    s.api.ongoing[id].proofs.push({material:material.id, translation, season, through,
        sha256:hash(JSON.stringify(['kodik-afp-prefix-v1', 'mal:' + id, material.id, translation, season, links]))})
}

test('P1 verified synthetic prefix preserves Canon/Filler/Mixed and classifies only attested rows', async () => {
    const s = setup({mal_id:21, anilist_id:21})
    const m = prefixMaterial(1181, {episodes_count:1181,last_episode:1181})
    attest(s, m, 1168)
    const entries = await bind(s, m)
    const summary = s.api.summary()
    assert.equal(summary.rule, 'P1')
    assert.equal(summary.reason, 'prefix_mapped')
    assert.equal(summary.total, null)
    assert.equal(summary.verifiedThrough, 1168)
    assert.equal(summary.classified, 1168)
    assert.equal(summary.unknown, 13)
    const sourceRecord = inputs.dataset.records.find(record => record.mal === 21)
    for (const type of ['canon','filler','mixed']) {
        const n = sourceRecord.ranges.find(range => range[2] === type)[0]
        assert.equal(badge(entries[n-1]), labels[type])
        assert.equal(row(s, entries, n).afpEpisode, n)
        assert.equal(row(s, entries, n).skipEligible, false)
    }
    assert.equal(badge(entries[1168]), labels.unknown)
    assert.equal(row(s, entries, 1169).reason, 'classification_outside_snapshot')
    assert.equal(row(s, entries, 1169).malEpisode, null)
    assert.match(diagnosticsText(s.h), /P1-numbering=passed/)
    assert.match(diagnosticsText(s.h), /1–1168/)
    assert.doesNotMatch(diagnosticsText(s.h), /SYNTHETIC_PRIVATE|\/seria\//)
})

test('P1 verifies an AFP gap independently from an unverified tail within AFP', async () => {
    const s = setup()
    const m = prefixMaterial(10)
    const record = s.api.dataState.dataset.records.find(r => r.mal === 21)
    const first = record.ranges.shift()
    assert.ok(first[1] >= 3)
    record.ranges.unshift([1,1,first[2]], [3,first[1],first[2]])
    attest(s, m, 5)
    const entries = await bind(s, m)
    assert.equal(badge(entries[0]), labels[first[2]])
    assert.equal(badge(entries[1]), labels.unknown)
    assert.equal(row(s, entries, 2).reason, 'classification_gap')
    assert.equal(badge(entries[2]), labels[first[2]])
    assert.equal(row(s, entries, 6).reason, 'prefix_numbering_unverified')
    assert.equal(badge(entries[5]), labels.unknown)
})

test('P1 refuses unauthenticated numbering, including both production ongoing areas', async () => {
    for (const [id, reason] of [[21,'prefix_numbering_unverified'],[235,'prefix_identity_ambiguous']]) {
        const s = setup({mal_id:id})
        const entries = await bind(s, prefixMaterial(25,{id}))
        assert.equal(s.api.summary().reason, reason)
        assert.ok(entries.every(entry => badge(entry) === labels.unknown))
        assert.match(diagnosticsText(s.h), new RegExp(reason))
        if (id === 235) assert.match(diagnosticsText(s.h), /unverified \/ documented/)
    }
})

test('P1 refuses wrong edition, an offset beginning, gaps, identity conflicts, filtering and mixed scope', async () => {
    const cases = [
        {reason:'prefix_numbering_unverified', make:() => prefixMaterial(9,{shift:1})},
        {reason:'prefix_scope_incomplete', make:() => prefixMaterial(9,{start:2})},
        {reason:'prefix_scope_incomplete', make:() => prefixMaterial(9,{missing:[3]})},
        {reason:'prefix_scope_incomplete', make:() => prefixMaterial(4)},
        {reason:'identifier_conflict', card:{mal_id:20}},
        {reason:'identifier_conflict', card:{anilist_id:99999}},
        {reason:'filtered_scope', suffix:'&season%5B%5D=1'},
        {reason:'prefix_scope_incomplete', suffix:'&episode_from=1'},
        {reason:'special_or_unreviewed_scope', alter:m => {m.seasons['1'].title = 'Recap'}},
        {reason:'multiple_nonempty_areas', alter:m => {m.seasons['2'] = {title:'Special',episodes:{1:'//kodik.info/seria/7/special/720p'}}}},
        {reason:'unsupported_material_type', alter:m => {m.type = 'anime'}},
        {reason:'counter_inconsistent', alter:m => {m.episodes_count = 1180}},
        {reason:'afp_local_relation_unreviewed', alter:(m,s) => {s.api.dataState.dataset.records.find(r => r.mal === 21).id = 'other'}},
        {reason:'identity_audit_required', alter:(m,s) => {s.api.dataState.version = 'other'}},
        {reason:'prefix_identity_ambiguous', alter:(m,s) => {s.api.ongoing[21].proofs.push(s.api.ongoing[21].proofs[0])}}
    ]
    for (const {reason, make, card, suffix, alter} of cases) {
        const s = setup(card)
        attest(s, prefixMaterial(9), 5)
        const m = make ? make() : prefixMaterial(9)
        if (alter) alter(m,s)
        const entries = await bind(s, m, {suffix})
        assert.equal(s.api.summary().reason, reason)
        assert.equal(s.api.summary().classified, 0)
        assert.ok(entries.every(entry => badge(entry) === labels.unknown), reason)
    }
})

test('P1 rejects a Whole Cake Island arc renumbered from 1 even if the material IDs match', async () => {
    const s = setup({mal_id:21})
    const full = prefixMaterial(95)
    attest(s, full, 95)
    const arc = prefixMaterial(95, {shift:8})
    const entries = await bind(s, arc)
    const record = inputs.dataset.records.find(r => r.mal === 21)
    const category = n => record.ranges.find(([first,last]) => first <= n && n <= last)[2]
    assert.equal(category(54), 'filler')
    assert.equal(category(783 + 54 - 1), 'canon')
    assert.equal(row(s, entries, 54).category, null)
    assert.equal(s.api.summary().reason, 'prefix_numbering_unverified')
    assert.ok(entries.every(entry => badge(entry) === labels.unknown))
})

test('P1 clears badges on new Kodik responses, voice/material switches and dataset replacement', async () => {
    const s = setup({mal_id:21})
    const m = prefixMaterial(9)
    const voice = prefixMaterial(9, {translation:610})
    const other = prefixMaterial(9, {materialId:'serial-730002', shift:2})
    attest(s, m, 9)
    const obsolete = before(s.h)
    const initial = await bind(s, m, {materials:[m,voice]})
    assert.equal(s.api.summary().rule, 'P1')
    const changedVoice = rows(s.h,s.a,voice)
    await flush()
    assert.ok(initial.every(entry => !badge(entry)))
    assert.ok(changedVoice.every(entry => badge(entry) === labels.unknown))
    assert.equal(s.api.summary().reason, 'prefix_numbering_unverified')
    const changedMaterial = await bind(s, other)
    respond(s.h, obsolete, [m])
    await flush()
    assert.ok(changedMaterial.every(entry => badge(entry) === labels.unknown))
    const again = await bind(s, m)
    const oldContext = s.api.context()
    assert.equal(s.api.summary().rule, 'P1')
    s.api.ready()
    await flush()
    assert.notEqual(s.api.context(), oldContext)
    assert.equal(s.api.summary().rule, 'P1')
    assert.ok(again.every(entry => s.api.metadata(entry.node).mapping.context === s.api.context()))
})
