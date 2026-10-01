import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { atomicJson, readJson, sha256, names, normalizeTitle } from './source-import-lib.mjs';
import { inspectRating } from './import-xcpc-rating.mjs';

// Enrich only previously reviewed source identities; never guess by ordinal alone.
export function enrichReviewedRatings(catalog, raw, review) {
  if (review.review?.status !== 'approved' || !review.review?.reviewed_by) throw new Error('Rating review is not approved');
  if (sha256(raw) !== review.source_sha256) throw new Error('Snapshot differs from reviewed source');
  const rows = JSON.parse(raw);
  const values = new Map();
  for (const row of rows) {
    const key = `${row.contestSlug}:${row.alias}`;
    if (values.has(key)) throw new Error(`Duplicate upstream identity: ${key}`);
    values.set(key, row);
  }
  const result = structuredClone(catalog);
  const providerOnlyReview=review.matches.some(m=>m.evidence==='complete_provider_ids_and_verified_original_contest') ? inspectRating(catalog,rows).matches.filter(m=>m.evidence==='complete_provider_ids_and_verified_original_contest') : [];
  for (const problem of result.problems) {
    const candidates = problem.sources.filter(s => s.provider === 'xcpc_rating').map(s => {
      const match = review.matches.find(m => m.problem_id === problem.problemId && `${m.contest_slug}:${m.ordinal}` === s.provider_problem_id);
      if (!match) throw new Error('Unreviewed source identity');
      const row = values.get(s.provider_problem_id);
      if (match.evidence==='complete_provider_ids_and_verified_original_contest') {
        if (!row || !providerOnlyReview.some(m=>JSON.stringify(m)===JSON.stringify(match))) throw new Error('Reviewed rating original-contest/provider-ID evidence changed');
      } else if (!row || normalizeTitle(row.title) !== normalizeTitle(match.title) || !names(problem).includes(normalizeTitle(row.title))) throw new Error('Reviewed rating title differs from source or catalog');
      return row.problemRating;
    }).filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
    const unique = [...new Set(candidates)];
    if (unique.length > 1) continue; // Conflicting upstream ratings remain unset.
    if (unique.length === 1 && problem.rating == null) problem.rating = unique[0];
  }
  return result;
}

async function main() {
  const [input, reviewPath = 'fixtures/imports/xcpc-rating/2026-09-review.json', catalogPath = 'catalog/default-catalog.min.json'] = process.argv.slice(2);
  if (!input) throw new Error('Usage: node scripts/enrich-reviewed-ratings.mjs <reviewed-raw-snapshot> [review-json] [catalog-json]');
  const catalog = await readJson(catalogPath);
  const result = enrichReviewedRatings(catalog, await readFile(input), await readJson(reviewPath));
  await atomicJson(catalogPath, result);
  console.log(`Enriched ${result.problems.filter((p, i) => p.rating !== catalog.problems[i].rating).length} previously reviewed problems with XCPC Rating values.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exitCode = 1; });
