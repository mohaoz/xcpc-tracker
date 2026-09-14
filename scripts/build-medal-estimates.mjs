import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, readJson, sha256 } from './source-import-lib.mjs';
import { calculateAwards, preferredAwardGroup } from './rankland-lib.mjs';
const cache = process.argv[2];
if (!cache) throw new Error('Usage: node scripts/build-medal-estimates.mjs <audited-srk-cache>');
const catalog = await readJson('catalog/default-catalog.min.json');
const review = await readJson('fixtures/imports/rankland/2026-09-review.json');
const audit = [];
for (const contest of catalog.contests) {
  if (contest.awardCutoffs) continue;
  const entry = review.entries.find(e => e.status === 'approved' && e.selection.contest_id === contest.contestId);
  if (!entry) continue;
  const text = await readFile(join(cache, entry.source.srk_path));
  if (sha256(text) !== entry.source.content_sha256) throw new Error('SRK content changed');
  const srk = JSON.parse(text);
  const group = preferredAwardGroup(srk);
  const series = (srk.series ?? []).filter(s => s.rule?.preset === 'ICPC');
  if (series.length > 1 && !group) {audit.push({contest_id:contest.contestId, status:'skipped', reason:'Unknown highest group'});continue;}
  const selected = series.find(s => !group || s.rule.options?.filter?.byMarker === group);
  if (selected?.rule.options?.count?.value?.some(n => n > 0) || selected?.rule.options?.ratio) {audit.push({contest_id:contest.contestId, status:'skipped', reason:'Has award configuration; do not replace with ratio'});continue;}
  const eligible = (srk.rows ?? []).filter(r => r.user?.official === true && (!group || r.user.markers?.includes(group))).length;
  const counts = [0.1,0.2,0.3].map(r => Math.floor(eligible * r));
  const copy = structuredClone(srk);
  copy.series = [{title:'Ratio estimate',rule:{preset:'ICPC',options:{count:{value:counts,type:'normal'},...(group?{filter:{byMarker:group}}:{})}},segments:['gold','silver','bronze'].map(style=>({style}))}];
  const result = calculateAwards(copy, group);
  audit.push({contest_id:contest.contestId, source_sha256:entry.source.content_sha256, group:group??'official', counts, status:result.status, reason:result.reason});
  if (result.status !== 'proposed') continue;
  contest.estimatedAwardCutoffs = {source:'inferred_official_medal_ratio_10_20_30',sourceProvider:'rankland',sourceLabel:'RankLand',sourceUrl:entry.source.page_url,eligibleTeamCount:result.eligible_team_count,cutoffs:result.cutoffs};
}
await atomicJson('catalog/default-catalog.min.json', catalog);
await atomicJson('fixtures/imports/rankland/2026-09-estimates.json', {method:'floor(eligible * 0.1/0.2/0.3); cumulative medal ranks',audit});
console.log(`Generated ${audit.filter(r => r.status === 'proposed').length} estimates; all gaps recorded.`);
