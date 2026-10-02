import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from './source-import-lib.mjs';
import { loadModule } from './validate-coverage.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const dir = 'fixtures/imports/codeforces/';
const rawBytes = readFileSync(`${dir}2026-10-02-user-export.json`);
const raw = JSON.parse(rawBytes);
const review = read(`${dir}2026-10-02-mapping-review.json`);
const input = read(`${dir}2026-10-02-reviewed-problem-lists.json`);
const catalog = read('catalog/default-catalog.min.json');
assert.equal(sha256(rawBytes), review.user_export_sha256);
assert.deepEqual(raw.summary, { requested: 3, succeeded: 2, failed: 1, unattempted: 0, problems: 25 });
assert.deepEqual(raw.failures, [{id:695551,code:'target_unavailable',stopped_batch:false}]);
assert.equal(input.length, 2);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
for (const contest of raw.contests) {
  assert.equal(sha256(JSON.stringify(canonical({contest:contest.api_contest,problems:contest.problems}))), contest.provenance.metadata_sha256);
  const reviewed = input.find(c => c.url === contest.url);
  assert.deepEqual(reviewed.problems, contest.problems.map(({ordinal,title,url,provider_problem_id}) => ({ordinal,title,url,provider_problem_id})));
}
const problems = new Map(catalog.problems.map(p => [p.problemId,p]));
for (const row of review.mapping) {
  const problem = problems.get(row.canonical_problem_id);
  assert.equal(problem.title,row.title);
  assert.equal(problem.ordinal,row.original_ordinal);
  assert.ok(problem.sources.some(s=>s.provider==='qoj'&&s.provider_problem_id===row.qoj_problem_id));
  assert.deepEqual(problem.sources.filter(s=>s.provider==='codeforces').map(s=>s.provider_problem_id),row.current_cf_problem_id?[row.current_cf_problem_id]:[]);
}
for (const after of review.after_problems) assert.deepEqual(problems.get(after.problemId),after);
assert.ok(!problems.get(review.mapping_correction.from_problem_id).aliases.includes('Ants'));
assert.equal(catalog.contests.find(c=>c.contestId==='8bd18c44-77b5-5f30-938a-83d2fe690a46').problemIds.length,13);
assert.ok(!catalog.contests.some(c=>c.sources.some(s=>s.provider_contest_id==='695551')));

// A stale ordinal association or changed upstream identity must stop atomically.
const temp=mkdtempSync(join(tmpdir(),'xcpc-cf-review-'));
const catPath=join(temp,'catalog.json'); const inputPath=join(temp,'input.json');
const invoke=()=>execFileSync(process.execPath,['scripts/import-codeforces-problems-export.mjs',inputPath,catPath,catPath],{stdio:'pipe'});
const stale=structuredClone(catalog);
for(const before of review.before_problems)stale.problems[stale.problems.findIndex(p=>p.problemId===before.problemId)]=before;
writeFileSync(catPath,JSON.stringify(stale));writeFileSync(inputPath,JSON.stringify(input));
const beforeBytes=readFileSync(catPath,'utf8');assert.throws(invoke,/source correction/);assert.equal(readFileSync(catPath,'utf8'),beforeBytes);
const changed=structuredClone(input);changed[0].problems.find(p=>p.provider_problem_id==='103117:C').title='Triangle Pendant';
writeFileSync(catPath,JSON.stringify(catalog));writeFileSync(inputPath,JSON.stringify(changed));
const correctedBytes=readFileSync(catPath,'utf8');assert.throws(invoke,/identity changed/);assert.equal(readFileSync(catPath,'utf8'),correctedBytes);

// Legacy cache refresh must not invent missing provider identities from ordinals.
const sc=catalog.contests.find(c=>c.contestId==='8bd18c44-77b5-5f30-938a-83d2fe690a46');
let cached;
const detail={id:sc.contestId,title:sc.title,aliases:sc.aliases,tags:sc.tags,curation_status:sc.curationStatus,sources:sc.sources,problems:sc.problemIds.map(id=>{const p=problems.get(id);return {...p,id:p.problemId};})};
const cache=loadModule('web/src/lib/catalog-cache.ts',{'./catalog':{fetchGeneratedCatalogBundle:async()=>({generated_at:'test',source:'test',contest_count:1,contests:[detail]})},'./local-db':{refreshGeneratedCatalogSnapshot:async value=>{cached=value;}}});
await cache.refreshCatalogCache();
assert.ok(cached.problems.find(p=>p.ordinal==='C').sources.every(s=>s.provider!=='codeforces'));
assert.equal(cached.problems.find(p=>p.ordinal==='J').sources.find(s=>s.provider==='codeforces').provider_problem_id,'103117:C');

const gz=read('fixtures/imports/rankland/2026-10-02-guizhou-review.json');
const rating=read('fixtures/imports/xcpc-rating/2026-10-02-guizhou-review.json');
const contest=catalog.contests.find(c=>c.contestId===gz.contest_id);
assert.equal(contest.startAt,gz.startAt);assert.equal(contest.problemIds.length,13);
assert.deepEqual(contest.awardCutoffs,gz.value);
assert.equal(gz.teams.length,116);
assert.equal(gz.teams.filter(t=>t.official===false).length,17);
assert.equal(gz.teams.filter(t=>t.official_field_absent).length,99);
const eligible=gz.teams.filter(t=>t.official===true||(t.official_field_absent&&t.official===null)).sort((a,b)=>b.solved-a.solved||a.penalty-b.penalty);
assert.equal(eligible.length,99);
for(const team of gz.teams){assert.equal(team.problem_cells,13);assert.equal(team.penalty_unit,'min');assert.equal(team.pending,0);}
for(const [medal,rank] of Object.entries({gold:9,silver:26,bronze:52})){
  const row=eligible[rank-1],next=eligible[rank];
  assert.deepEqual(gz.value.cutoffs[medal],{rank,teamId:row.team_id,solved:row.solved,penalty:row.penalty});
  assert.ok(!next||row.solved!==next.solved||row.penalty!==next.penalty);
}
assert.equal(rating.matches.length,13);assert.equal(rating.values.length,13);
for(const row of rating.values){const p=problems.get(row.problem_id);assert.equal(p.title,row.title);assert.equal(p.rating,row.value);assert.ok(p.sources.some(s=>s.provider==='xcpc_rating'&&s.provider_problem_id===row.source_identity));assert.deepEqual(p.tags,[]);}
assert.equal(new Set(gz.correspondence.map(r=>r.ordinal)).size,13);
for(const row of gz.correspondence){assert.equal(row.cf_title,row.srk_title);assert.equal(row.cf_title,row.rating_title);assert.ok(rating.values.some(v=>v.title===row.cf_title&&v.value===row.problemRating));}
console.log('CF metadata refresh: authenticated export hashes, original identities, source correction, no ordinal fallback, explicit Guizhou eligibility and ratings verified.');
