import assert from 'node:assert/strict';
import './validate-xcpcio-gaps.mjs';
import './validate-codeforces-mirrors.mjs';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson, atomicJson, sha256, problemIdentity } from './source-import-lib.mjs';
import { calculateAwards, minutes, parseIndex, verifyPage, awardResult } from './rankland-lib.mjs';
import { inspectRating, applyRating } from './import-xcpc-rating.mjs';
import { enrichReviewedRatings } from './enrich-reviewed-ratings.mjs';
import {latestAwardValue,stage2AwardReview} from './catalog-award-review.mjs';
import {refreshRatingMetadata} from './refresh-xcpc-rating-metadata.mjs';
import { applyRankland } from './import-rankland-standings.mjs';
import { validateSchema } from './validate-source-schemas.mjs';
import { validateSnapshot } from './validate-catalog-snapshot.mjs';


const badMapping=(await readJson('fixtures/imports/xcpc-rating/problem-mapping-exclusions.json')).entries[0];
const excludedRows=badMapping.upstream_problem_identities.map(r=>({contestSlug:badMapping.contest_slug,alias:r.ordinal,title:`Source ${r.ordinal}`,detailTags:['must-not-import'],problemUrl:`https://qoj.ac/problem/${r.identity.split(':')[1]}`,problemRating:1200}));
const excludedReport=inspectRating({contests:[],problems:[]},excludedRows);
assert.equal(excludedReport.matches.length,0);assert.equal(excludedReport.unresolved.length,excludedRows.length);
assert.ok(excludedReport.unresolved.every(r=>r.blocked_mapping_sha256===badMapping.problem_identity_sha256));
const fixedMapping=excludedRows.map((r,i)=>i? r:{...r,problemUrl:'https://qoj.ac/problem/999999'});
assert.ok(inspectRating({contests:[],problems:[]},fixedMapping).unresolved.every(r=>!r.blocked_mapping_sha256),'Corrected future upstream mapping must be re-reviewable, not permanently blacklisted by slug');
const fixture = await readJson('fixtures/imports/xcpc-rating/example.json');
const report = inspectRating(fixture.catalog, fixture.input);
assert.equal(report.matches.length, 1);
for (const [key, value] of Object.entries(fixture.expected)) assert.deepEqual(report.matches[0][key], value);
const enriched = applyRating(fixture.catalog, report);
assert.deepEqual(applyRating(enriched, report), enriched);
assert.deepEqual(enriched.problems[0].sources[0], fixture.catalog.problems[0].sources[0]);
// Reviewed numeric metadata is bound to the exact snapshot and problem identity.
const ratingRows = fixture.input.map(row => ({ ...row, problemRating: 1725.5 }));
const ratingRaw = JSON.stringify(ratingRows);
const ratingReview = { ...report, source_sha256: sha256(ratingRaw), review: { status: 'approved', reviewed_by: 'synthetic regression' } };
const rated = enrichReviewedRatings(enriched, ratingRaw, ratingReview);
assert.equal(rated.problems[0].rating, 1725.5);
assert.equal(enriched.problems[0].rating, undefined);
assert.deepEqual(enrichReviewedRatings(rated, ratingRaw, ratingReview), rated);
const populatedRating=structuredClone(enriched);populatedRating.problems[0].rating=999;
assert.equal(enrichReviewedRatings(populatedRating,ratingRaw,ratingReview).problems[0].rating,999,'Fill missing ratings only; preserve a populated different value');
assert.throws(() => enrichReviewedRatings(enriched, ratingRaw, { ...ratingReview, review: { status: 'pending' } }));
assert.throws(() => enrichReviewedRatings(enriched, ratingRaw + ' ', ratingReview));
assert.throws(() => enrichReviewedRatings(enriched, ratingRaw, { ...ratingReview, matches: [] }));
for (const value of [null, -1, '1725.5']) {
  const raw = JSON.stringify(ratingRows.map(row => ({ ...row, problemRating: value })));
  assert.equal(enrichReviewedRatings(enriched, raw, { ...ratingReview, source_sha256: sha256(raw) }).problems[0].rating, undefined);
}
const renamedRaw = JSON.stringify(ratingRows.map(row => ({ ...row, title: 'Different title' })));
assert.throws(() => enrichReviewedRatings(enriched, renamedRaw, { ...ratingReview, source_sha256: sha256(renamedRaw) }));
const duplicateRaw = JSON.stringify([...ratingRows, ...ratingRows]);
assert.throws(() => enrichReviewedRatings(enriched, duplicateRaw, { ...ratingReview, source_sha256: sha256(duplicateRaw) }));
const conflictingRows = [...ratingRows, { ...ratingRows[0], contestSlug: 'another_contest', problemRating: 1800 }];
const conflictingRaw = JSON.stringify(conflictingRows);
const conflictingReport = inspectRating(fixture.catalog, conflictingRows);
const conflictingCatalog = applyRating(fixture.catalog, conflictingReport);
assert.equal(enrichReviewedRatings(conflictingCatalog, conflictingRaw, { ...conflictingReport, source_sha256: sha256(conflictingRaw), review: ratingReview.review }).problems[0].rating, undefined);
// Untitled numeric rows require complete exact provider IDs AND independent
// original-event identity/date evidence. No ordinal-only or partial-set fallback.
const numericCatalog={contests:[{contestId:'n',title:'Verified event',aliases:[],problemIds:['n:A','n:B','n:C'],startAt:'2020-01-01T01:00:00.000Z',sources:[{provider:'rankland',kind:'standings',provider_contest_id:'srk:official/icpc/example.srk.json',url:'https://rl.algoux.cn/collection/official?rankId=example'}]}],problems:['A','B','C'].map(ordinal=>({problemId:`n:${ordinal}`,contestId:'n',ordinal,title:`Verified ${ordinal}`,aliases:[],sources:[{provider:'codeforces',kind:'problem',url:`https://codeforces.com/gym/100111/problem/${ordinal}`,provider_problem_id:`100111:${ordinal}`}]}))};
const numericRows=['A','B','C'].map((alias,i)=>({contestSlug:'icpc__example',startAt:'2020-01-01T09:00:00+08:00',alias,title:null,detailTags:[],problemUrl:`https://codeforces.com/gym/100111/problem/${alias}`,problemRating:1200+i}));
const numericReport=inspectRating(numericCatalog,numericRows);
assert.equal(numericReport.matches.length,3);
assert.ok(numericReport.matches.every(m=>m.evidence==='complete_provider_ids_and_verified_original_contest'&&m.source_title===null));
const numericEnriched=applyRating(numericCatalog,numericReport),numericRaw=JSON.stringify(numericRows);
const numericReview={...numericReport,source_sha256:sha256(numericRaw),review:ratingReview.review};
assert.deepEqual(enrichReviewedRatings(numericEnriched,numericRaw,numericReview).problems.map(p=>p.rating),[1200,1201,1202]);
// Losing a source title changes the evidence to numeric-only, never to an
// authoritative empty tag list. Preserve prior tags even while refreshing numbers.
const titledRows=numericRows.map((r,i)=>({...r,title:`Verified ${r.alias}`,status:'classified',detailTags:['retained-tag']}));
const titledRaw=JSON.stringify(titledRows);
const titledReview={...inspectRating(numericCatalog,titledRows),source_sha256:sha256(titledRaw),review:ratingReview.review};
const titledEnriched=applyRating(numericCatalog,titledReview);
const titleLost=refreshRatingMetadata(titledEnriched,titledRaw,JSON.stringify(titledRows.map(r=>({...r,title:null}))),[titledReview]);
assert.deepEqual(titleLost.catalog.problems.map(p=>p.tags),titledEnriched.problems.map(p=>p.tags));
assert.equal(titleLost.report.tag_changes.length,0);
const populatedNumeric=structuredClone(numericEnriched);populatedNumeric.problems[0].rating=999;
assert.equal(enrichReviewedRatings(populatedNumeric,numericRaw,numericReview).problems[0].rating,999,'Provider-ID numeric enrichment must not overwrite existing values');
assert.ok(numericEnriched.problems.every(p=>p.sources.filter(s=>s.provider==='xcpc_rating').every(s=>s.source_title===undefined)));
for(const mutate of [
  c=>{c.contests[0].sources=[];},
  c=>{c.contests[0].sources[0].provider_contest_id='srk:official/icpc/wrong.srk.json';},
  c=>{c.contests[0].startAt=null;},
  c=>{c.contests[0].startAt='2020-01-02T01:00:00.000Z';},
]) { const changed=structuredClone(numericCatalog);mutate(changed);assert.equal(inspectRating(changed,numericRows).matches.length,0); }
for(const mutate of [
  rows=>{rows.pop();},
  rows=>{rows[1].problemUrl=rows[0].problemUrl;},
  rows=>{rows[1].alias=rows[0].alias;},
  rows=>{rows[1].title='Conflicting known title';},
  rows=>{rows[1].startAt='2020-01-02T09:00:00+08:00';},
]) { const changed=structuredClone(numericRows);mutate(changed);assert.equal(inspectRating(numericCatalog,changed).matches.length,0); }
const staleNumeric=structuredClone(numericEnriched);staleNumeric.contests[0].sources=[];
assert.throws(()=>enrichReviewedRatings(staleNumeric,numericRaw,numericReview),/evidence changed/);
const previousRows=fixture.input.map(r=>({...r,detailTags:['old','keep'],problemRating:1000}));
const previousRaw=JSON.stringify(previousRows),previousReport=inspectRating(fixture.catalog,previousRows);
const previousReview={...previousReport,source_sha256:sha256(previousRaw),review:ratingReview.review};
const owned=applyRating(fixture.catalog,previousReport);owned.problems[0].rating=1000;owned.problems[0].tags.push('manual');
const nextRows=previousRows.map(r=>({...r,detailTags:['keep','new'],problemRating:1100}));
let refreshed=refreshRatingMetadata(owned,previousRaw,JSON.stringify(nextRows),[previousReview]);
assert.equal(refreshed.catalog.problems[0].rating,1100);
assert.deepEqual(refreshed.catalog.problems[0].tags,['keep','manual','new']);
assert.deepEqual(refreshed.report.tag_changes[0].removed,['old']);
assert.equal(refreshed.report.rating_changes[0].action,'increase');
const previousRefresh={...refreshed.report,review:ratingReview.review,applied_at:'2026-10-01T00:00:00Z',output_catalog_sha256:sha256(JSON.stringify(refreshed.catalog))};
const nextRefresh=refreshRatingMetadata(refreshed.catalog,JSON.stringify(nextRows),JSON.stringify(nextRows.map(r=>({...r,problemRating:1150,detailTags:['next']}))),[previousRefresh]);
assert.equal(nextRefresh.catalog.problems[0].rating,1150);
assert.deepEqual(nextRefresh.catalog.problems[0].tags,['manual','next']);
assert.throws(()=>refreshRatingMetadata(refreshed.catalog,JSON.stringify(nextRows),JSON.stringify(nextRows),[{...previousRefresh,applied_at:undefined}]),/applied receipt/);

refreshed=refreshRatingMetadata(owned,previousRaw,JSON.stringify(nextRows.map(r=>({...r,problemRating:900}))),[previousReview]);
assert.equal(refreshed.catalog.problems[0].rating,900);assert.equal(refreshed.report.rating_changes[0].action,'decrease');
const unknownRows=nextRows.map(r=>({...r,status:'unknown',detailTags:[],problemRating:null}));
refreshed=refreshRatingMetadata(owned,previousRaw,JSON.stringify(unknownRows),[previousReview]);
assert.equal(refreshed.catalog.problems[0].rating,1000);assert.deepEqual(refreshed.catalog.problems[0].tags,owned.problems[0].tags);
const manualRating=structuredClone(owned);manualRating.problems[0].rating=777;
assert.equal(refreshRatingMetadata(manualRating,previousRaw,JSON.stringify(nextRows),[previousReview]).catalog.problems[0].rating,777);
const conflictRows=[...nextRows,{...nextRows[0],contestSlug:'other_source',problemRating:1200}];
refreshed=refreshRatingMetadata(owned,previousRaw,JSON.stringify(conflictRows),[previousReview]);
assert.equal(refreshed.catalog.problems[0].rating,undefined);assert.equal(refreshed.report.rating_changes[0].action,'withdraw_conflict');
refreshed=refreshRatingMetadata(owned,previousRaw,'[]',[previousReview]);
assert.deepEqual(refreshed.catalog.problems[0].tags,owned.problems[0].tags);assert.equal(refreshed.catalog.problems[0].rating,1000);
const linked=structuredClone(owned);
linked.problems[0].sources.push({provider:'qoj',kind:'problem',url:'https://qoj.ac/problem/42',provider_problem_id:'42'});
linked.contests.push({contestId:'peer',title:'Another event',problemIds:['peer:A'],sources:[]});
linked.problems.push({problemId:'peer:A',contestId:'peer',ordinal:'A',title:'Example',aliases:[],sources:[{provider:'qoj',kind:'problem',url:'https://qoj.ac/problem/42',provider_problem_id:'42'}]});
const linkedRows=[...previousRows,{...previousRows[0],contestSlug:'another_event',problemUrl:'https://qoj.ac/problem/42',problemRating:1200}];
refreshed=refreshRatingMetadata(linked,previousRaw,JSON.stringify(linkedRows),[previousReview]);
assert.equal(refreshed.catalog.problems[0].rating,undefined);
assert.equal(refreshed.catalog.problems[1].rating,1200,'Do not expand ownership through a transitive join; retain this entity\'s directly reviewed source');
assert.equal(refreshed.report.conflicts.length,1);assert.equal(refreshed.report.linked_identity_differences.length,1);
const conflict = structuredClone(fixture.input); conflict[0].title = 'Different problem';
assert.equal(inspectRating(fixture.catalog, conflict).matches.length, 0);
assert.equal(inspectRating(fixture.catalog, conflict).unresolved.length, 1);
assert.equal(problemIdentity('javascript:alert(1)'), null);
assert.equal(problemIdentity('https://codeforces.com.evil.test/gym/100000/problem/A'), null);
assert.equal(problemIdentity('https://qoj.ac/contest/2/problem/123'), 'qoj:123');

const srk = await readJson('fixtures/imports/rankland/srk-supported.json');
const awards = calculateAwards(srk);
assert.equal(awards.status, 'proposed');
assert.equal(awards.eligible_team_count, 4);
assert.deepEqual(awards.cutoffs.gold, {rank: 1, teamId: 'gold', solved: 3, penalty: 1});
assert.equal(minutes([60000, 'ms']), 1);
assert.equal(minutes([1, 'h']), 60);
assert.throws(() => minutes([1, 'unknown']));
for (const mutate of [
  s => { s.version = '99.0.0'; },
  s => { s.contest.frozenDuration = [1, 'h']; s.rows[0].statuses[0].result='?'; },
  s => { s.contest.startAt='2999-01-01T00:00:00Z'; },
  s => { delete s.rows[0].user.official; },
  s => { s.rows[0].statuses = []; },
  s => { s.rows[0].statuses[0].result = 'PENDING'; },
  s => { s.rows[0].statuses[0].result = 'UNRECOGNIZED'; },
  s => { s.series[0].rule.options.count.value = [0, 0, 0]; },
  s => { s.series[0].rule.options.ratio = {value: [0.1, 0.2, 0.3]}; },
  s => { s.rows[2].score = structuredClone(s.rows[1].score); },
  s => { s.series.push(structuredClone(s.series[0])); },
]) { const changed = structuredClone(srk); mutate(changed); assert.equal(calculateAwards(changed).status, 'blocked'); }
const historicalFreeze=structuredClone(srk);
historicalFreeze.contest.frozenDuration=[1,'h'];
assert.equal(calculateAwards(historicalFreeze).status,'proposed');
delete historicalFreeze.contest.frozenDuration;
assert.equal(calculateAwards(historicalFreeze).status,'proposed');
const grouped = structuredClone(srk);
const ratioFixture=structuredClone(srk);
ratioFixture.series[0].rule.options={ratio:{value:[.1,.2,.3]}};
ratioFixture.rows=Array.from({length:10},(_,i)=>({...structuredClone(srk.rows[0]),user:{id:String(i),official:true},score:{value:srk.rows[0].score.value,time:[i+1,'min']}}));
ratioFixture.rows.push({...structuredClone(ratioFixture.rows[0]),user:{id:'guest',official:false}});
let ratioAwards=calculateAwards(ratioFixture);
assert.equal(ratioAwards.eligible_team_count,10);
assert.deepEqual(Object.values(ratioAwards.cutoffs).map(c=>c.rank),[1,3,6]);
ratioFixture.rows.push({...structuredClone(ratioFixture.rows[0]),user:{id:'eleventh',official:true},score:{value:srk.rows[0].score.value,time:[11,'min']}});
assert.deepEqual(Object.values(calculateAwards(ratioFixture).cutoffs).map(c=>c.rank),[2,4,7]);
ratioFixture.series[0].rule.options.ratio.rounding='floor';
assert.deepEqual(Object.values(calculateAwards(ratioFixture).cutoffs).map(c=>c.rank),[1,3,6]);
ratioFixture.series[0].rule.options.ratio.denominator='submitted';
assert.equal(calculateAwards(ratioFixture).status,'blocked');
const scoredRatio=structuredClone(ratioFixture);
scoredRatio.series[0].rule.options.ratio.denominator='scored';
scoredRatio.series[0].rule.options.ratio.rounding='ceil';
for(const [i,row]of scoredRatio.rows.entries())if(i>=6){row.score.value=0;row.score.time=[0,'min'];row.statuses=row.statuses.map(()=>({}));}
const scoredResult=calculateAwards(scoredRatio);
assert.equal(scoredResult.status,'proposed');
assert.equal(scoredResult.eligible_team_count,11);
assert.equal(scoredResult.evidence.ratio_denominator_count,6);
assert.deepEqual(Object.values(scoredResult.cutoffs).map(c=>c.rank),[1,2,4]);
for(const row of scoredRatio.rows){row.score.value=0;row.statuses=row.statuses.map(()=>({}));}
assert.equal(calculateAwards(scoredRatio).status,'blocked');
grouped.series[0].rule.options.filter = {byMarker: 'invitational'};
assert.equal(calculateAwards(grouped).status, 'blocked');
assert.equal(calculateAwards(grouped, 'invitational').eligible_team_count, 3);
assert.equal(calculateAwards(grouped, 'missing').status, 'blocked');

const indexText = 'root:\n  children:\n    - path: test\n      name: Test\n      children:\n        - path: example\n          name: Synthetic final\n          format: srk.json\n';
const index = parseIndex(indexText)[0];
assert.equal(index.srk_path, 'official/test/example.srk.json');
const collection = {success: true, data: {content: {root: {children: [{name: 'Test', type: 2, children: [{name: 'Synthetic final', type: 1, uniqueKey: 'different-database-key'}]}]}}}};
const info = {success: true, data: {uk: 'different-database-key', srkFileID: '1', name: 'Synthetic final', startAt: srk.contest.startAt}};
const page = verifyPage(index, collection, info, srk);
assert.ok(page.endsWith('rankId=different-database-key'));
assert.throws(() => verifyPage(index, collection, {...info, data: {...info.data, uk: 'example'}}, srk));
const cache = await mkdtemp(join(tmpdir(), 'xcpc-source-test-'));
await atomicJson(join(cache, index.srk_path), srk);
await atomicJson(join(cache, `${index.srk_path}.info.json`), info);
await atomicJson(join(cache, 'collection.json'), collection);
// This file is a generated test fixture, not canonical repository content.
const {writeFile} = await import('node:fs/promises');
await writeFile(join(cache, 'config.yaml'), indexText);
const {SRK_COMMIT} = await import('./import-rankland-standings.mjs');
const catalog = {schemaVersion: 1, exportKind: 'local_catalog_snapshot', version: '0.6.0', contests: [{contestId:'c',title:'Synthetic final',aliases:[],tags:[],curationStatus:'problem_listed',problemIds:['c:A','c:B','c:C'],sources:[]}], problems: ['A','B','C'].map(ordinal=>({problemId:`c:${ordinal}`,contestId:'c',ordinal,title:ordinal,aliases:[],sources:[]}))};
const reviewMeta = {reviewed_by:'automated synthetic test',reviewed_at:'2026-09-14T00:00:00Z',reason:'synthetic regression'};
const source = {provider:'rankland',collection:'official',provider_contest_id:`srk:${index.srk_path}`,srk_path:index.srk_path,repository_url:'https://github.com/algoux/srk-collection',commit_sha:SRK_COMMIT,content_sha256:sha256(await readFile(join(cache,index.srk_path))),index_sha256:sha256(indexText),srk_version:srk.version,fetched_at:reviewMeta.reviewed_at,page_url:page,page_verified_at:reviewMeta.reviewed_at,source_title:'Synthetic final',attribution:{name:'synthetic',license_url:'https://example.com/license'}};
const mapping = {schema_version:1,export_kind:'rankland_mapping_review',synthetic:false,catalog_sha256:sha256(JSON.stringify(catalog)),entries:[{entry_id:'test',status:'approved',source,candidate_contest_ids:['c'],evidence:['synthetic'],selection:{contest_id:'c',make_default:true},review:reviewMeta}]};
const awardReview = {schema_version:1,export_kind:'rankland_award_review',synthetic:false,catalog_sha256:mapping.catalog_sha256,entries:[{entry_id:'award',mapping_entry_id:'test',contest_id:'c',source_content_sha256:source.content_sha256,status:'approved',reason:'synthetic',result:awardResult(srk,awards),review:reviewMeta}]};
const migrated = await applyRankland(catalog,mapping,cache,awardReview);
assert.deepEqual(await applyRankland(migrated,mapping,cache,awardReview),migrated);
await validateSnapshot(migrated);
assert.equal(migrated.contests[0].awardCutoffs.cutoffs.gold.penalty,1);
await assert.rejects(applyRankland(catalog,{...mapping,synthetic:true},cache,awardReview));
const stale = structuredClone(mapping);stale.entries[0].source.content_sha256='0'.repeat(64);
await assert.rejects(applyRankland(catalog,stale,cache,awardReview));
const badAward = structuredClone(awardReview);badAward.entries[0].result.cutoffs.gold.solved=1;
await assert.rejects(applyRankland(catalog,mapping,cache,badAward));
const badCatalog = structuredClone(migrated);badCatalog.problems[0].tags='not an array';
await assert.rejects(validateSnapshot(badCatalog));
const duplicate = structuredClone(migrated);duplicate.contests[0].sources.push({...duplicate.contests[0].sources[0]});
await assert.rejects(validateSnapshot(duplicate));
await validateSchema('rankland-review', mapping);
await validateSchema('rankland-award-review', awardReview);
console.log('Source imports: verified matching, conflicts, groups, awards, schema, provenance, stale input rejection and idempotence.');

// Verify actual release review contracts and their published outcomes without fetching upstream.
const publishedMapping = await readJson('fixtures/imports/rankland/2026-09-review.json');
const publishedAwards = await readJson('fixtures/imports/rankland/2026-09-awards.json');
await validateSchema('rankland-review', publishedMapping);
await validateSchema('rankland-award-review', publishedAwards);
const published = await readJson('catalog/default-catalog.min.json');
const completion = await readJson('fixtures/imports/rankland/2026-10-01-completion.json');
for (const entry of publishedMapping.entries.filter(e => e.status === 'approved')) {
  const c = published.contests.find(c => c.contestId === entry.selection.contest_id);
  assert.ok(c.sources.some(s => s.provider === 'rankland' && s.provider_contest_id === entry.source.provider_contest_id && s.url === entry.source.page_url));
}
for (const entry of publishedAwards.entries.filter(e => e.status === 'approved')) {
  const c = published.contests.find(c => c.contestId === entry.contest_id);
  assert.equal(c.awardCutoffs.sourceProvider, 'rankland');
  for (const medal of ['gold','silver','bronze']) {
    const actual = c.awardCutoffs.cutoffs[medal], expected = entry.result.cutoffs[medal];
    assert.deepEqual({rank:actual.rank,solved:actual.solved,penalty:actual.penalty,team_id:actual.teamId},expected);
  }
}
const receipt = await readJson('fixtures/imports/rankland/2026-09-receipt.json');
for (const fix of receipt.corrections) {
  const c = published.contests.find(c => c.contestId === fix.contest_id);
  assert.ok(fix.removed_sources.every(s => !c.sources.some(t => s.url === t.url)));
}
const auditedIds = new Set((await readJson('fixtures/imports/rankland/2026-09-audit.json')).catalog_status.map(c => c.contest_id));
assert.equal(auditedIds.size,receipt.contest_count);
for (const id of auditedIds) assert.ok(published.contests.some(c => c.contestId === id), 'Previously audited contest must remain in catalog');
console.log('Published RankLand review contracts, award values, corrections and full-catalog dispositions verified.');
const refresh=await readJson('fixtures/imports/rankland/2026-09-17-refresh.json');
assert.match(refresh.commit_sha,/^[a-f0-9]{40}$/);
assert.equal(new Set(refresh.changes.map(c=>c.contest_id)).size,refresh.changes.length);
for(const change of refresh.changes) {
  const c=published.contests.find(c=>c.contestId===change.contest_id);
  assert.deepEqual(c[change.field],latestAwardValue(change.contest_id,change.field,change.value));
  assert.match(change.source_sha256,/^[a-f0-9]{64}$/);
  assert.ok(c.sources.some(s=>s.provider==='rankland'&&s.url===change.value.sourceUrl));
  assert.equal(change.evidence.ties,'No tied medal boundary');
}
console.log('Refreshed cutoff receipts match published catalog and verified source mappings.');
const ratios=await readJson('fixtures/imports/rankland/2026-09-17-official-ratios.json');
assert.equal(ratios.changes.length,2);
for(const change of ratios.changes) {
  assert.equal(change.value.source,'explicit');
  assert.deepEqual(published.contests.find(c=>c.contestId===change.contest_id).awardCutoffs,change.value);
  assert.deepEqual(change.evidence.official_ratio.value,[.1,.2,.3]);
}
const eligibility=await readJson('fixtures/imports/rankland/2026-09-17-estimate-eligibility.json');
const replacements=await readJson('fixtures/imports/rankland/2026-09-17-verified-replacements.json');
const highest=await readJson('fixtures/imports/rankland/2026-09-17-highest-group-audit.json');
const highestReplacement=await readJson('fixtures/imports/rankland/2026-09-17-highest-group-replacement.json');
assert.equal(highest.removed.length,7);
assert.equal(highestReplacement.changes.length,1);
for(const change of highestReplacement.changes)assert.deepEqual(published.contests.find(c=>c.contestId===change.contest_id)[change.field],latestAwardValue(change.contest_id,change.field,change.value));
for(const row of highest.removed)assert.notDeepEqual(published.contests.find(c=>c.contestId===row.contest_id)[row.field],row.value);
assert.equal(replacements.changes.length,3);
for(const r of replacements.changes) {
  assert.equal(r.value.sourceProvider,'rankland');
  assert.deepEqual(published.contests.find(c=>c.contestId===r.contest_id)[r.field],latestAwardValue(r.contest_id,r.field,r.value));
  assert.equal(r.evidence.ties,'No tied medal boundary');
}
assert.equal(eligibility.removed.length,13);
for(const row of eligibility.removed)assert.notDeepEqual(published.contests.find(c=>c.contestId===row.contest_id)[row.field],row.value);
for(const c of published.contests)for(const field of ['awardCutoffs','estimatedAwardCutoffs']) {
  const value=c[field];if(!value || value.source==='explicit')continue;
  assert.equal(value.source,'inferred_official_medal_ratio_10_20_30');
  assert.notEqual(value.sourceProvider,'codeforces');
  const row=stage2AwardReview.verified.find(r=>r.contest_id===c.contestId && r.field===field)??completion.verified.find(r=>r.contest_id===c.contestId && r.field===field);
  assert.ok(row,'Every remaining estimate needs official-team eligibility evidence');
  assert.deepEqual(value,row.value);
  assert.equal(row.evidence.ties,'No tied medal boundary');
  const counts=[.1,.2,.3].map(r=>Math.floor(value.eligibleTeamCount*r));
  assert.deepEqual(Object.values(value.cutoffs).map(c=>c?.rank),counts.map((_,i)=>counts.slice(0,i+1).reduce((sum,n)=>sum+n,0)));
}
console.log('Official ratio rounding and all retained estimate eligibility verified.');
await import('./validate-catalog-completion.mjs');
await import('./validate-cf-metadata-refresh.mjs');
await import('./validate-codeforces-catalog-repairs.mjs');
await import('./validate-codeforces-import-safety.mjs');
