import { describe, expect, it } from "vitest";

import { loadHistoricalRepairs } from "./fixtures/cf-historical-repairs";
import { readRepoJson, repoFileExists } from "./helpers/repo";

// Checks generated static assets; run after `npm run catalog:generate-web-assets`.
// Skipped when the generated lookup is absent (e.g. a fresh checkout).
const hasGenerated = repoFileExists("catalog/generated/problem-lookup.json");

describe.skipIf(!hasGenerated)("generated CF lookup and contest details", () => {
  const { catalog, review, byId } = loadHistoricalRepairs();

  it("retain exact reviewed provider ownership and the generation timestamp", () => {
    const lookup = readRepoJson("catalog/generated/problem-lookup.json");
    expect(lookup.problems, "Generated lookup must retain exact reviewed provider ownership").toEqual(catalog.problems);
    expect(lookup.generated_at).toBe(catalog.exportedAt);
    for (const contest of review.original_identity) {
      const detail = readRepoJson(`catalog/generated/contests/${contest.contest_id}.json`);
      for (const problem of detail.problems) expect(problem.sources).toEqual(byId.get(problem.id).sources);
    }
  });
});
