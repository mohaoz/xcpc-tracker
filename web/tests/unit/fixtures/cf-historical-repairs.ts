import { readRepoJson } from "../helpers/repo";

/** Reviewed 2026-10-02 historical CF mapping repairs and the derived import cases. */
export function loadHistoricalRepairs() {
  const catalog = readRepoJson("catalog/default-catalog.min.json");
  const review = readRepoJson("fixtures/imports/codeforces/2026-10-02-historical-mapping-review.json");
  const lists = readRepoJson<any[]>("fixtures/imports/codeforces/2026-10-02-historical-problem-lists.json");
  const byId = new Map<string, any>(catalog.problems.map((problem: any) => [problem.problemId, problem]));
  return { catalog, review, lists, byId };
}
