import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { atomicJson, problemIdentity, readJson, sha256 } from "../../scripts/source-import-lib.mjs";
import { awardResult, calculateAwards, minutes, parseIndex, verifyPage } from "../../scripts/rankland-lib.mjs";
import { applyRating, inspectRating } from "../../scripts/import-xcpc-rating.mjs";
import { enrichReviewedRatings } from "../../scripts/enrich-reviewed-ratings.mjs";
import { latestAwardValue, stage2AwardReview } from "../../scripts/catalog-award-review.mjs";
import { refreshRatingMetadata } from "../../scripts/refresh-xcpc-rating-metadata.mjs";
import { applyRankland, SRK_COMMIT } from "../../scripts/import-rankland-standings.mjs";
import { validateSchema, validateSnapshot } from "../../scripts/source-schemas.mjs";

const clone = structuredClone;
const reviewed = { status: "approved", reviewed_by: "synthetic regression" };

describe("XCPC Rating import: mapping exclusions", () => {
  it("blocks reviewed bad mappings but keeps corrected upstream mappings re-reviewable", async () => {
    const badMapping = (await readJson("fixtures/imports/xcpc-rating/problem-mapping-exclusions.json")).entries[0];
    const excludedRows = badMapping.upstream_problem_identities.map((r: any) => ({
      contestSlug: badMapping.contest_slug, alias: r.ordinal, title: `Source ${r.ordinal}`, detailTags: ["must-not-import"],
      problemUrl: `https://qoj.ac/problem/${r.identity.split(":")[1]}`, problemRating: 1200,
    }));
    const excludedReport = inspectRating({ contests: [], problems: [] }, excludedRows);
    expect(excludedReport.matches).toHaveLength(0);
    expect(excludedReport.unresolved).toHaveLength(excludedRows.length);
    expect(excludedReport.unresolved.every((r: any) => r.blocked_mapping_sha256 === badMapping.problem_identity_sha256)).toBe(true);
    const fixedMapping = excludedRows.map((r: any, i: number) => (i ? r : { ...r, problemUrl: "https://qoj.ac/problem/999999" }));
    expect(inspectRating({ contests: [], problems: [] }, fixedMapping).unresolved.every((r: any) => !r.blocked_mapping_sha256),
      "Corrected future upstream mapping must be re-reviewable, not permanently blacklisted by slug").toBe(true);
  });
});

describe("XCPC Rating import: matching, enrichment and refresh", () => {
  let fixture: any, report: any, enriched: any, ratingRows: any[], ratingRaw: string, ratingReview: any;
  beforeAll(async () => {
    fixture = await readJson("fixtures/imports/xcpc-rating/example.json");
    report = inspectRating(fixture.catalog, fixture.input);
    enriched = applyRating(fixture.catalog, report);
    // Reviewed numeric metadata is bound to the exact snapshot and problem identity.
    ratingRows = fixture.input.map((row: any) => ({ ...row, problemRating: 1725.5 }));
    ratingRaw = JSON.stringify(ratingRows);
    ratingReview = { ...report, source_sha256: sha256(ratingRaw), review: reviewed };
  });

  it("matches the fixture and applies idempotently without touching provider sources", () => {
    expect(report.matches).toHaveLength(1);
    for (const [key, value] of Object.entries(fixture.expected)) expect(report.matches[0][key]).toStrictEqual(value);
    expect(applyRating(enriched, report)).toStrictEqual(enriched);
    expect(enriched.problems[0].sources[0]).toStrictEqual(fixture.catalog.problems[0].sources[0]);
  });

  it("enriches reviewed ratings only for the exact approved snapshot, filling missing values only", () => {
    const rated = enrichReviewedRatings(enriched, ratingRaw, ratingReview);
    expect(rated.problems[0].rating).toBe(1725.5);
    expect(enriched.problems[0].rating).toBe(undefined);
    expect(enrichReviewedRatings(rated, ratingRaw, ratingReview)).toStrictEqual(rated);
    const populatedRating = clone(enriched); populatedRating.problems[0].rating = 999;
    expect(enrichReviewedRatings(populatedRating, ratingRaw, ratingReview).problems[0].rating,
      "Fill missing ratings only; preserve a populated different value").toBe(999);
    expect(() => enrichReviewedRatings(enriched, ratingRaw, { ...ratingReview, review: { status: "pending" } })).toThrow();
    expect(() => enrichReviewedRatings(enriched, ratingRaw + " ", ratingReview)).toThrow();
    expect(() => enrichReviewedRatings(enriched, ratingRaw, { ...ratingReview, matches: [] })).toThrow();
  });

  it.each([null, -1, "1725.5"])("leaves rating unset for invalid upstream value %j", (value) => {
    const raw = JSON.stringify(ratingRows.map((row) => ({ ...row, problemRating: value })));
    expect(enrichReviewedRatings(enriched, raw, { ...ratingReview, source_sha256: sha256(raw) }).problems[0].rating).toBe(undefined);
  });

  it("rejects renamed or duplicated rows and leaves cross-contest conflicts unset", () => {
    const renamedRaw = JSON.stringify(ratingRows.map((row) => ({ ...row, title: "Different title" })));
    expect(() => enrichReviewedRatings(enriched, renamedRaw, { ...ratingReview, source_sha256: sha256(renamedRaw) })).toThrow();
    const duplicateRaw = JSON.stringify([...ratingRows, ...ratingRows]);
    expect(() => enrichReviewedRatings(enriched, duplicateRaw, { ...ratingReview, source_sha256: sha256(duplicateRaw) })).toThrow();
    const conflictingRows = [...ratingRows, { ...ratingRows[0], contestSlug: "another_contest", problemRating: 1800 }];
    const conflictingRaw = JSON.stringify(conflictingRows);
    const conflictingReport = inspectRating(fixture.catalog, conflictingRows);
    const conflictingCatalog = applyRating(fixture.catalog, conflictingReport);
    expect(enrichReviewedRatings(conflictingCatalog, conflictingRaw, { ...conflictingReport, source_sha256: sha256(conflictingRaw), review: ratingReview.review }).problems[0].rating).toBe(undefined);
  });

  it("does not match a conflicting title and keeps it unresolved", () => {
    const conflict = clone(fixture.input); conflict[0].title = "Different problem";
    expect(inspectRating(fixture.catalog, conflict).matches).toHaveLength(0);
    expect(inspectRating(fixture.catalog, conflict).unresolved).toHaveLength(1);
  });

  describe("full metadata refresh", () => {
    let previousRows: any[], previousRaw: string, previousReview: any, owned: any, nextRows: any[];
    beforeAll(() => {
      previousRows = fixture.input.map((r: any) => ({ ...r, detailTags: ["old", "keep"], problemRating: 1000 }));
      previousRaw = JSON.stringify(previousRows);
      const previousReport = inspectRating(fixture.catalog, previousRows);
      previousReview = { ...previousReport, source_sha256: sha256(previousRaw), review: ratingReview.review };
      owned = applyRating(fixture.catalog, previousReport); owned.problems[0].rating = 1000; owned.problems[0].tags.push("manual");
      nextRows = previousRows.map((r) => ({ ...r, detailTags: ["keep", "new"], problemRating: 1100 }));
    });

    it("replaces source-owned tags/ratings, preserves manual tags and chains applied receipts", () => {
      const refreshed = refreshRatingMetadata(owned, previousRaw, JSON.stringify(nextRows), [previousReview]);
      expect(refreshed.catalog.problems[0].rating).toBe(1100);
      expect(refreshed.catalog.problems[0].tags).toStrictEqual(["keep", "manual", "new"]);
      expect(refreshed.report.tag_changes[0].removed).toStrictEqual(["old"]);
      expect(refreshed.report.rating_changes[0].action).toBe("increase");
      const previousRefresh = { ...refreshed.report, review: ratingReview.review, applied_at: "2026-10-01T00:00:00Z", output_catalog_sha256: sha256(JSON.stringify(refreshed.catalog)) };
      const nextRefresh = refreshRatingMetadata(refreshed.catalog, JSON.stringify(nextRows), JSON.stringify(nextRows.map((r) => ({ ...r, problemRating: 1150, detailTags: ["next"] }))), [previousRefresh]);
      expect(nextRefresh.catalog.problems[0].rating).toBe(1150);
      expect(nextRefresh.catalog.problems[0].tags).toStrictEqual(["manual", "next"]);
      expect(() => refreshRatingMetadata(refreshed.catalog, JSON.stringify(nextRows), JSON.stringify(nextRows), [{ ...previousRefresh, applied_at: undefined }])).toThrow(/applied receipt/);
    });

    it("records rating decreases", () => {
      const refreshed = refreshRatingMetadata(owned, previousRaw, JSON.stringify(nextRows.map((r) => ({ ...r, problemRating: 900 }))), [previousReview]);
      expect(refreshed.catalog.problems[0].rating).toBe(900);
      expect(refreshed.report.rating_changes[0].action).toBe("decrease");
    });

    it("unknown status, empty upstream and manual ratings do not authorize changes", () => {
      const unknownRows = nextRows.map((r) => ({ ...r, status: "unknown", detailTags: [], problemRating: null }));
      let refreshed = refreshRatingMetadata(owned, previousRaw, JSON.stringify(unknownRows), [previousReview]);
      expect(refreshed.catalog.problems[0].rating).toBe(1000);
      expect(refreshed.catalog.problems[0].tags).toStrictEqual(owned.problems[0].tags);
      const manualRating = clone(owned); manualRating.problems[0].rating = 777;
      expect(refreshRatingMetadata(manualRating, previousRaw, JSON.stringify(nextRows), [previousReview]).catalog.problems[0].rating).toBe(777);
      refreshed = refreshRatingMetadata(owned, previousRaw, "[]", [previousReview]);
      expect(refreshed.catalog.problems[0].tags).toStrictEqual(owned.problems[0].tags);
      expect(refreshed.catalog.problems[0].rating).toBe(1000);
    });

    it("withdraws ratings on direct-source conflicts", () => {
      const conflictRows = [...nextRows, { ...nextRows[0], contestSlug: "other_source", problemRating: 1200 }];
      const refreshed = refreshRatingMetadata(owned, previousRaw, JSON.stringify(conflictRows), [previousReview]);
      expect(refreshed.catalog.problems[0].rating).toBe(undefined);
      expect(refreshed.report.rating_changes[0].action).toBe("withdraw_conflict");
    });

    it("does not expand ownership through transitive shared problem IDs", () => {
      const linked = clone(owned);
      linked.problems[0].sources.push({ provider: "qoj", kind: "problem", url: "https://qoj.ac/problem/42", provider_problem_id: "42" });
      linked.contests.push({ contestId: "peer", title: "Another event", problemIds: ["peer:A"], sources: [] });
      linked.problems.push({ problemId: "peer:A", contestId: "peer", ordinal: "A", title: "Example", aliases: [], sources: [{ provider: "qoj", kind: "problem", url: "https://qoj.ac/problem/42", provider_problem_id: "42" }] });
      const linkedRows = [...previousRows, { ...previousRows[0], contestSlug: "another_event", problemUrl: "https://qoj.ac/problem/42", problemRating: 1200 }];
      const refreshed = refreshRatingMetadata(linked, previousRaw, JSON.stringify(linkedRows), [previousReview]);
      expect(refreshed.catalog.problems[0].rating).toBe(undefined);
      expect(refreshed.catalog.problems[1].rating, "Do not expand ownership through a transitive join; retain this entity's directly reviewed source").toBe(1200);
      expect(refreshed.report.conflicts).toHaveLength(1);
      expect(refreshed.report.linked_identity_differences).toHaveLength(1);
    });
  });
});

// Untitled numeric rows require complete exact provider IDs AND independent
// original-event identity/date evidence. No ordinal-only or partial-set fallback.
describe("XCPC Rating import: untitled numeric rows", () => {
  const numericCatalog = {
    contests: [{ contestId: "n", title: "Verified event", aliases: [], problemIds: ["n:A", "n:B", "n:C"], startAt: "2020-01-01T01:00:00.000Z",
      sources: [{ provider: "rankland", kind: "standings", provider_contest_id: "srk:official/icpc/example.srk.json", url: "https://rl.algoux.cn/collection/official?rankId=example" }] }],
    problems: ["A", "B", "C"].map((ordinal) => ({ problemId: `n:${ordinal}`, contestId: "n", ordinal, title: `Verified ${ordinal}`, aliases: [],
      sources: [{ provider: "codeforces", kind: "problem", url: `https://codeforces.com/gym/100111/problem/${ordinal}`, provider_problem_id: `100111:${ordinal}` }] })),
  };
  const numericRows: any[] = ["A", "B", "C"].map((alias, i) => ({ contestSlug: "icpc__example", startAt: "2020-01-01T09:00:00+08:00", alias, title: null, detailTags: [], problemUrl: `https://codeforces.com/gym/100111/problem/${alias}`, problemRating: 1200 + i }));
  const numericReport = inspectRating(numericCatalog, numericRows);
  const numericEnriched = applyRating(numericCatalog, numericReport), numericRaw = JSON.stringify(numericRows);
  const numericReview = { ...numericReport, source_sha256: sha256(numericRaw), review: reviewed };

  it("matches with complete provider IDs and a verified original contest, keeping the absent title absent", () => {
    expect(numericReport.matches).toHaveLength(3);
    expect(numericReport.matches.every((m: any) => m.evidence === "complete_provider_ids_and_verified_original_contest" && m.source_title === null)).toBe(true);
    expect(enrichReviewedRatings(numericEnriched, numericRaw, numericReview).problems.map((p: any) => p.rating)).toStrictEqual([1200, 1201, 1202]);
    expect(numericEnriched.problems.every((p: any) => p.sources.filter((s: any) => s.provider === "xcpc_rating").every((s: any) => s.source_title === undefined))).toBe(true);
  });

  // Losing a source title changes the evidence to numeric-only, never to an
  // authoritative empty tag list. Preserve prior tags even while refreshing numbers.
  it("losing a source title never deletes previously owned tags", () => {
    const titledRows = numericRows.map((r) => ({ ...r, title: `Verified ${r.alias}`, status: "classified", detailTags: ["retained-tag"] }));
    const titledRaw = JSON.stringify(titledRows);
    const titledReview = { ...inspectRating(numericCatalog, titledRows), source_sha256: sha256(titledRaw), review: reviewed };
    const titledEnriched = applyRating(numericCatalog, titledReview);
    const titleLost = refreshRatingMetadata(titledEnriched, titledRaw, JSON.stringify(titledRows.map((r) => ({ ...r, title: null }))), [titledReview]);
    expect(titleLost.catalog.problems.map((p: any) => p.tags)).toStrictEqual(titledEnriched.problems.map((p: any) => p.tags));
    expect(titleLost.report.tag_changes).toHaveLength(0);
  });

  it("does not overwrite existing values", () => {
    const populatedNumeric = clone(numericEnriched); populatedNumeric.problems[0].rating = 999;
    expect(enrichReviewedRatings(populatedNumeric, numericRaw, numericReview).problems[0].rating, "Provider-ID numeric enrichment must not overwrite existing values").toBe(999);
  });

  it.each([
    ["no RankLand source", (c: any) => { c.contests[0].sources = []; }],
    ["different RankLand path", (c: any) => { c.contests[0].sources[0].provider_contest_id = "srk:official/icpc/wrong.srk.json"; }],
    ["missing start time", (c: any) => { c.contests[0].startAt = null; }],
    ["different start time", (c: any) => { c.contests[0].startAt = "2020-01-02T01:00:00.000Z"; }],
  ])("does not match when the catalog lacks original-event evidence: %s", (_name, mutate) => {
    const changed = clone(numericCatalog); mutate(changed);
    expect(inspectRating(changed, numericRows).matches).toHaveLength(0);
  });

  it.each([
    ["partial list", (rows: any[]) => { rows.pop(); }],
    ["duplicate problem URL", (rows: any[]) => { rows[1].problemUrl = rows[0].problemUrl; }],
    ["duplicate alias", (rows: any[]) => { rows[1].alias = rows[0].alias; }],
    ["conflicting known title", (rows: any[]) => { rows[1].title = "Conflicting known title"; }],
    ["different start time", (rows: any[]) => { rows[1].startAt = "2020-01-02T09:00:00+08:00"; }],
  ])("does not match incomplete or inconsistent rows: %s", (_name, mutate) => {
    const changed = clone(numericRows); mutate(changed);
    expect(inspectRating(numericCatalog, changed).matches).toHaveLength(0);
  });

  it("rejects enrichment when the catalog evidence changed since review", () => {
    const staleNumeric = clone(numericEnriched); staleNumeric.contests[0].sources = [];
    expect(() => enrichReviewedRatings(staleNumeric, numericRaw, numericReview)).toThrow(/evidence changed/);
  });
});

describe("problem identity parsing", () => {
  it("rejects unsafe or look-alike URLs and normalizes QOJ contest problem URLs", () => {
    expect(problemIdentity("javascript:alert(1)")).toBe(null);
    expect(problemIdentity("https://codeforces.com.evil.test/gym/100000/problem/A")).toBe(null);
    expect(problemIdentity("https://qoj.ac/contest/2/problem/123")).toBe("qoj:123");
  });
});

describe("RankLand award calculation", () => {
  let srk: any;
  beforeAll(async () => { srk = await readJson("fixtures/imports/rankland/srk-supported.json"); });
  const ranks = (result: any) => Object.values(result.cutoffs).map((c: any) => c.rank);

  it("proposes awards for the supported fixture", () => {
    const awards = calculateAwards(srk);
    expect(awards.status).toBe("proposed");
    expect(awards.eligible_team_count).toBe(4);
    expect(awards.cutoffs.gold).toStrictEqual({ rank: 1, teamId: "gold", solved: 3, penalty: 1 });
  });

  it("converts duration units and rejects unknown units", () => {
    expect(minutes([60000, "ms"])).toBe(1);
    expect(minutes([1, "h"])).toBe(60);
    expect(() => minutes([1, "unknown"])).toThrow();
  });

  it.each([
    ["unsupported version", (s: any) => { s.version = "99.0.0"; }],
    ["frozen with unknown result", (s: any) => { s.contest.frozenDuration = [1, "h"]; s.rows[0].statuses[0].result = "?"; }],
    ["future contest", (s: any) => { s.contest.startAt = "2999-01-01T00:00:00Z"; }],
    ["missing official flag", (s: any) => { delete s.rows[0].user.official; }],
    ["missing statuses", (s: any) => { s.rows[0].statuses = []; }],
    ["pending result", (s: any) => { s.rows[0].statuses[0].result = "PENDING"; }],
    ["unrecognized result", (s: any) => { s.rows[0].statuses[0].result = "UNRECOGNIZED"; }],
    ["zero medal counts", (s: any) => { s.series[0].rule.options.count.value = [0, 0, 0]; }],
    ["count and ratio together", (s: any) => { s.series[0].rule.options.ratio = { value: [0.1, 0.2, 0.3] }; }],
    ["tied scores", (s: any) => { s.rows[2].score = structuredClone(s.rows[1].score); }],
    ["multiple medal series", (s: any) => { s.series.push(structuredClone(s.series[0])); }],
  ])("blocks unsafe standings: %s", (_name, mutate) => {
    const changed = clone(srk); mutate(changed);
    expect(calculateAwards(changed).status).toBe("blocked");
  });

  it("accepts historical freeze durations with complete results", () => {
    const historicalFreeze = clone(srk);
    historicalFreeze.contest.frozenDuration = [1, "h"];
    expect(calculateAwards(historicalFreeze).status).toBe("proposed");
    delete historicalFreeze.contest.frozenDuration;
    expect(calculateAwards(historicalFreeze).status).toBe("proposed");
  });

  it("applies official ratio rounding and denominators", () => {
    const ratioFixture = clone(srk);
    ratioFixture.series[0].rule.options = { ratio: { value: [0.1, 0.2, 0.3] } };
    ratioFixture.rows = Array.from({ length: 10 }, (_, i) => ({ ...clone(srk.rows[0]), user: { id: String(i), official: true }, score: { value: srk.rows[0].score.value, time: [i + 1, "min"] } }));
    ratioFixture.rows.push({ ...clone(ratioFixture.rows[0]), user: { id: "guest", official: false } });
    const ratioAwards = calculateAwards(ratioFixture);
    expect(ratioAwards.eligible_team_count).toBe(10);
    expect(ranks(ratioAwards)).toStrictEqual([1, 3, 6]);
    ratioFixture.rows.push({ ...clone(ratioFixture.rows[0]), user: { id: "eleventh", official: true }, score: { value: srk.rows[0].score.value, time: [11, "min"] } });
    expect(ranks(calculateAwards(ratioFixture))).toStrictEqual([2, 4, 7]);
    ratioFixture.series[0].rule.options.ratio.rounding = "floor";
    expect(ranks(calculateAwards(ratioFixture))).toStrictEqual([1, 3, 6]);
    ratioFixture.series[0].rule.options.ratio.denominator = "submitted";
    expect(calculateAwards(ratioFixture).status).toBe("blocked");

    const scoredRatio = clone(ratioFixture);
    scoredRatio.series[0].rule.options.ratio.denominator = "scored";
    scoredRatio.series[0].rule.options.ratio.rounding = "ceil";
    for (const [i, row] of scoredRatio.rows.entries()) if (i >= 6) { row.score.value = 0; row.score.time = [0, "min"]; row.statuses = row.statuses.map(() => ({})); }
    const scoredResult = calculateAwards(scoredRatio);
    expect(scoredResult.status).toBe("proposed");
    expect(scoredResult.eligible_team_count).toBe(11);
    expect(scoredResult.evidence.ratio_denominator_count).toBe(6);
    expect(ranks(scoredResult)).toStrictEqual([1, 2, 4]);
    for (const row of scoredRatio.rows) { row.score.value = 0; row.statuses = row.statuses.map(() => ({})); }
    expect(calculateAwards(scoredRatio).status).toBe("blocked");
  });

  it("requires an explicit known group when medals are filtered by marker", () => {
    const grouped = clone(srk);
    grouped.series[0].rule.options.filter = { byMarker: "invitational" };
    expect(calculateAwards(grouped).status).toBe("blocked");
    expect(calculateAwards(grouped, "invitational").eligible_team_count).toBe(3);
    expect(calculateAwards(grouped, "missing").status).toBe("blocked");
  });
});

describe("RankLand index, page verification and standings import", () => {
  const indexText = "root:\n  children:\n    - path: test\n      name: Test\n      children:\n        - path: example\n          name: Synthetic final\n          format: srk.json\n";
  const collection = { success: true, data: { content: { root: { children: [{ name: "Test", type: 2, children: [{ name: "Synthetic final", type: 1, uniqueKey: "different-database-key" }] }] } } } };
  const reviewMeta = { reviewed_by: "automated synthetic test", reviewed_at: "2026-09-14T00:00:00Z", reason: "synthetic regression" };
  let srk: any, index: any, info: any, page: string, cache: string;
  let catalog: any, mapping: any, awardReview: any, migrated: any;

  beforeAll(async () => {
    srk = await readJson("fixtures/imports/rankland/srk-supported.json");
    index = parseIndex(indexText)[0];
    info = { success: true, data: { uk: "different-database-key", srkFileID: "1", name: "Synthetic final", startAt: srk.contest.startAt } };
    page = verifyPage(index, collection, info, srk);
    // Generated test fixtures in a temp cache, not canonical repository content.
    cache = await mkdtemp(join(tmpdir(), "xcpc-source-test-"));
    await atomicJson(join(cache, index.srk_path), srk);
    await atomicJson(join(cache, `${index.srk_path}.info.json`), info);
    await atomicJson(join(cache, "collection.json"), collection);
    await writeFile(join(cache, "config.yaml"), indexText);
    catalog = { schemaVersion: 1, exportKind: "local_catalog_snapshot", version: "0.6.0",
      contests: [{ contestId: "c", title: "Synthetic final", aliases: [], tags: [], curationStatus: "problem_listed", problemIds: ["c:A", "c:B", "c:C"], sources: [] }],
      problems: ["A", "B", "C"].map((ordinal) => ({ problemId: `c:${ordinal}`, contestId: "c", ordinal, title: ordinal, aliases: [], sources: [] })) };
    const source = { provider: "rankland", collection: "official", provider_contest_id: `srk:${index.srk_path}`, srk_path: index.srk_path,
      repository_url: "https://github.com/algoux/srk-collection", commit_sha: SRK_COMMIT, content_sha256: sha256(await readFile(join(cache, index.srk_path))),
      index_sha256: sha256(indexText), srk_version: srk.version, fetched_at: reviewMeta.reviewed_at, page_url: page, page_verified_at: reviewMeta.reviewed_at,
      source_title: "Synthetic final", attribution: { name: "synthetic", license_url: "https://example.com/license" } };
    mapping = { schema_version: 1, export_kind: "rankland_mapping_review", synthetic: false, catalog_sha256: sha256(JSON.stringify(catalog)),
      entries: [{ entry_id: "test", status: "approved", source, candidate_contest_ids: ["c"], evidence: ["synthetic"], selection: { contest_id: "c", make_default: true }, review: reviewMeta }] };
    awardReview = { schema_version: 1, export_kind: "rankland_award_review", synthetic: false, catalog_sha256: mapping.catalog_sha256,
      entries: [{ entry_id: "award", mapping_entry_id: "test", contest_id: "c", source_content_sha256: source.content_sha256, status: "approved", reason: "synthetic", result: awardResult(srk, calculateAwards(srk)), review: reviewMeta }] };
    migrated = await applyRankland(catalog, mapping, cache, awardReview);
  });
  afterAll(async () => { if (cache) await rm(cache, { recursive: true, force: true }); });

  it("parses the SRK index and verifies the RankLand page by database key", () => {
    expect(index.srk_path).toBe("official/test/example.srk.json");
    expect(page.endsWith("rankId=different-database-key")).toBe(true);
    expect(() => verifyPage(index, collection, { ...info, data: { ...info.data, uk: "example" } }, srk)).toThrow();
  });

  it("applies reviewed standings idempotently into a valid snapshot", async () => {
    expect(await applyRankland(migrated, mapping, cache, awardReview)).toStrictEqual(migrated);
    await expect(validateSnapshot(migrated)).resolves.toBeUndefined();
    expect(migrated.contests[0].awardCutoffs.cutoffs.gold.penalty).toBe(1);
  });

  it("rejects synthetic, stale or mismatched reviews", async () => {
    await expect(applyRankland(catalog, { ...mapping, synthetic: true }, cache, awardReview)).rejects.toThrow();
    const stale = clone(mapping); stale.entries[0].source.content_sha256 = "0".repeat(64);
    await expect(applyRankland(catalog, stale, cache, awardReview)).rejects.toThrow();
    const badAward = clone(awardReview); badAward.entries[0].result.cutoffs.gold.solved = 1;
    await expect(applyRankland(catalog, mapping, cache, badAward)).rejects.toThrow();
  });

  it("snapshot validation rejects malformed fields and duplicate sources", async () => {
    const badCatalog = clone(migrated); badCatalog.problems[0].tags = "not an array";
    await expect(validateSnapshot(badCatalog)).rejects.toThrow();
    const duplicate = clone(migrated); duplicate.contests[0].sources.push({ ...duplicate.contests[0].sources[0] });
    await expect(validateSnapshot(duplicate)).rejects.toThrow();
  });

  it("synthetic mapping and award reviews satisfy their schemas", async () => {
    await expect(validateSchema("rankland-review", mapping)).resolves.toBeUndefined();
    await expect(validateSchema("rankland-award-review", awardReview)).resolves.toBeUndefined();
  });
});

// Verify actual release review contracts and their published outcomes without fetching upstream.
describe("published RankLand review contracts", () => {
  let published: any, completion: any;
  const contest = (id: string) => published.contests.find((c: any) => c.contestId === id);
  beforeAll(async () => {
    published = await readJson("catalog/default-catalog.min.json");
    completion = await readJson("fixtures/imports/rankland/2026-10-01-completion.json");
  });

  it("approved mappings and awards are published as reviewed", async () => {
    const publishedMapping = await readJson("fixtures/imports/rankland/2026-09-review.json");
    const publishedAwards = await readJson("fixtures/imports/rankland/2026-09-awards.json");
    await expect(validateSchema("rankland-review", publishedMapping)).resolves.toBeUndefined();
    await expect(validateSchema("rankland-award-review", publishedAwards)).resolves.toBeUndefined();
    for (const entry of publishedMapping.entries.filter((e: any) => e.status === "approved")) {
      const c = contest(entry.selection.contest_id);
      expect(c.sources.some((s: any) => s.provider === "rankland" && s.provider_contest_id === entry.source.provider_contest_id && s.url === entry.source.page_url)).toBe(true);
    }
    for (const entry of publishedAwards.entries.filter((e: any) => e.status === "approved")) {
      const c = contest(entry.contest_id);
      expect(c.awardCutoffs.sourceProvider).toBe("rankland");
      for (const medal of ["gold", "silver", "bronze"]) {
        const actual = c.awardCutoffs.cutoffs[medal], expected = entry.result.cutoffs[medal];
        expect({ rank: actual.rank, solved: actual.solved, penalty: actual.penalty, team_id: actual.teamId }).toStrictEqual(expected);
      }
    }
  });

  it("receipt corrections stay removed and every audited contest remains in the catalog", async () => {
    const receipt = await readJson("fixtures/imports/rankland/2026-09-receipt.json");
    for (const fix of receipt.corrections) {
      const c = contest(fix.contest_id);
      expect(fix.removed_sources.every((s: any) => !c.sources.some((t: any) => s.url === t.url))).toBe(true);
    }
    const auditedIds = new Set<string>((await readJson("fixtures/imports/rankland/2026-09-audit.json")).catalog_status.map((c: any) => c.contest_id));
    expect(auditedIds.size).toBe(receipt.contest_count);
    for (const id of auditedIds) expect(published.contests.some((c: any) => c.contestId === id), "Previously audited contest must remain in catalog").toBe(true);
  });

  it("refreshed cutoff receipts match the published catalog and verified source mappings", async () => {
    const refresh = await readJson("fixtures/imports/rankland/2026-09-17-refresh.json");
    expect(refresh.commit_sha).toMatch(/^[a-f0-9]{40}$/);
    expect(new Set(refresh.changes.map((c: any) => c.contest_id)).size).toBe(refresh.changes.length);
    for (const change of refresh.changes) {
      const c = contest(change.contest_id);
      expect(c[change.field]).toStrictEqual(latestAwardValue(change.contest_id, change.field, change.value));
      expect(change.source_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(c.sources.some((s: any) => s.provider === "rankland" && s.url === change.value.sourceUrl)).toBe(true);
      expect(change.evidence.ties).toBe("No tied medal boundary");
    }
  });

  it("official ratio receipts are explicit and published", async () => {
    const ratios = await readJson("fixtures/imports/rankland/2026-09-17-official-ratios.json");
    expect(ratios.changes).toHaveLength(2);
    for (const change of ratios.changes) {
      expect(change.value.source).toBe("explicit");
      expect(contest(change.contest_id).awardCutoffs).toStrictEqual(change.value);
      expect(change.evidence.official_ratio.value).toStrictEqual([0.1, 0.2, 0.3]);
    }
  });

  it("highest-group audit, verified replacements and eligibility removals are reflected", async () => {
    const eligibility = await readJson("fixtures/imports/rankland/2026-09-17-estimate-eligibility.json");
    const replacements = await readJson("fixtures/imports/rankland/2026-09-17-verified-replacements.json");
    const highest = await readJson("fixtures/imports/rankland/2026-09-17-highest-group-audit.json");
    const highestReplacement = await readJson("fixtures/imports/rankland/2026-09-17-highest-group-replacement.json");
    expect(highest.removed).toHaveLength(7);
    expect(highestReplacement.changes).toHaveLength(1);
    for (const change of highestReplacement.changes) expect(contest(change.contest_id)[change.field]).toStrictEqual(latestAwardValue(change.contest_id, change.field, change.value));
    for (const row of highest.removed) expect(contest(row.contest_id)[row.field]).not.toStrictEqual(row.value);
    expect(replacements.changes).toHaveLength(3);
    for (const r of replacements.changes) {
      expect(r.value.sourceProvider).toBe("rankland");
      expect(contest(r.contest_id)[r.field]).toStrictEqual(latestAwardValue(r.contest_id, r.field, r.value));
      expect(r.evidence.ties).toBe("No tied medal boundary");
    }
    expect(eligibility.removed).toHaveLength(13);
    for (const row of eligibility.removed) expect(contest(row.contest_id)[row.field]).not.toStrictEqual(row.value);
  });

  it("every retained estimate has official-team eligibility evidence and floor 10/20/30% ranks", () => {
    for (const c of published.contests) for (const field of ["awardCutoffs", "estimatedAwardCutoffs"]) {
      const value = c[field];
      if (!value || value.source === "explicit") continue;
      expect(value.source).toBe("inferred_official_medal_ratio_10_20_30");
      expect(value.sourceProvider).not.toBe("codeforces");
      const row = stage2AwardReview.verified.find((r: any) => r.contest_id === c.contestId && r.field === field)
        ?? completion.verified.find((r: any) => r.contest_id === c.contestId && r.field === field);
      expect(row, "Every remaining estimate needs official-team eligibility evidence").toBeTruthy();
      expect(value).toStrictEqual(row.value);
      expect(row.evidence.ties).toBe("No tied medal boundary");
      const counts = [0.1, 0.2, 0.3].map((r) => Math.floor(value.eligibleTeamCount * r));
      expect(Object.values(value.cutoffs).map((c: any) => c?.rank)).toStrictEqual(counts.map((_, i) => counts.slice(0, i + 1).reduce((sum, n) => sum + n, 0)));
    }
  });
});
