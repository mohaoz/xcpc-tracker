import assert from 'node:assert/strict';
import { readJson, normalizeTitle, problemIdentity } from './source-import-lib.mjs';
import {latestAwardValue,stage2AwardReview} from './catalog-award-review.mjs';

const catalog=await readJson('catalog/default-catalog.min.json');
const review=await readJson('fixtures/imports/rankland/2026-10-01-completion.json');
const rating=await readJson('fixtures/imports/xcpc-rating/2026-10-01-review.json');
const ratingRefresh=await readJson('fixtures/imports/xcpc-rating/2026-10-01-full-refresh.json');
const latestRating=(id,value)=>{const row=ratingRefresh.rating_changes.find(r=>r.problem_id===id);return row?row.value??undefined:value;};
const contests=new Map(catalog.contests.map(c=>[c.contestId,c]));
const problems=new Map(catalog.problems.map(p=>[p.problemId,p]));
assert.equal(review.schema_version,1);
assert.match(review.input_catalog_sha256,/^[a-f0-9]{64}$/);
assert.match(review.srk_commit_sha,/^[a-f0-9]{40}$/);
assert.ok(Number.isFinite(Date.parse(review.reviewed_at)));
const key=r=>`${r.contest_id}:${r.field}`;
for(const rows of [review.changes,review.removed,review.verified,review.date_changes])assert.equal(new Set(rows.map(key)).size,rows.length,'Duplicate completion decision');
const hashes=new Set(review.source_files.map(f=>f.sha256));
for(const file of review.source_files) {
  assert.match(file.sha256,/^[a-f0-9]{64}$/);
  assert.ok(file.url.startsWith('https://'));
}
for(const row of review.changes) {
  assert.ok(['awardCutoffs','estimatedAwardCutoffs'].includes(row.field));
  assert.ok(hashes.has(row.source_sha256),'Changed awards need archived source hash');
  const contest=contests.get(row.contest_id);
  assert.ok(contest);
  assert.deepEqual(contest[row.field],latestAwardValue(row.contest_id,row.field,row.value));
  assert.notDeepEqual(row.value,row.previous_value);
  assert.ok(contest.sources.some(s=>s.kind==='standings'&&s.provider===row.value.sourceProvider&&s.url===row.value.sourceUrl));
}
for(const row of review.removed) {
  assert.equal(row.previous_value.source,'inferred_official_medal_ratio_10_20_30');
  assert.ok(row.reason);
  const replacement=review.changes.find(r=>key(r)===key(row));
  assert.deepEqual(contests.get(row.contest_id)[row.field],latestAwardValue(row.contest_id,row.field,replacement?.value));
}
for(const row of review.source_changes) {
  const contest=contests.get(row.contest_id);
  assert.ok(contest);
  assert.ok(contest.sources.some(s=>JSON.stringify(s)===JSON.stringify(row.source)));
  assert.ok(hashes.has(row.source_sha256));
  for(const alias of row.aliases??[])assert.ok(contest.title===alias||contest.aliases.includes(alias));
}
for(const row of review.date_changes) {
  assert.equal(row.previous_value,null,'Date fill must not overwrite an existing date');
  assert.equal(contests.get(row.contest_id).startAt,row.value);
  assert.equal(new Date(row.evidence.source_startAt).toISOString(),row.value);
  assert.ok(hashes.has(row.source_sha256));
}
for(const contest of catalog.contests)assert.ok(contest.sources.filter(s=>s.is_default).length<=1,'Only one explicit default standings source');

// Metadata is a separate reviewed problem-level enrichment, never a member-status import.
assert.equal(rating.review.status,'approved');
assert.match(rating.source_sha256,/^[a-f0-9]{64}$/);
for(const match of rating.matches) {
  const problem=problems.get(match.problem_id);
  assert.ok(problem);
  assert.ok([problem.title,...(problem.aliases??[]),...problem.sources.map(s=>s.source_title)].some(t=>normalizeTitle(t)===normalizeTitle(match.title)));
  assert.ok(problem.sources.some(s=>s.provider==='xcpc_rating'&&s.provider_problem_id===`${match.contest_slug}:${match.ordinal}`));
  for(const tag of match.tags)assert.ok(problem.tags.includes(tag)||ratingRefresh.tag_changes.some(r=>r.problem_id===problem.problemId&&r.removed.includes(tag)));
}
const values=await readJson('fixtures/imports/xcpc-rating/2026-10-01-rating-values.json');
assert.equal(values.source_sha256,rating.source_sha256);
for(const row of values.added) {
  assert.equal(row.previous_value,null);
  assert.ok(Number.isFinite(row.value)&&row.value>=0);
  assert.equal(problems.get(row.problem_id).rating,latestRating(row.problem_id,row.value));
  assert.deepEqual([...new Set(row.sources.map(s=>s.value))],[row.value]);
  for(const source of row.sources)assert.ok(rating.matches.some(m=>m.problem_id===row.problem_id&&`${m.contest_slug}:${m.ordinal}`===source.source_identity));
}
for(const row of values.conflicts) {
  assert.ok(new Set(row.sources.map(s=>s.value)).size>1);
  assert.equal(problems.get(row.problem_id).rating,undefined,'Conflicting ratings must not be guessed');
}
const numericReview=await readJson('fixtures/imports/xcpc-rating/2026-10-01-numeric-identity-review.json');
const numericValues=await readJson('fixtures/imports/xcpc-rating/2026-10-01-numeric-identity-values.json');
assert.equal(numericReview.review.status,'approved');
assert.equal(numericValues.source_sha256,numericReview.source_sha256);
assert.equal(numericValues.input_catalog_sha256,numericReview.catalog_sha256);
assert.equal(numericValues.changes.length,205);
for(const row of numericValues.changes) {
  assert.equal(row.previous_value,null);
  assert.ok(Number.isFinite(row.value)&&row.value>=0);
  const problem=problems.get(row.problem_id),contest=contests.get(row.contest_id);
  assert.equal(problem.contestId,contest.contestId);
  assert.equal(problem.rating,latestRating(row.problem_id,row.value));
  assert.deepEqual([...new Set(row.sources.map(s=>s.value))],[row.value]);
  for(const source of row.sources) {
    const match=numericReview.matches.find(m=>m.problem_id===row.problem_id&&`${m.contest_slug}:${m.ordinal}`===source.source_identity);
    assert.equal(match?.evidence,'complete_provider_ids_and_verified_original_contest');
    assert.ok(contest.sources.some(s=>s.provider==='rankland'&&s.kind==='standings'&&s.provider_contest_id===source.original_source_id));
    assert.equal(Date.parse(contest.startAt),Date.parse(source.original_start_at));
    assert.ok(problem.sources.some(s=>problemIdentity(s.url)&&problemIdentity(s.url)===problemIdentity(source.provider_problem_url)));
    const metadata=problem.sources.find(s=>s.provider==='xcpc_rating'&&s.provider_problem_id===source.source_identity);
    assert.ok(metadata);assert.equal(metadata.source_title,undefined,'Do not manufacture missing upstream titles');
    const full=numericReview.matches.filter(m=>m.contest_slug===match.contest_slug&&problems.get(m.problem_id)?.contestId===contest.contestId);
    assert.equal(new Set(full.map(m=>m.problem_id)).size,contest.problemIds.length);
    assert.equal(new Set(full.map(m=>problemIdentity(m.problem_url))).size,contest.problemIds.length);
  }
}
const cf=await readJson('fixtures/imports/codeforces/2026-10-01-problem-lists.json');
assert.equal(cf.length,4);
assert.equal(cf.reduce((sum,c)=>sum+c.problems.length,0),49);
assert.deepEqual(problems.get('ea3a1d82-1043-5335-9e46-965624960072:B').aliases,['Beats']);
console.log(`Catalog completion: ${review.source_changes.length} source additions, ${review.changes.length} cutoff changes, ${review.removed.length} superseded/withdrawn fields and ${review.date_changes.length} date fills match reviewed evidence.`);

assert.equal(ratingRefresh.review.status,'approved');
assert.match(ratingRefresh.source_sha256,/^[a-f0-9]{64}$/);
assert.match(ratingRefresh.previous_source_sha256,/^[a-f0-9]{64}$/);
assert.ok(Number.isFinite(Date.parse(ratingRefresh.applied_at)));
for(const row of ratingRefresh.tag_changes) {
  assert.deepEqual(problems.get(row.problem_id).tags,row.value);
  assert.deepEqual(row.previous_value.filter(t=>!row.value.includes(t)),row.removed);
  assert.deepEqual(row.value.filter(t=>!row.previous_value.includes(t)),row.added);
  for(const removed of row.removal_ownership) {
    assert.ok(removed.source_identities.length>0);
    for(const owner of removed.source_identities)assert.ok(ratingRefresh.inspected.matches.some(m=>m.problem_id===row.problem_id&&`${m.contest_slug}:${m.ordinal}`===owner&&m.status==='classified'&&m.evidence!=='complete_provider_ids_and_verified_original_contest'&&!m.tags.includes(removed.tag)));
  }
  for(const tag of row.preserved_other_tags)assert.ok(row.value.includes(tag));
}
for(const row of ratingRefresh.rating_changes) {
  assert.equal(problems.get(row.problem_id).rating,row.value??undefined);
  if(row.action==='withdraw_conflict'){assert.ok(new Set(row.sources.map(s=>s.value)).size>1);assert.ok(row.previous_evidence.some(s=>s.value===row.previous_value));}
  else {assert.ok(Number.isFinite(row.value));assert.deepEqual([...new Set(row.sources.map(s=>s.value))],[row.value]);}
}
console.log('Full Rating refresh: source-owned replacement/removal receipts, preserved manual tags and direct-source numeric conflicts verified.');

// Later factual source additions keep their historical receipts, with the latest
// reviewed value taking precedence rather than erasing earlier evidence.
for(const row of stage2AwardReview.changes)assert.deepEqual(contests.get(row.contest_id)[row.field],latestAwardValue(row.contest_id,row.field,row.value));
for(const row of stage2AwardReview.removed)assert.deepEqual(contests.get(row.contest_id)[row.field],latestAwardValue(row.contest_id,row.field,undefined));
const official=await readJson('fixtures/imports/additional-sources/2026-10-01-official-awards.json');
const wf=official.wf2018;
assert.equal(wf.eligibleRows.length,140);
assert.deepEqual(wf.reviewEvidence.medalCounts,{gold:4,silver:4,bronze:5});
for(const row of wf.eligibleRows) {
  const accepted=row.problems.filter(p=>p.status==='accepted');
  assert.equal(accepted.length,row.solved);
  assert.equal(accepted.reduce((sum,p)=>sum+p.acceptedAtMinutes+20*(p.tries-1),0),row.penalty);
}
for(const [medal,cutoff]of Object.entries(wf.proposedAwardCutoffs.cutoffs)) {
  const boundary=wf.eligibleRows[cutoff.rank-1],next=wf.eligibleRows[cutoff.rank];
  assert.equal(boundary.teamId,cutoff.teamId);assert.equal(boundary.solved,cutoff.solved);assert.equal(boundary.penalty,cutoff.penalty);
  assert.ok(!next||boundary.solved!==next.solved||boundary.penalty!==next.penalty);
  assert.equal(wf.awardedRows.filter(r=>r.medal===medal).length,wf.reviewEvidence.medalCounts[medal]);
}
assert.equal(contests.get('78427c9a-afa5-504f-a09d-576afe16f691').awardCutoffs,undefined,'School-ranked Final2020 cannot regain a generic team-ratio cutoff');
const presets=await readJson('fixtures/imports/additional-sources/2026-10-01-ccpc-presets.json');
assert.equal(presets.changes.length,13);
for(const row of presets.changes) {
  assert.equal(row.value.source,'explicit');
  assert.deepEqual(contests.get(row.contest_id).awardCutoffs,latestAwardValue(row.contest_id,'awardCutoffs',row.value));
  assert.deepEqual(Object.values(row.value.cutoffs).map(c=>c.rank),[1,3,6].map(n=>Math.ceil(row.evidence.effectiveTeamCount*n/10)));
  assert.ok(row.evidence.boundary.every(b=>b.sameSolvedPenaltyAcrossBoundary===false));
  for(const file of Object.values(row.source_files))assert.match(file.sha256,/^[a-f0-9]{64}$/);
}
const qojReview=await readJson('fixtures/imports/qoj/2026-10-01-standings-review.json');
for(const [url,row]of Object.entries(qojReview.entries)) {
  const contest=contests.get(row.contest_id);
  assert.ok(contest.sources.some(s=>s.provider==='qoj'&&s.url===url));
  if(row.identity_status==='approved') {
    assert.equal(row.problem_identity.length,contest.problemIds.length);
    for(const match of row.problem_identity) {
      assert.equal(match.ordinal,match.srk_ordinal);assert.equal(match.qoj_problem_id,match.srk_problem_id);
      const problem=problems.get(contest.problemIds.find(id=>problems.get(id).ordinal===match.ordinal));
      assert.ok(problem.sources.some(s=>s.provider==='qoj'&&s.provider_problem_id===match.qoj_problem_id));
    }
    assert.equal(contest.awardCutoffs.source,'explicit');
  } else {
    assert.equal(url,'https://qoj.ac/contest/3934');
    assert.equal(contest.awardCutoffs,undefined);assert.equal(contest.startAt,null);
    assert.ok(!contest.sources.some(s=>s.provider==='rankland'));
  }
}
console.log('Additional primary awards, CCPC presets and fresh QOJ identity/standings receipts verified.');
const fullAwards=await readJson('fixtures/imports/catalog-completion/2026-10-01-full-award-refresh.json');
assert.equal(fullAwards.review.status,'approved');
assert.equal(fullAwards.changes.length,13);
assert.equal(fullAwards.changes.filter(r=>r.previous_value===null).length,4);
for(const row of fullAwards.verified) {
  assert.deepEqual(contests.get(row.contest_id).awardCutoffs,row.value);
  assert.equal(row.eligible_rows.length,row.value.eligibleTeamCount);
  assert.equal(new Set(row.eligible_rows.map(t=>t.id)).size,row.eligible_rows.length);
  assert.equal(row.evidence.ties,'No tied medal boundary');
  const medal=row.evidence.explicit_medal_config;
  const ranks=medal==='ccpc'?[1,3,6].map(n=>Math.ceil(row.evidence.scored_count*n/10)):[medal[row.evidence.group].gold,medal[row.evidence.group].gold+medal[row.evidence.group].silver,Object.values(medal[row.evidence.group]).reduce((n,v)=>n+v,0)];
  assert.deepEqual(Object.values(row.value.cutoffs).map(c=>c.rank),ranks);
  for(const [key,cutoff]of Object.entries(row.value.cutoffs)) {
    const r=row.eligible_rows[cutoff.rank-1],next=row.eligible_rows[cutoff.rank];
    assert.equal(r.solved,cutoff.solved);assert.equal(r.penalty,cutoff.penalty);
    assert.ok(!next||r.solved!==next.solved||r.penalty!==next.penalty);
    assert.ok(row.eligible_rows.slice(0,cutoff.rank).some(r=>r.id===cutoff.teamId&&r.solved===cutoff.solved&&r.penalty===cutoff.penalty));
  }
  for(const f of row.source_files){assert.match(f.sha256,/^[a-f0-9]{64}$/);assert.ok(f.url.startsWith('https://'));assert.ok(Number.isFinite(Date.parse(f.fetched_at)));}
}
const refreshedSources=await readJson('fixtures/imports/catalog-completion/2026-10-01-source-refresh.json');
assert.equal(refreshedSources.sources.length,747);
assert.equal(new Set(refreshedSources.sources.map(s=>s.url)).size,747);
assert.equal(refreshedSources.summary.verified_source_mappings,295);
for(const source of refreshedSources.sources)if(source.sha256)assert.match(source.sha256,/^[a-f0-9]{64}$/);
console.log('Full-source capture and all13 new/corrected explicit-award decisions verified.');
