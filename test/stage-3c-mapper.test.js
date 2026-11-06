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
function setup(card = {title:'Synthetic card'}, ready = true) {
    const h = createHarness(); vm.runInContext(instrumented, h.context)
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
    for(const [id,f] of Object.entries(facts)){
        const rs=dataset.records.filter(r=>r.mal===Number(id));assert.equal(rs.length,f[1]===null?0:1)
        if(rs.length)assert.equal(rs[0].numbering.file,f[1]+'-episodes.json')
    }
})
test('synthetic Naruto full list uses real AFP26 filler and AFP53 mixed without TMDB or manual confirmation',async()=>{
    const s=setup(),m=material(),r=await bind(s,m)
    assert.equal(s.api.summary().rule,'R1');assert.equal(s.api.summary().mapped,220)
    assert.equal(row(s,r,26).category,'filler');assert.equal(row(s,r,53).category,'mixed')
    assert.equal(row(s,r,53).numberingGrade,'policy_mapped')
    assert.equal(row(s,r,26).displayReady,false);assert.equal(row(s,r,26).fillerReady,false);assert.equal(row(s,r,26).skipEligible,false)
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
    assert.match(text,/policy_mapped/);assert.match(text,/Shikimori GraphQL/);assert.match(text,/false \/ false \/ false/)
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
