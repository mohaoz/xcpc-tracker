import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readJson } from './source-import-lib.mjs';
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
let ready;
export async function validateSchema(name, value) {
  ready ??= Promise.all(['rankland-source', 'rankland-review', 'rankland-award-review', 'catalog-snapshot'].map(async name => {
    ajv.addSchema(await readJson(new URL(`../schemas/${name}.schema.json`, import.meta.url)), `${name}.schema.json`);
  }));
  await ready;
  const check = ajv.getSchema(`${name}.schema.json`);
  if (!check(value)) throw new Error(`${name}: ${ajv.errorsText(check.errors)}`);
}

// Schema plus cross-entity invariants for a local catalog snapshot.
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
