'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {execFileSync} = require('node:child_process')
const {readInputs, build, render, updateBlock} = require('../tools/build-mapper-facts')

// Reuse the existing VM and Online_Mod event harness without registering the 3C/3E tests twice.
const old = fs.readFileSync(path.join(__dirname, 'stage-3c-mapper.test.js'), 'utf8')
const mod = {exports:{}}
new Function('require', '__dirname', 'module',
    old.slice(0, old.indexOf("test('real catalogue audit")) +
    '\nmodule.exports = {setup, material, bind, row, totals}'
)(require, __dirname, mod)
const {setup, material, bind, row, totals} = mod.exports

const inputs = readInputs()
const {facts, excluded} = build(inputs)
Object.assign(totals, Object.fromEntries(Object.entries(facts).map(([mal, tuple]) => [mal,tuple[0]])))
const source = fs.readFileSync(path.join(__dirname, '../anime-filler.js'), 'utf8')
const labels = {canon:'Canon', filler:'Filler', mixed:'Mixed', unknown:'Неизвестно'}
const badge = entry => entry.node.querySelectorAll('.anime-filler-episode-label')[0]?.textContent

test('4B offline generator reproduces the committed catalogue and all thirteen literal legacy tuples', () => {
    assert.equal(Object.keys(facts).length, 124)
    assert.equal(Object.keys(facts).length - Object.keys(inputs.lock.legacyTupleSource).length, 111)
    assert.deepEqual(Object.keys(facts).filter(id => facts[id][2]), ['269','1735'])
    for (const id of [21,235]) {
        assert.equal(facts[id], undefined)
        assert.equal(excluded[id], 'catalog_format_or_status_unsupported')
    }
    assert.equal(Object.keys(excluded).length, 9)
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
