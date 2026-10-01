import {readFileSync} from 'node:fs';
const load=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
export const completionAwardReview=load('../fixtures/imports/rankland/2026-10-01-completion.json');
export const stage2AwardReview=load('../fixtures/imports/catalog-completion/2026-10-01-stage2-awards.json');
export const fullAwardRefresh=load('../fixtures/imports/catalog-completion/2026-10-01-full-award-refresh.json');
export function latestAwardValue(contestId,field,earlier) {
  let value=earlier;
  for(const review of [completionAwardReview,stage2AwardReview,fullAwardRefresh]) {
    if(review.removed.some(row=>row.contest_id===contestId&&row.field===field))value=undefined;
    const change=review.changes.find(row=>row.contest_id===contestId&&row.field===field);
    if(change)value=change.value;
  }
  return value;
}
