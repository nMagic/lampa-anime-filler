'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const root = path.join(__dirname, '..')
const old = fs.readFileSync(path.join(__dirname, 'anime-filler.test.js'), 'utf8')
const mod = { exports: {} }
new Function('require', '__dirname', 'module', old.slice(0, old.indexOf("test('initializes immediately")) +
    '\nmodule.exports = {createHarness,flush,diagnosticsText}') (require, __dirname, mod)
const { createHarness, flush, diagnosticsText } = mod.exports
const plugin = fs.readFileSync(path.join(root, 'anime-filler.js'), 'utf8')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json')))
const raw = fs.readFileSync(path.join(root, 'data', manifest.file), 'utf8')
const audit = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/stage-3c-catalog-audit.json')))
// Test-only access through VM instrumentation. The shipping file exposes no API.
const instrumented = plugin.replace('    if (!window[READY_FLAG]) startPlugin()', `
    window.mapperTest = { summary: function () { return mapping }, metadata: function (node) { return templateMetadata.get(node) },
      context: function () { return mappingContext }, facts: MAPPER_FACTS, stats: mapperKeyStats,
      refresh: refreshMapping, dataState: dataState, classify: resolveClassifications,
      rescan: refreshCurrentList, load: loadClassifications, labels: function () { return labelState },
      ready: function () { var m = parseManifest(${JSON.stringify(JSON.stringify(manifest))});
        acceptDataset(${JSON.stringify(raw)}, m, validateDataset(${JSON.stringify(raw)}, m), 'test'); resolveClassifications() } }
    if (!window[READY_FLAG]) startPlugin()`)
const requestURL = 'https://kodik-api.com/search?with_episodes=true&token=SYNTHETIC_PRIVATE'
const totals = {20:220,1735:500,269:366,41467:13,53998:13,56784:14,60636:10,121:51,5114:64,740:43,5262:51,36474:24,35788:12}
// Every material/URL/keyset below is SYNTHETIC. Real IDs only select the real catalogue.
// They do not reconstruct the unknown missing keys from the Android summaries.
function material(id = 20, options = {}) {
    const { missing = [], season = '1', materialId = 'serial-730001', translation = 609, ...changes } = options
    const episodes = {}
    for (let n = 1; n <= totals[id]; n++) if (!missing.includes(n)) episodes[n] = '//kodik.info/seria/' + (translation*10000+n) + '/synthetic/720p'
    return { id:materialId, shikimori_id:String(id), type:'anime-serial', title:'Synthetic material', title_orig:'Synthetic',
        translation:{id:translation,title:'Synthetic voice '+translation}, seasons:{[season]:{episodes}}, ...changes }
}
function setup(card = {title:'Synthetic card'}, ready = true, options) {
    const h = createHarness(options); vm.runInContext(instrumented, h.context)
    const api = h.context.window.mapperTest
    const a = h.makeActivity(card); h.startActivity(a)
    if (ready) api.ready()
    return {h,a,api}
}
function before(h, suffix = '') {const params={url:requestURL+suffix};h.emit('request_before',{params});return params}
function respond(h, params, materials) {h.emit('request_secuses',{params,data:{results:materials}})}
function rows(h,a,m,season=Object.keys(m.seasons)[0]) {
    a.root.clear(); const result=[]
    for (const key of Object.keys(m.seasons[season].episodes)) result.push(h.addEpisode(a,{season,episode:parseInt(key),
        link:m.seasons[season].episodes[key],orig_title:m.title_orig,translate_voice:m.translation.title}))
    return result
}
async function bind(s,m,options={}) {const params=before(s.h,options.suffix);respond(s.h,params,options.materials||[m]);const r=rows(s.h,s.a,m,options.season);await flush();return r}
function row(s,rows,n) {return s.api.metadata(rows.find(r=>r.element.episode===n).node).mapping}
function refused(s,gate,reason) {
    const m=s.api.summary();assert.equal(m.failedGate,gate);assert.equal(m.reason,reason)
    assert.notEqual(m.numberingGrade,'policy_mapped')
    for(const b of s.api.context()?.bindings||[])assert.equal(b.metadata.mapping.category,null)
}

test('real catalogue audit independently agrees with all 13 embedded facts and all 153 canonical IDs',()=>{
    const s=setup(), facts=s.api.facts, dataset=JSON.parse(raw)
    assert.equal(audit.fixtureKind,'REAL_CATALOGUE_AUDIT_NOT_KODIK_PAYLOAD')
    assert.equal(audit.datasetVersion,manifest.version)
    assert.equal(audit.facts.length,13)
    for(const f of audit.facts){assert.equal(f.id,f.malId);assert.equal(f.kind,'tv');assert.equal(f.status,'released');assert.equal(facts[f.id][0],f.episodes)}
    assert.deepEqual([...new Set(Object.values(dataset.identifiers))].map(x=>Number(x.split(':')[1])).sort((a,b)=>a-b),audit.verifiedCanonicalMalIds)
    assert.equal(audit.verifiedCanonicalMalIds.length,153)
    for(const {id} of audit.facts){
        const f = facts[id]
        const rs=dataset.records.filter(r=>r.mal===Number(id));assert.equal(rs.length,f[1]===null?0:1)
        if(rs.length)assert.equal(rs[0].numbering.file,f[1]+'-episodes.json')
    }
})
test('synthetic Naruto full list uses real AFP26 filler and AFP53 mixed without TMDB or manual confirmation',async()=>{
    const s=setup(),m=material(),r=await bind(s,m)
    assert.equal(s.api.summary().rule,'R1');assert.equal(s.api.summary().mapped,220)
    assert.equal(row(s,r,26).category,'filler');assert.equal(row(s,r,53).category,'mixed')
    assert.equal(row(s,r,53).numberingGrade,'policy_mapped')
    assert.equal(row(s,r,26).displayReady,true);assert.equal(row(s,r,26).fillerReady,true);assert.equal(row(s,r,26).skipEligible,false)
    assert.equal(s.api.summary().gates.length,9)
    assert.ok(s.api.summary().gates.every(g=>g.status==='passed'))
    assert.deepEqual(s.h.calls.params.map(p=>p.param.name),['anime_filler_about','anime_filler_diagnostics'])
})
test('synthetic sparse Shippuden and Bleach preserve raw numbers across artificial holes',async()=>{
    for(const id of [1735,269]){
        const s=setup(),m=material(id,{missing:[26,27,53],season:'2'}),r=await bind(s,m)
        assert.equal(s.api.summary().rule,'R2');assert.deepEqual(Array.from(s.api.summary().stats.missing),[26,27,53])
        assert.equal(row(s,r,54).malEpisode,54);assert.equal(row(s,r,54).afpEpisode,54)
        assert.equal(s.api.summary().mapped,totals[id]-3)
    }
})
test('R2 refuses compact tails, missing endpoints, more than five percent and unapproved sparse areas',async()=>{
    let s=setup();await bind(s,material(1735,{missing:Array.from({length:14},(_,i)=>487+i)}));refused(s,'R2','numbering_boundary_mismatch')
    s=setup();await bind(s,material(269,{missing:[1]}));refused(s,'R2','numbering_boundary_mismatch')
    s=setup();await bind(s,material(1735,{missing:Array.from({length:26},(_,i)=>i+2)}));refused(s,'R2','sparse_limit_exceeded')
    s=setup();await bind(s,material(20,{missing:[26]}));refused(s,'R1','sparse_area_unapproved')
})
test('TYBW separate MAL areas ignore repeated Kodik S2; fourth part never borrows third classification',async()=>{
    for(const [id,record] of [[41467,'bleach-tybw'],[53998,'bleach-tybw-part-2'],[56784,'bleach-tybw-part-3'],[60636,null]]){
        const s=setup(),r=await bind(s,material(id,{season:id===60636?'4':'2'})),v=row(s,r,1)
        assert.equal(v.recordId,record);assert.equal(v.malEpisode,1)
        if(record){assert.equal(v.afpEpisode,1);assert.equal(v.category,'canon')}
        else{assert.equal(v.afpEpisode,null);assert.equal(v.category,null);assert.equal(v.reason,'classification_missing');assert.equal(s.api.summary().unknown,10)}
    }
})
test('adaptations and two synthetic Brotherhood translations map independently and automatically',async()=>{
    const s=setup(),r=await bind(s,material(121));assert.equal(row(s,r,4).category,'filler')
    const a=material(5114,{season:'2'}),b=material(5114,{season:'2',translation:610,materialId:'serial-730002'})
    respond(s.h,before(s.h),[a,b]);let ra=rows(s.h,s.a,a);await flush()
    assert.equal(row(s,ra,4).category,'mixed');const old=s.api.metadata(ra[0].node)
    let rb=rows(s.h,s.a,b);await flush();assert.equal(old.mapping,null)
    assert.equal(row(s,rb,4).category,'mixed');assert.equal(s.api.summary().rule,'R1')
    assert.equal(s.api.context().selected.translation,'610')
})
test('direct IDs conflict; absence from incomplete TMDB index does not conflict',async()=>{
    let s=setup({mal_id:121});await bind(s,material(5114));refused(s,'G7','identifier_conflict')
    s=setup({mal_id:20,anilist_id:116674});await bind(s,material(20));refused(s,'G7','identifier_conflict')
    s=setup({source:'tmdb',id:45782,media_type:'tv'});await bind(s,material(20))
    assert.equal(s.api.summary().cardCheck,'not_in_saved_index');assert.equal(s.api.summary().rule,'R1')
    s=setup({anilist_id:116674});await bind(s,material(41467));assert.equal(s.api.summary().cardCheck,'direct_consistent')
})
test('AFP hole remains unknown at Doki22 while adjacent local numbers and categories are preserved',async()=>{
    const s=setup(),r=await bind(s,material(5262))
    assert.equal(row(s,r,21).category,'filler');assert.equal(row(s,r,22).category,null)
    assert.equal(row(s,r,22).reason,'classification_gap');assert.equal(row(s,r,23).category,'canon')
    assert.equal(row(s,r,23).afpEpisode,23);assert.equal(s.api.summary().unknown,1)
})
test('Sailor R local works but unreviewed absolute offset, split-cour record absence and unknown total refuse',async()=>{
    let s=setup();await bind(s,material(740));assert.equal(s.api.summary().rule,'R1')
    let m=material(740),es={};for(let i=47;i<=89;i++)es[i]='//kodik.info/seria/'+i+'/synthetic/720p';m.seasons['1'].episodes=es
    await bind(s,m);refused(s,'R1','numbering_boundary_mismatch')
    s=setup();await bind(s,material(36949,{seasons:{'1':{episodes:{1:'//kodik.info/seria/1/synthetic/720p'}}}}));refused(s,'G2','catalog_policy_unavailable');assert.equal(s.api.summary().recordAbsent,true)
    s=setup();s.api.facts['20'][0]=null;await bind(s,material());refused(s,'G6','catalog_total_unavailable')
})
test('unknown/missing material type is never filled from name, ID, catalogue or fixture',async()=>{
    for(const type of [undefined,'serial','anime','']){const s=setup();await bind(s,material(20,{type}));refused(s,'G2','unsupported_material_type')}
})
test('unsupported season, unprojectable area and hidden second season block mapping rather than silently dropping structure',async()=>{
    let s=setup(),m=material();m.seasons['2']={episodes:{1:'//kodik.info/seria/99/synthetic/720p'}};await bind(s,m);refused(s,'G3','multiple_nonempty_areas')
    for(const key of ['special','0']){s=setup();m=material();m.seasons[key]={episodes:{0:'//kodik.info/seria/99/synthetic/720p'}};await bind(s,m);refused(s,'G3',key==='special'?'structure_incomplete':'multiple_nonempty_areas')}
    for(const title of ['Recap','Special','https://secret.invalid/private', {bad:true}]){s=setup();m=material();m.seasons['1'].title=title;await bind(s,m);refused(s,'G4','special_or_unreviewed_scope')}
    s=setup();m=material(5114,{season:'2'});m.seasons['2'].title='Сезон 2';await bind(s,m);assert.equal(s.api.summary().rule,'R1')
})
test('request filtering including encoded array keys and expanded-data flags refuses without new HTTP',async()=>{
    for(const suffix of ['&season=1','&episode=1','&%73eason%5B0%5D=1','&with_episodes_data=true','&with_episodes_data=unknown','&with_episodes_data=false&with_episodes_data=false']){
        const s=setup();await bind(s,material(),{suffix});assert.equal(s.api.summary().failedGate,'G3')
        assert.equal(s.api.summary().classified,0)
    }
})
test('raw-key collisions and duplicate episode URLs cannot acquire categories',async()=>{
    for(const rawKey of ['01','1.0','1.5','1e2','1-2','0','-1','9007199254740992']){
        const s=setup(),m=material();m.seasons['1'].episodes[rawKey]='//kodik.info/seria/999/synthetic/720p'
        await bind(s,m);assert.equal(s.api.summary().failedGate,'G5');assert.equal(s.api.summary().classified,0)
    }
    const s=setup(),m=material();m.seasons['1'].episodes['2']=m.seasons['1'].episodes['1'];await bind(s,m);refused(s,'G5','duplicate_episode_link')
})
test('counter compatibility is explicit; absent optional counters are not zero, unexplained values veto',async()=>{
    for(const count of [497,500]){const s=setup();await bind(s,material(1735,{missing:[26,27,53],episodes_count:count,last_episode:500}));assert.equal(s.api.summary().rule,'R2')}
    for(const changes of [{episodes_count:219},{last_episode:219},{episodes_count:0},{episodes_count:'220.0'}]){
        const s=setup();await bind(s,material(20,changes));refused(s,'G8','counter_inconsistent')
    }
})
test('different dataset version, unavailable data, prefixed/unknown IDs and missing record preserve separate stages',async()=>{
    let s=setup();s.api.dataState.version='new';await bind(s,material());refused(s,'G1','identity_audit_required')
    s=setup({},false);await bind(s,material());refused(s,'G1','data_unavailable')
    for(const id of ['z20','020','20.0',undefined,'999999']){
        s=setup();await bind(s,material(20,{shikimori_id:id}));assert.equal(s.api.summary().failedGate,'G1');assert.equal(s.api.summary().classified,0)
    }
    s=setup();await bind(s,material(20,{shikimori_id:'55454'}));assert.equal(s.api.summary().canonicalArea,'mal:55454');refused(s,'G2','catalog_policy_unavailable')
})
test('synthetic contradictory AFP ranges fail closed even when both hits have same category',async()=>{
    const s=setup();const r=s.api.dataState.dataset.records.find(r=>r.mal===20);r.ranges.push([26,26,'filler'])
    const rs=await bind(s,material());assert.equal(row(s,rs,26).status,'conflict');assert.equal(row(s,rs,26).category,null)
})
test('freshness covers request/response/voice/root/history/balancer/dataset and detached nodes',async()=>{
    const s=setup(),m=material();let r=await bind(s,m),old=s.api.metadata(r[0].node),oldContext=s.api.context()
    const stale=before(s.h);assert.equal(old.mapping,null);s.api.refresh();assert.equal(s.api.summary().classified,0)
    const current=before(s.h);respond(s.h,current,[m]);r=rows(s.h,s.a,m);await flush()
    assert.notEqual(s.api.context(),oldContext);respond(s.h,stale,[material(121)]);assert.equal(row(s,r,26).category,'filler')
    old=s.api.metadata(r[0].node);s.h.leaveActivity(s.a);assert.equal(old.mapping,null)
    s.h.returnActivity(s.a);await flush();assert.equal(s.api.summary().rule,'R1')
    s.h.lampa.Storage.set('online_mod_balanser','CDNVideoHub');await flush();assert.equal(s.api.context(),null)
    s.h.lampa.Storage.set('online_mod_balanser','kodik');await flush();assert.equal(s.api.summary().classified,0)
    r=await bind(s,m);old=s.api.metadata(r[0].node);s.h.recreateActivity(s.a);await flush();assert.equal(old.mapping,null);assert.equal(s.api.summary().classified,0)
    r=await bind(s,m);old=s.api.metadata(r[0].node);s.api.ready();assert.equal(old.mapping,null);await flush();assert.equal(s.api.summary().rule,'R1')
    s.a.root.clear();s.api.refresh();assert.equal(s.api.summary().classified,0)
})
test('card change, old-response replay and partial or ambiguous lists never receive stale results',async()=>{
    const s=setup(),m=material(),p=before(s.h);respond(s.h,p,[m]);let r=rows(s.h,s.a,m);await flush();const old=s.api.metadata(r[0].node)
    s.a=s.h.makeActivity({title:'New card'});s.h.startActivity(s.a);assert.equal(old.mapping,null)
    respond(s.h,p,[m]);rows(s.h,s.a,m);await flush();assert.equal(s.api.summary().classified,0)
    respond(s.h,before(s.h),[m]);r=rows(s.h,s.a,m);s.a.root.children.pop();await flush();assert.equal(s.api.summary().reason,'incomplete_list')
    const same=material(20,{materialId:'serial-730009'});respond(s.h,before(s.h),[m,same]);rows(s.h,s.a,m);await flush();assert.equal(s.api.summary().status,'ambiguous')
})
test('diagnostics are bounded, have gates and provenance, and add no HTTP/storage/player or playback mutations',async()=>{
    const s=setup(),m=material(),original=JSON.stringify(m)
    s.h.context.XMLHttpRequest=function(){throw Error('unexpected HTTP')}
    s.h.lampa.Player={play(){throw Error('unexpected player')},playlist(){throw Error('unexpected playlist')}}
    const writes=s.h.calls.storageSets.length,r=await bind(s,m),children=s.a.root.children.slice()
    const text=diagnosticsText(s.h);assert.match(text,/G0=passed/);assert.match(text,/G8=passed/)
    assert.match(text,/policy_mapped/);assert.match(text,/Shikimori GraphQL/);assert.match(text,/true \/ true \/ false/)
    assert.doesNotMatch(text,/SYNTHETIC_PRIVATE|kodik-api\.com\/search|\/seria\//)
    assert.equal(s.h.calls.storageSets.length,writes);assert.equal(JSON.stringify(m),original)
    assert.deepEqual(s.a.root.children,children)
    for(const entry of r){assert.deepEqual(entry.element,entry.before);assert.equal(entry.node.textValue,'')}
    assert.equal((text.match(/raw → MAL-local → AFP-local → category:/g)||[]).length<=8,true)
    assert.equal(s.api.summary().classified,220)
})


test('unexpected expanded response never binds or leaks its payload; diagnostic shape explains refusal',async()=>{
    const s=setup(),m=material();m.seasons['1'].episodes['1']={link:'//kodik.info/seria/1/synthetic/720p',title:'PRIVATE_EPISODE_TEXT'}
    respond(s.h,before(s.h,'&with_episodes_data=true'),[m]);await flush()
    const text=diagnosticsText(s.h);assert.match(text,/expanded/);assert.match(text,/non-link areas: 0 \/ 1/)
    assert.doesNotMatch(text,/PRIVATE_EPISODE_TEXT|SYNTHETIC_PRIVATE/);assert.equal(s.api.summary().classified,0)
})
test('empty special containers are not silently treated as ordinary seasons',async()=>{
    const s=setup(),m=material();m.seasons['0']={title:'Specials',episodes:{}}
    await bind(s,m,{season:'1'});refused(s,'G4','special_or_unreviewed_scope')
})
test('R2 five percent boundary is exact and all other shapes still require every gate',async()=>{
    let s=setup();await bind(s,material(1735,{missing:Array.from({length:25},(_,i)=>i+2)}));assert.equal(s.api.summary().rule,'R2')
    s=setup();await bind(s,material(1735,{missing:[26],type:'serial'}));refused(s,'G2','unsupported_material_type')
})
test('new season in the same response is evaluated afresh without reusing row results',async()=>{
    const s=setup(),first=material(5114,{season:'1'}),second=material(5114,{season:'2',materialId:'serial-730005',translation:610})
    respond(s.h,before(s.h),[first,second]);const r=rows(s.h,s.a,first);await flush();const old=s.api.metadata(r[0].node)
    const next=rows(s.h,s.a,second,'2');await flush();assert.equal(old.mapping,null)
    assert.equal(row(s,next,4).category,'mixed');assert.equal(s.api.context().area.key,'2')
})


test('diagnostics retain every raw key via exact ranges and include noncanonical keys rather than just endpoints',async()=>{
    const s=setup(),m=material(1735,{missing:[26,27,53]});await bind(s,m)
    let text=diagnosticsText(s.h);assert.match(text,/Исходные ключи \(точные диапазоны\): 1–25, 28–52, 54–500/)
    assert.match(text,/Отсутствующие исходные номера: 3: 26, 27, 53/)
    m.seasons['1'].episodes['12.5']='//kodik.info/seria/999/synthetic/720p';await bind(s,m)
    text=diagnosticsText(s.h);assert.match(text,/raw\[12\.5\]/);assert.equal(s.api.summary().classified,0)
})

// Stage 3E exercises the rendered DOM in addition to the diagnostic mapper above.
const labelClass = '.anime-filler-episode-label'
const badge = entry => entry.node.querySelectorAll(labelClass)[0]
const label = (entries, n) => badge(entries.find(entry => entry.element.episode === n))?.textContent
function allLabels(entries, value) {
    assert.ok(entries.length)
    for (const entry of entries) {
        const badges = entry.node.querySelectorAll(labelClass)
        assert.equal(badges.length, value ? 1 : 0)
        if (value) assert.equal(badges[0].textContent, value)
    }
}

test('3E renders all Naruto categories and reports actual visible counts and policy', async () => {
    const s = setup(), r = await bind(s, material())
    assert.deepEqual([label(r, 1), label(r, 26), label(r, 53)], ['Canon', 'Filler', 'Mixed'])
    assert.match(badge(r[25]).className, /--filler$/)
    const text = diagnosticsText(s.h)
    assert.match(text, /Маркировка эпизодов: active/)
    assert.match(text, /Canon \/ Filler \/ Mixed \/ Неизвестно \/ без метки: 74 \/ 90 \/ 56 \/ 0 \/ 0/)
    assert.match(text, /list_bound \/ policy_mapped \/ direct-local-v1 \/ AniFillerPedia/)
    const { attribution, license } = JSON.parse(raw).notices
    assert.ok(text.includes('Источник и лицензия: ' + attribution + ' ' + license))
    assert.doesNotMatch(text.replace(license, ''), /https?:\/\/|SYNTHETIC_PRIVATE|cookie/i)
})

test('3E renders Shippuden and Bleach R2 by original number across holes', async () => {
    for (const [id, missing, expected] of [
        [1735, [58, 72], [[57, 'Filler'], [59, 'Filler'], [71, 'Filler'], [73, 'Canon']]],
        [269, [177], [[176, 'Filler'], [178, 'Filler'], [190, 'Mixed']]]
    ]) {
        const s = setup(), r = await bind(s, material(id, { missing }))
        assert.equal(s.api.summary().rule, 'R2')
        for (const [n, value] of expected) {
            assert.equal(label(r, n), value)
            assert.equal(row(s, r, n).afpEpisode, n)
        }
        assert.equal(r.length, totals[id] - missing.length)
    }
})

test('3E renders both Brotherhood translations and removes badges from detached rows', async () => {
    const s = setup()
    const first = material(5114, { season: '2' })
    const second = material(5114, { season: '2', translation: 610, materialId: 'serial-730002' })
    const old = await bind(s, first, { materials: [first, second] })
    assert.deepEqual([label(old, 1), label(old, 4), label(old, 27)], ['Canon', 'Mixed', 'Filler'])
    const next = rows(s.h, s.a, second)
    await flush()
    allLabels(old, undefined)
    assert.deepEqual([label(next, 1), label(next, 4), label(next, 27)], ['Canon', 'Mixed', 'Filler'])
    assert.equal(s.api.context().selected.translation, '610')
})

test('3E renders TYBW Parts 1–3 by local area and Part 4 as English Unknown', async () => {
    const s = setup(undefined, true, { lang: 'en' })
    for (const id of [41467, 53998, 56784, 60636]) {
        const r = await bind(s, material(id, { season: id === 60636 ? '4' : '2' }))
        assert.equal(s.api.summary().canonicalArea, 'mal:' + id)
        assert.equal(row(s, r, 1).malEpisode, 1)
        allLabels(r, id === 60636 ? 'Unknown' : 'Canon')
    }
    assert.match(diagnosticsText(s.h), /Unknown reasons: classification_missing: 10/)
})

test('3E applies the same policy to the remaining catalogue facts and preserves the Doki gap', async () => {
    const s = setup()
    for (const [id, n, expected] of [[121, 4, 'Filler'], [740, 16, 'Mixed'], [36474, 24, 'Canon'], [35788, 12, 'Canon']]) {
        const r = await bind(s, material(id))
        assert.equal(label(r, n), expected)
    }
    const r = await bind(s, material(5262))
    assert.deepEqual([label(r, 21), label(r, 22), label(r, 23)], ['Filler', 'Неизвестно', 'Canon'])
    assert.equal(s.api.labels().unknown, 1)
    assert.equal(s.api.labels().reasons.classification_gap, 1)
})

test('3E distinguishes unsupported areas even when AFP knows the title', async () => {
    const s = setup()
    const m = material(20, { shikimori_id: '918', seasons: { '1': { episodes: { 1: '//kodik.info/seria/1/test/720p' } } } })
    assert.ok(s.api.dataState.dataset.records.some(record => record.mal === 918))
    allLabels(await bind(s, m), 'Неизвестно')
    assert.match(diagnosticsText(s.h), /unsupported_area \(/)
})

test('3E shows Unknown for missing AFP record or a row outside the classification snapshot', async () => {
    const s = setup(), rs = s.api.dataState.dataset.records
    rs.splice(rs.findIndex(record => record.mal === 20), 1)
    allLabels(await bind(s, material()), 'Неизвестно')
    assert.equal(s.api.labels().reasons.classification_missing, 220)
    s.api.ready()
    const record = s.api.dataState.dataset.records.find(item => item.mal === 20)
    record.ranges.pop()
    record.numbering.max = record.ranges.at(-1)[1]
    const r = await bind(s, material())
    assert.equal(label(r, 1), 'Canon')
    assert.equal(label(r, 220), 'Неизвестно')
    assert.ok(s.api.labels().reasons.classification_outside_snapshot > 0)
})

test('3E emits Unknown when any G0–G8 or R1/R2 guard refuses a recognized list', async () => {
    const scenarios = [
        { gate: 'G0', reason: 'waiting_request', noResponse: true },
        { gate: 'G1', reason: 'shikimori_missing_or_invalid', changes: { shikimori_id: undefined } },
        { gate: 'G2', reason: 'unsupported_material_type', changes: { type: 'serial' } },
        { gate: 'G3', reason: 'filtered_scope', suffix: '&season=1' },
        { gate: 'G4', reason: 'special_or_unreviewed_scope', alter: m => { m.seasons['1'].title = 'Special' } },
        { gate: 'G5', reason: 'numeric_collision', alter: m => { m.seasons['1'].episodes['01'] = '//kodik.info/seria/9/test/720p' } },
        { gate: 'G6', reason: 'afp_local_relation_unreviewed', alter: (m, s) => { s.api.dataState.dataset.records.find(r => r.mal === 20).id = 'other' } },
        { gate: 'G7', reason: 'identity_conflict', card: { mal_id: 121 } },
        { gate: 'G8', reason: 'counter_inconsistent', changes: { episodes_count: 9 } },
        { gate: 'R1', reason: 'sparse_area_unapproved', changes: { missing: [2] } },
        { gate: 'R2', reason: 'numbering_boundary_mismatch', id: 1735, changes: { missing: [500] } }
    ]
    for (const scenario of scenarios) {
        const s = setup(scenario.card), m = material(scenario.id, scenario.changes)
        if (scenario.alter) scenario.alter(m, s)
        const r = scenario.noResponse ? rows(s.h, s.a, m) : await bind(s, m, { suffix: scenario.suffix })
        await flush()
        assert.equal(s.api.summary().failedGate, scenario.gate)
        allLabels(r, 'Неизвестно')
        assert.ok(Object.keys(s.api.labels().reasons).some(reason => reason.includes(scenario.reason)), scenario.gate)
    }
})

test('3E withholds categories on record integrity errors and ambiguous joins', async () => {
    const s = setup(), m = material()
    const record = s.api.dataState.dataset.records.find(r => r.mal === 20)
    record.integrity = 'issues'
    allLabels(await bind(s, m), 'Неизвестно')
    assert.equal(s.api.labels().reasons.record_integrity_issues, 220)
    const ambiguous = material(20, { materialId: 'serial-730002' })
    allLabels(await bind(s, m, { materials: [m, ambiguous] }), 'Неизвестно')
    assert.equal(s.api.labels().reasons.ambiguous_material_or_translation, 220)
})

test('3E replaces Unknown with each category after validated dataset load', async () => {
    const s = setup(undefined, false)
    const r = await bind(s, material())
    allLabels(r, 'Неизвестно')
    assert.equal(s.api.labels().reasons['dataset_unavailable (transport_unavailable)'], 220)
    const requests = datasetTransport(s)
    s.api.load()
    requests.shift().respond(JSON.stringify(manifest))
    requests.shift().respond(raw)
    await flush()
    assert.deepEqual([label(r, 1), label(r, 26), label(r, 53)], ['Canon', 'Filler', 'Mixed'])
})

function datasetTransport(s) {
    let now = Date.now() + 120000
    const requests = []
    s.h.context.Date = { now: () => now }
    s.h.context.XMLHttpRequest = function () {
        this.open = (method, url) => { this.url = url; assert.equal(method, 'GET') }
        this.send = () => requests.push(this)
        this.respond = text => { this.status = 200; this.responseText = text; this.onload() }
    }
    requests.advance = () => { now += 120000 }
    return requests
}

test('3E immediately withholds old categories after a new manifest or a hash failure, then recovers', async () => {
    const s = setup(), r = await bind(s, material())
    const requests = datasetTransport(s), digest = 'a'.repeat(64)
    assert.equal(label(r, 1), 'Canon')
    s.api.load()
    requests.shift().respond(JSON.stringify({ ...manifest, version: digest, sha256: digest, file: 'dataset.' + digest + '.json' }))
    allLabels(r, 'Неизвестно')
    assert.equal(s.api.labels().reasons['dataset_unavailable (dataset_version_changed)'], 220)
    requests.shift().respond(raw)
    allLabels(r, 'Неизвестно')
    assert.equal(s.api.labels().reasons['dataset_unavailable (hash_mismatch)'], 220)
    assert.ok(s.api.dataState.dataset, 'verified cache remains available to the card resolver')
    requests.advance()
    s.api.load()
    requests.shift().respond(JSON.stringify(manifest))
    await flush()
    assert.deepEqual([label(r, 1), label(r, 26), label(r, 53)], ['Canon', 'Filler', 'Mixed'])
    assert.equal(requests.length, 0)
    s.api.dataState.version = digest
    s.api.rescan()
    allLabels(r, 'Неизвестно')
})

test('3E invalidates a previous join on request, ignores stale replies and recomputes the newest material', async () => {
    const s = setup(), a = material(121), b = material(5114, { materialId: 'serial-730002' })
    const old = await bind(s, a)
    assert.equal(label(old, 4), 'Filler')
    const stale = before(s.h)
    allLabels(old, 'Неизвестно')
    const current = before(s.h)
    respond(s.h, stale, [a])
    await flush()
    allLabels(old, 'Неизвестно')
    respond(s.h, current, [b])
    const next = rows(s.h, s.a, b)
    await flush()
    allLabels(old, undefined)
    assert.equal(label(next, 4), 'Mixed')
    respond(s.h, stale, [a])
    await flush()
    assert.equal(label(next, 4), 'Mixed')
})

test('3E recomputes seasons and invalidates retained rows as soon as the full-list join is lost', async () => {
    const s = setup()
    const a = material(121, { season: '1' })
    const b = material(5114, { season: '2', materialId: 'serial-730003' })
    const old = await bind(s, a, { materials: [a, b] })
    assert.equal(label(old, 4), 'Filler')
    const next = rows(s.h, s.a, b)
    await Promise.resolve() // native observer delivery precedes a paint or timer
    allLabels(old, undefined)
    assert.equal(label(next, 4), 'Mixed')
    s.a.root.removeChild(next[0].node)
    await Promise.resolve()
    allLabels(next.slice(1), 'Неизвестно')
    assert.equal(s.api.labels().reasons.incomplete_list, 63)
})

test('3E cleans up on card changes, history, balancer switches and activity root replacement', async () => {
    const s = setup(), m = material(5114)
    const originalActivity = s.a, old = await bind(s, m)
    s.a = s.h.makeActivity({ title: 'Different card' })
    s.h.startActivity(s.a)
    allLabels(old, undefined)
    const other = await bind(s, material(121))
    assert.equal(label(other, 4), 'Filler')
    s.h.returnActivity(originalActivity)
    s.a = originalActivity
    await flush()
    allLabels(other, undefined)
    assert.equal(label(old, 4), 'Mixed')
    s.h.lampa.Storage.set('online_mod_balanser', 'another-provider')
    allLabels(old, undefined)
    const foreign = s.h.addEpisode(s.a, { link: '//another.invalid/seria/1/a/720p' })
    await flush()
    assert.equal(badge(foreign), undefined)
    s.h.lampa.Storage.set('online_mod_balanser', 'kodik')
    const current = await bind(s, m)
    const previousRoot = s.a.root
    s.a.root = s.h.document.createElement('section')
    s.a.activity.render = () => s.a.root
    const rebuilt = rows(s.h, s.a, m)
    s.h.returnActivity(s.a)
    await flush()
    allLabels(current, undefined)
    assert.equal(previousRoot.querySelectorAll(labelClass).length, 0)
    assert.equal(label(rebuilt, 4), 'Mixed')
    s.h.leaveActivity(s.a, true)
    allLabels(rebuilt, undefined)
})

test('3E decorations are idempotent, observe no feedback loop and repair host removal', async () => {
    const s = setup(), r = await bind(s, material(5114)), instance = s.h.observer()
    assert.ok(instance.deliveries >= 2, 'the observer receives both host and badge mutations')
    const deliveries = instance.deliveries, previous = r.map(badge)
    s.api.rescan()
    s.api.rescan()
    await flush()
    assert.equal(instance.deliveries, deliveries)
    assert.deepEqual(r.map(badge), previous)
    assert.equal(s.a.root.querySelectorAll(labelClass).length, r.length)
    assert.equal(s.h.document.head.children.length, 1)
    previous[0].parentNode.removeChild(previous[0])
    await flush()
    assert.equal(badge(r[0]), previous[0])
    assert.equal(instance.deliveries, deliveries + 2)
    await flush()
    assert.equal(instance.deliveries, deliveries + 2)
})

test('3E leaves focus, callbacks and HTTP/Player/Storage intact and ignores non-episode rows', async () => {
    const s = setup(), m = material(5114)
    let http = 0, player = 0
    s.h.context.XMLHttpRequest = function () { http += 1 }
    s.h.lampa.Player = { play: () => { player += 1 }, playlist: () => { player += 1 } }
    const storageWrites = s.h.calls.storageSets.length
    respond(s.h, before(s.h), [m])
    const r = rows(s.h, s.a, m)
    const selected = r[3], selections = []
    const callback = () => selections.push(selected.element.link)
    selected.node.callback = callback
    s.h.document.activeElement = selected.node
    await flush()
    assert.equal(badge(selected).tagName, 'SPAN')
    assert.equal(badge(selected).tabIndex, undefined)
    assert.match(s.h.document.head.children[0].textContent, /pointer-events:none/)
    assert.equal(s.h.document.activeElement, selected.node)
    assert.equal(selected.node.className, 'online selector')
    assert.equal(selected.node.callback, callback)
    selected.node.callback()
    assert.deepEqual(selections, [selected.before.link])
    assert.deepEqual(selected.element, selected.before)

    const movie = s.h.addEpisode(s.a, { episode: undefined, season: undefined })
    const foreign = s.h.addEpisode(s.a, { link: '//another.invalid/seria/1/a/720p' })
    const button = s.h.document.createElement('button')
    button.className = 'online selector'
    s.a.root.appendChild(button)
    await flush()
    allLabels([movie, foreign, { node: button }], undefined)
    assert.equal(label(r, 4), 'Неизвестно')
    assert.match(diagnosticsText(s.h), /list_not_confirmed \(unknown_link_hostname\)/)
    assert.equal(http, 0)
    assert.equal(player, 0)
    assert.equal(s.h.calls.storageSets.length, storageWrites)
})

test('3E counts recognized episodes without a supported decoration target', async () => {
    const s = setup(), r = await bind(s, material(5114)), one = r[0].node
    one.clear()
    await flush()
    assert.equal(badge(r[0]), undefined)
    assert.equal(s.api.labels().unlabelled, 1)
    assert.equal(s.a.root.querySelectorAll(labelClass).length, r.length - 1)
})
