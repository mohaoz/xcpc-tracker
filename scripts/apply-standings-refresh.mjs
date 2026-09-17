// Apply only verified missing cutoffs; preserve existing awards and source choices.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readJson,atomicJson,sha256} from './source-import-lib.mjs';
import {calculateAwards,preferredAwardGroup} from './rankland-lib.mjs';
const [cache,receiptPath]=process.argv.slice(2);
if(!cache||!receiptPath)throw new Error('Usage: apply-standings-refresh.mjs <audited-cache> <receipt>');
const path='catalog/default-catalog.min.json',bytes=await readFile(path),catalog=JSON.parse(bytes);
const report=await readJson(resolve(cache,'audit.json'));
assert.equal(sha256(bytes),report.catalog_sha256,'Catalog changed after audit');
const changes=[];
for(const row of report.audit.filter(r=>r.status==='checked'&&r.provider==='rankland'&&!r.has_awards&&!r.has_estimates)) {
  const c=catalog.contests.find(c=>c.contestId===row.contest_id);
  assert.ok(c&&!c.awardCutoffs&&!c.estimatedAwardCutoffs);
  const source=c.sources.find(s=>s.provider==='rankland'&&s.url===row.url);assert.ok(source);
  const raw=await readFile(resolve(cache,source.provider_contest_id.replace(/^srk:/,'')));
  assert.equal(sha256(raw),row.sha256,'Source changed after audit');
  const srk=JSON.parse(raw),group=preferredAwardGroup(srk);
  let result=calculateAwards(srk,group),field='awardCutoffs',method='explicit';
  if(result.status!=='proposed') {
    if(row.estimate?.status!=='proposed')continue;
    field='estimatedAwardCutoffs';method='inferred_official_medal_ratio_10_20_30';
    const count=srk.rows.filter(r=>r.user.official&&(!group||r.user.markers?.includes(group))).length;
    srk.series=[{rule:{preset:'ICPC',options:{count:{value:[.1,.2,.3].map(r=>Math.floor(count*r)),type:'normal'},...(group?{filter:{byMarker:group}}:{})}},segments:['gold','silver','bronze'].map(style=>({style}))}];
    result=calculateAwards(srk,group);assert.deepEqual(result,row.estimate);
  } else assert.deepEqual(result,row.official);
  assert.equal(result.status,'proposed');
  const value={source:method,sourceProvider:'rankland',sourceLabel:'RankLand',sourceUrl:source.url,eligibleTeamCount:result.eligible_team_count,cutoffs:result.cutoffs};
  c[field]=value;
  changes.push({contest_id:c.contestId,title:c.title,field,value,source_sha256:row.sha256,source_path:source.provider_contest_id.slice(4),evidence:result.evidence});
}
if(changes.length)catalog.exportedAt=new Date().toISOString();
const remaining=catalog.contests.filter(c=>c.sources.some(s=>s.kind==='standings')&&!c.awardCutoffs&&!c.estimatedAwardCutoffs).map(c=>({contest_id:c.contestId,title:c.title,reasons:report.audit.filter(r=>r.contest_id===c.contestId).map(r=>({provider:r.provider,reason:r.reason??r.official?.reason,estimate_reason:r.estimate?.reason}))}));
const receipt={fetched_at:report.fetched_at,commit_sha:report.commit_sha,input_catalog_sha256:report.catalog_sha256,freeze_spec:'https://srk.algoux.org/en/guide/contest-and-problems',scope:'139 existing RankLand mappings: fresh SRK and page identity; 140 Board mappings: fresh configs, full team/run for missing cutoffs; existing awards preserved',changes,remaining,audit:report.audit.map(({official,estimate,board,...r})=>({...r,official_status:official?.status,official_reason:official?.reason,estimate_status:estimate?.status,estimate_reason:estimate?.reason}))};
await atomicJson(receiptPath,receipt);
await atomicJson(path,catalog,bytes.toString().includes('\n  '));
console.log(JSON.stringify({official:changes.filter(c=>c.field==='awardCutoffs').length,estimated:changes.filter(c=>c.field==='estimatedAwardCutoffs').length,remaining:remaining.length}));
