import { pathToFileURL } from 'node:url';
import { readJson } from './source-import-lib.mjs';
import { validateSchema } from './validate-source-schemas.mjs';

export async function validateSnapshot(catalog) {
  await validateSchema('catalog-snapshot', catalog);
  const contests = new Map(catalog.contests.map(c => [c.contestId, c]));
  const problems = new Map(catalog.problems.map(p => [p.problemId, p]));
  if (contests.size !== catalog.contests.length || problems.size !== catalog.problems.length) throw new Error('Duplicate catalog identity');
  for (const p of catalog.problems) {
    if (!contests.get(p.contestId)?.problemIds.includes(p.problemId)) throw new Error('Orphan problem');
  }
  for (const c of catalog.contests) {
    if (c.problemIds.some(id => problems.get(id)?.contestId !== c.contestId)) throw new Error('Missing problem or wrong contest');
    if (new Set(c.problemIds.map(id => problems.get(id).ordinal)).size !== c.problemIds.length) throw new Error('Duplicate problem ordinal');
    if (c.sources.filter(s => s.is_default).length > 1) throw new Error('Multiple explicit default sources');
    for (const s of c.sources) if (s.provider === 'rankland') {
      const url = new URL(s.url);
      if (s.kind !== 'standings' || url.protocol !== 'https:' || !['rl.algoux.cn', 'rl.algoux.org'].includes(url.hostname) || !/^srk:official\/[\w./-]+\.srk\.json$/.test(s.provider_contest_id ?? '') || s.provider_contest_id.includes('..')) throw new Error('Invalid RankLand source');
      if (url.pathname === '/collection/official' ? url.searchParams.getAll('rankId').length !== 1 || !url.searchParams.get('rankId') : !/^\/ranklist\/[^/]+$/.test(url.pathname)) throw new Error('Invalid RankLand page');
    }
    const awards = c.awardCutoffs;
    if (!awards) continue;
    let rank = 0, solved = c.problemIds.length;
    for (const medal of ['gold', 'silver', 'bronze']) {
      const cutoff = awards.cutoffs[medal];
      if (!cutoff) continue;
      if (cutoff.rank < rank || cutoff.rank > awards.eligibleTeamCount || cutoff.solved > solved) throw new Error('Invalid award boundaries');
      rank = cutoff.rank; solved = cutoff.solved;
    }
    if (awards.sourceProvider === 'rankland' && !c.sources.some(s => s.provider === 'rankland' && s.url === awards.sourceUrl)) throw new Error('Award source has no verified standings');
  }
}
async function main() {
  const catalog = await readJson('catalog/default-catalog.min.json');
  await validateSnapshot(catalog);
  const app = await readJson('package.json');
  if (catalog.version !== app.version) throw new Error('Catalog/app version mismatch');
  console.log(`Schema validated ${catalog.contests.length} contests and ${catalog.problems.length} problems, including source and award evidence fields.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exitCode = 1; });
