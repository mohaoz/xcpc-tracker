import { describe, expect, it } from "vitest";

import { loadCatalogContests, validateContest, validatePublishedContest } from "../../scripts/catalog-lib";

describe("catalog repository rules", () => {
  it("accepts every contest in the canonical catalog", async () => {
    const contests = await loadCatalogContests();
    expect(contests.length).toBeGreaterThan(0);
  });

  it("rejects contest stubs and contests without problems", async () => {
    const [sample] = await loadCatalogContests();
    expect(validateContest(sample, "sample")).toEqual([]);

    expect(validatePublishedContest(sample, "sample")).toEqual([]);

    const stub = { ...structuredClone(sample), curation_status: "contest_stub" };
    expect(validatePublishedContest(stub, "stub").join("\n")).toMatch(/must not contain contest_stub/);

    const empty = { ...structuredClone(sample), problems: [] };
    expect(validatePublishedContest(empty, "empty").join("\n")).toMatch(/at least one problem/);
  });
});
