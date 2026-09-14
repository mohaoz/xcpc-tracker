import type { CatalogAwardCutoffs } from './catalog';
export function selectAwardCutoffs(contest: {awardCutoffs?: CatalogAwardCutoffs | null; estimatedAwardCutoffs?: CatalogAwardCutoffs | null} | undefined | null, allowEstimates = false) {
  const awards = contest?.awardCutoffs;
  if (awards && !awards.source.startsWith('inferred_')) return awards;
  return allowEstimates ? (contest?.estimatedAwardCutoffs ?? awards ?? null) : null;
}
