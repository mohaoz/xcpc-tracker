import { readFile } from 'node:fs/promises';
import { atomicJson, readJson, sha256 } from './source-import-lib.mjs';

// Enrich only previously reviewed source identities; never guess by ordinal alone.
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/enrich-reviewed-ratings.mjs <reviewed-raw-snapshot>');
const raw = await readFile(input);
const review = await readJson('fixtures/imports/xcpc-rating/2026-09-review.json');
if (sha256(raw) !== review.source_sha256) throw new Error('Snapshot differs from reviewed source');
const rows = JSON.parse(raw);
const catalogPath = 'catalog/default-catalog.min.json';
const catalog = await readJson(catalogPath);
const values = new Map();
for (const row of rows) {
  const key = `${row.contestSlug}:${row.alias}`;
  if (values.has(key)) throw new Error(`Duplicate upstream identity: ${key}`);
  values.set(key, row.problemRating);
}
let count = 0;
for (const problem of catalog.problems) {
  const candidates = problem.sources.filter(s => s.provider === 'xcpc_rating').map(s => {
    if (!review.matches.some(m => m.problem_id === problem.problemId && `${m.contest_slug}:${m.ordinal}` === s.provider_problem_id)) throw new Error('Unreviewed source identity');
    return values.get(s.provider_problem_id);
  }).filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  const unique = [...new Set(candidates)];
  if (unique.length > 1) continue; // Conflicting upstream ratings remain unset.
  if (unique.length === 1) { problem.rating = unique[0]; count++; }
}
await atomicJson(catalogPath, catalog);
console.log(`Enriched ${count} previously reviewed problems with XCPC Rating values.`);
