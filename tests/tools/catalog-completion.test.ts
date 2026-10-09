import { describe, expect, it } from "vitest";
import { normalizeTitle, problemIdentity, readJson } from "../../scripts/source-import-lib.mjs";
import { latestAwardValue, stage2AwardReview } from "../../scripts/catalog-award-review.mjs";

// Reviewed completion receipts must match the published canonical catalog.
const catalog = await readJson("catalog/default-catalog.min.json");
const review = await readJson("fixtures/imports/rankland/2026-10-01-completion.json");
const rating = await readJson("fixtures/imports/xcpc-rating/2026-10-01-review.json");
const ratingRefresh = await readJson("fixtures/imports/xcpc-rating/2026-10-01-full-refresh.json");
const latestRating = (id: string, value: unknown) => {
  const row = ratingRefresh.rating_changes.find((r: any) => r.problem_id === id);
  return row ? row.value ?? undefined : value;
};
const contests = new Map<string, any>(catalog.contests.map((c: any) => [c.contestId, c]));
const problems = new Map<string, any>(catalog.problems.map((p: any) => [p.problemId, p]));
const key = (r: any) => `${r.contest_id}:${r.field}`;
const SHA256 = /^[a-f0-9]{64}$/;

describe("catalog completion review (RankLand 2026-10-01)", () => {
  const hashes = new Set(review.source_files.map((f: any) => f.sha256));

  it("has a valid envelope and unique decisions", () => {
    expect(review.schema_version).toBe(1);
    expect(review.input_catalog_sha256).toMatch(SHA256);
    expect(review.srk_commit_sha).toMatch(/^[a-f0-9]{40}$/);
    expect(Number.isFinite(Date.parse(review.reviewed_at))).toBe(true);
    for (const rows of [review.changes, review.removed, review.verified, review.date_changes]) {
      expect(new Set(rows.map(key)).size, "Duplicate completion decision").toBe(rows.length);
    }
    for (const file of review.source_files) {
      expect(file.sha256).toMatch(SHA256);
      expect(file.url.startsWith("https://")).toBe(true);
    }
  });

  it("cutoff changes are published and backed by archived sources and standings", () => {
    for (const row of review.changes) {
      expect(["awardCutoffs", "estimatedAwardCutoffs"]).toContain(row.field);
      expect(hashes.has(row.source_sha256), "Changed awards need archived source hash").toBe(true);
      const contest = contests.get(row.contest_id);
      expect(contest).toBeTruthy();
      expect(contest[row.field]).toStrictEqual(latestAwardValue(row.contest_id, row.field, row.value));
      expect(row.value).not.toStrictEqual(row.previous_value);
      expect(contest.sources.some((s: any) => s.kind === "standings" && s.provider === row.value.sourceProvider && s.url === row.value.sourceUrl)).toBe(true);
    }
  });

  it("removed estimates are superseded or withdrawn in the catalog", () => {
    for (const row of review.removed) {
      expect(row.previous_value.source).toBe("inferred_official_medal_ratio_10_20_30");
      expect(row.reason).toBeTruthy();
      const replacement = review.changes.find((r: any) => key(r) === key(row));
      expect(contests.get(row.contest_id)[row.field]).toStrictEqual(latestAwardValue(row.contest_id, row.field, replacement?.value));
    }
  });

  it("source additions are published with archived hashes and aliases", () => {
    for (const row of review.source_changes) {
      const contest = contests.get(row.contest_id);
      expect(contest).toBeTruthy();
      expect(contest.sources.some((s: any) => JSON.stringify(s) === JSON.stringify(row.source))).toBe(true);
      expect(hashes.has(row.source_sha256)).toBe(true);
      for (const alias of row.aliases ?? []) expect(contest.title === alias || contest.aliases.includes(alias)).toBe(true);
    }
  });

  it("date fills only fill missing dates", () => {
    for (const row of review.date_changes) {
      expect(row.previous_value, "Date fill must not overwrite an existing date").toBe(null);
      expect(contests.get(row.contest_id).startAt).toBe(row.value);
      expect(new Date(row.evidence.source_startAt).toISOString()).toBe(row.value);
      expect(hashes.has(row.source_sha256)).toBe(true);
    }
  });

  it("every contest has at most one explicit default standings source", () => {
    for (const contest of catalog.contests) {
      expect(contest.sources.filter((s: any) => s.is_default).length, "Only one explicit default standings source").toBeLessThanOrEqual(1);
    }
  });
});

// Metadata is a separate reviewed problem-level enrichment, never a member-status import.
describe("XCPC Rating metadata review (2026-10-01)", () => {
  it("approved matches identify the problem by title and record the source", () => {
    expect(rating.review.status).toBe("approved");
    expect(rating.source_sha256).toMatch(SHA256);
    for (const match of rating.matches) {
      const problem = problems.get(match.problem_id);
      expect(problem).toBeTruthy();
      expect([problem.title, ...(problem.aliases ?? []), ...problem.sources.map((s: any) => s.source_title)].some((t) => normalizeTitle(t) === normalizeTitle(match.title))).toBe(true);
      expect(problem.sources.some((s: any) => s.provider === "xcpc_rating" && s.provider_problem_id === `${match.contest_slug}:${match.ordinal}`)).toBe(true);
      for (const tag of match.tags) {
        expect(problem.tags.includes(tag) || ratingRefresh.tag_changes.some((r: any) => r.problem_id === problem.problemId && r.removed.includes(tag))).toBe(true);
      }
    }
  });

  it("added rating values are unique per problem and conflicting ratings stay unset", async () => {
    const values = await readJson("fixtures/imports/xcpc-rating/2026-10-01-rating-values.json");
    expect(values.source_sha256).toBe(rating.source_sha256);
    for (const row of values.added) {
      expect(row.previous_value).toBe(null);
      expect(Number.isFinite(row.value) && row.value >= 0).toBe(true);
      expect(problems.get(row.problem_id).rating).toBe(latestRating(row.problem_id, row.value));
      expect([...new Set(row.sources.map((s: any) => s.value))]).toStrictEqual([row.value]);
      for (const source of row.sources) {
        expect(rating.matches.some((m: any) => m.problem_id === row.problem_id && `${m.contest_slug}:${m.ordinal}` === source.source_identity)).toBe(true);
      }
    }
    for (const row of values.conflicts) {
      expect(new Set(row.sources.map((s: any) => s.value)).size).toBeGreaterThan(1);
      expect(problems.get(row.problem_id).rating, "Conflicting ratings must not be guessed").toBe(undefined);
    }
  });

  it("numeric-only identity values require complete provider IDs and verified original contests", async () => {
    const numericReview = await readJson("fixtures/imports/xcpc-rating/2026-10-01-numeric-identity-review.json");
    const numericValues = await readJson("fixtures/imports/xcpc-rating/2026-10-01-numeric-identity-values.json");
    expect(numericReview.review.status).toBe("approved");
    expect(numericValues.source_sha256).toBe(numericReview.source_sha256);
    expect(numericValues.input_catalog_sha256).toBe(numericReview.catalog_sha256);
    expect(numericValues.changes).toHaveLength(205);
    for (const row of numericValues.changes) {
      expect(row.previous_value).toBe(null);
      expect(Number.isFinite(row.value) && row.value >= 0).toBe(true);
      const problem = problems.get(row.problem_id), contest = contests.get(row.contest_id);
      expect(problem.contestId).toBe(contest.contestId);
      expect(problem.rating).toBe(latestRating(row.problem_id, row.value));
      expect([...new Set(row.sources.map((s: any) => s.value))]).toStrictEqual([row.value]);
      for (const source of row.sources) {
        const match = numericReview.matches.find((m: any) => m.problem_id === row.problem_id && `${m.contest_slug}:${m.ordinal}` === source.source_identity);
        expect(match?.evidence).toBe("complete_provider_ids_and_verified_original_contest");
        expect(contest.sources.some((s: any) => s.provider === "rankland" && s.kind === "standings" && s.provider_contest_id === source.original_source_id)).toBe(true);
        expect(Date.parse(contest.startAt)).toBe(Date.parse(source.original_start_at));
        expect(problem.sources.some((s: any) => problemIdentity(s.url) && problemIdentity(s.url) === problemIdentity(source.provider_problem_url))).toBe(true);
        const metadata = problem.sources.find((s: any) => s.provider === "xcpc_rating" && s.provider_problem_id === source.source_identity);
        expect(metadata).toBeTruthy();
        expect(metadata.source_title, "Do not manufacture missing upstream titles").toBe(undefined);
        const full = numericReview.matches.filter((m: any) => m.contest_slug === match.contest_slug && problems.get(m.problem_id)?.contestId === contest.contestId);
        expect(new Set(full.map((m: any) => m.problem_id)).size).toBe(contest.problemIds.length);
        expect(new Set(full.map((m: any) => problemIdentity(m.problem_url))).size).toBe(contest.problemIds.length);
      }
    }
  });

  it("CF problem-list completion fixture and reviewed alias", async () => {
    const cf = await readJson("fixtures/imports/codeforces/2026-10-01-problem-lists.json");
    expect(cf).toHaveLength(4);
    expect(cf.reduce((sum: number, c: any) => sum + c.problems.length, 0)).toBe(49);
    expect(problems.get("ea3a1d82-1043-5335-9e46-965624960072:B").aliases).toStrictEqual(["Beats"]);
  });
});

describe("full XCPC Rating refresh", () => {
  it("has an approved, hashed and applied receipt", () => {
    expect(ratingRefresh.review.status).toBe("approved");
    expect(ratingRefresh.source_sha256).toMatch(SHA256);
    expect(ratingRefresh.previous_source_sha256).toMatch(SHA256);
    expect(Number.isFinite(Date.parse(ratingRefresh.applied_at))).toBe(true);
  });

  it("tag changes are source-owned replacements/removals that preserve other tags", () => {
    for (const row of ratingRefresh.tag_changes) {
      expect(problems.get(row.problem_id).tags).toStrictEqual(row.value);
      expect(row.previous_value.filter((t: string) => !row.value.includes(t))).toStrictEqual(row.removed);
      expect(row.value.filter((t: string) => !row.previous_value.includes(t))).toStrictEqual(row.added);
      for (const removed of row.removal_ownership) {
        expect(removed.source_identities.length).toBeGreaterThan(0);
        for (const owner of removed.source_identities) {
          expect(ratingRefresh.inspected.matches.some((m: any) => m.problem_id === row.problem_id && `${m.contest_slug}:${m.ordinal}` === owner && m.status === "classified" && m.evidence !== "complete_provider_ids_and_verified_original_contest" && !m.tags.includes(removed.tag))).toBe(true);
        }
      }
      for (const tag of row.preserved_other_tags) expect(row.value).toContain(tag);
    }
  });

  it("rating changes are published and direct-source conflicts are withdrawn", () => {
    for (const row of ratingRefresh.rating_changes) {
      expect(problems.get(row.problem_id).rating).toBe(row.value ?? undefined);
      if (row.action === "withdraw_conflict") {
        expect(new Set(row.sources.map((s: any) => s.value)).size).toBeGreaterThan(1);
        expect(row.previous_evidence.some((s: any) => s.value === row.previous_value)).toBe(true);
      } else {
        expect(Number.isFinite(row.value)).toBe(true);
        expect([...new Set(row.sources.map((s: any) => s.value))]).toStrictEqual([row.value]);
      }
    }
  });
});

describe("additional primary awards, CCPC presets and QOJ standings receipts", () => {
  // Later factual source additions keep their historical receipts, with the latest
  // reviewed value taking precedence rather than erasing earlier evidence.
  it("stage-2 award changes and removals resolve to the latest reviewed value", () => {
    for (const row of stage2AwardReview.changes) expect(contests.get(row.contest_id)[row.field]).toStrictEqual(latestAwardValue(row.contest_id, row.field, row.value));
    for (const row of stage2AwardReview.removed) expect(contests.get(row.contest_id)[row.field]).toStrictEqual(latestAwardValue(row.contest_id, row.field, undefined));
  });

  it("WF2018 official awards recompute from eligible rows", async () => {
    const official = await readJson("fixtures/imports/additional-sources/2026-10-01-official-awards.json");
    const wf = official.wf2018;
    expect(wf.eligibleRows).toHaveLength(140);
    expect(wf.reviewEvidence.medalCounts).toStrictEqual({ gold: 4, silver: 4, bronze: 5 });
    for (const row of wf.eligibleRows) {
      const accepted = row.problems.filter((p: any) => p.status === "accepted");
      expect(accepted.length).toBe(row.solved);
      expect(accepted.reduce((sum: number, p: any) => sum + p.acceptedAtMinutes + 20 * (p.tries - 1), 0)).toBe(row.penalty);
    }
    for (const [medal, cutoff] of Object.entries<any>(wf.proposedAwardCutoffs.cutoffs)) {
      const boundary = wf.eligibleRows[cutoff.rank - 1], next = wf.eligibleRows[cutoff.rank];
      expect(boundary.teamId).toBe(cutoff.teamId);
      expect(boundary.solved).toBe(cutoff.solved);
      expect(boundary.penalty).toBe(cutoff.penalty);
      expect(!next || boundary.solved !== next.solved || boundary.penalty !== next.penalty).toBe(true);
      expect(wf.awardedRows.filter((r: any) => r.medal === medal).length).toBe(wf.reviewEvidence.medalCounts[medal]);
    }
  });

  it("school-ranked Final2020 has no generic team-ratio cutoff", () => {
    expect(contests.get("78427c9a-afa5-504f-a09d-576afe16f691").awardCutoffs, "School-ranked Final2020 cannot regain a generic team-ratio cutoff").toBe(undefined);
  });

  it("CCPC presets are explicit ceil 10/30/60% cutoffs without boundary ties", async () => {
    const presets = await readJson("fixtures/imports/additional-sources/2026-10-01-ccpc-presets.json");
    expect(presets.changes).toHaveLength(13);
    for (const row of presets.changes) {
      expect(row.value.source).toBe("explicit");
      expect(contests.get(row.contest_id).awardCutoffs).toStrictEqual(latestAwardValue(row.contest_id, "awardCutoffs", row.value));
      expect(Object.values(row.value.cutoffs).map((c: any) => c.rank)).toStrictEqual([1, 3, 6].map((n) => Math.ceil(row.evidence.effectiveTeamCount * n / 10)));
      expect(row.evidence.boundary.every((b: any) => b.sameSolvedPenaltyAcrossBoundary === false)).toBe(true);
      for (const file of Object.values<any>(row.source_files)) expect(file.sha256).toMatch(SHA256);
    }
  });

  it("QOJ standings review: approved identities map every problem; the unresolved contest stays empty", async () => {
    const qojReview = await readJson("fixtures/imports/qoj/2026-10-01-standings-review.json");
    for (const [url, row] of Object.entries<any>(qojReview.entries)) {
      const contest = contests.get(row.contest_id);
      expect(contest.sources.some((s: any) => s.provider === "qoj" && s.url === url)).toBe(true);
      if (row.identity_status === "approved") {
        expect(row.problem_identity).toHaveLength(contest.problemIds.length);
        for (const match of row.problem_identity) {
          expect(match.ordinal).toBe(match.srk_ordinal);
          expect(match.qoj_problem_id).toBe(match.srk_problem_id);
          const problem = problems.get(contest.problemIds.find((id: string) => problems.get(id).ordinal === match.ordinal));
          expect(problem.sources.some((s: any) => s.provider === "qoj" && s.provider_problem_id === match.qoj_problem_id)).toBe(true);
        }
        expect(contest.awardCutoffs.source).toBe("explicit");
      } else {
        expect(url).toBe("https://qoj.ac/contest/3934");
        expect(contest.awardCutoffs).toBe(undefined);
        expect(contest.startAt).toBe(null);
        expect(contest.sources.some((s: any) => s.provider === "rankland")).toBe(false);
      }
    }
  });
});

describe("full-source capture and explicit-award refresh", () => {
  it("all 13 new/corrected explicit awards recompute from eligible rows and configured medals", async () => {
    const fullAwards = await readJson("fixtures/imports/catalog-completion/2026-10-01-full-award-refresh.json");
    expect(fullAwards.review.status).toBe("approved");
    expect(fullAwards.changes).toHaveLength(13);
    expect(fullAwards.changes.filter((r: any) => r.previous_value === null)).toHaveLength(4);
    for (const row of fullAwards.verified) {
      expect(contests.get(row.contest_id).awardCutoffs).toStrictEqual(row.value);
      expect(row.eligible_rows.length).toBe(row.value.eligibleTeamCount);
      expect(new Set(row.eligible_rows.map((t: any) => t.id)).size).toBe(row.eligible_rows.length);
      expect(row.evidence.ties).toBe("No tied medal boundary");
      const medal = row.evidence.explicit_medal_config;
      const ranks = medal === "ccpc"
        ? [1, 3, 6].map((n) => Math.ceil(row.evidence.scored_count * n / 10))
        : [medal[row.evidence.group].gold, medal[row.evidence.group].gold + medal[row.evidence.group].silver, Object.values<number>(medal[row.evidence.group]).reduce((n, v) => n + v, 0)];
      expect(Object.values(row.value.cutoffs).map((c: any) => c.rank)).toStrictEqual(ranks);
      for (const cutoff of Object.values<any>(row.value.cutoffs)) {
        const r = row.eligible_rows[cutoff.rank - 1], next = row.eligible_rows[cutoff.rank];
        expect(r.solved).toBe(cutoff.solved);
        expect(r.penalty).toBe(cutoff.penalty);
        expect(!next || r.solved !== next.solved || r.penalty !== next.penalty).toBe(true);
        expect(row.eligible_rows.slice(0, cutoff.rank).some((r: any) => r.id === cutoff.teamId && r.solved === cutoff.solved && r.penalty === cutoff.penalty)).toBe(true);
      }
      for (const f of row.source_files) {
        expect(f.sha256).toMatch(SHA256);
        expect(f.url.startsWith("https://")).toBe(true);
        expect(Number.isFinite(Date.parse(f.fetched_at))).toBe(true);
      }
    }
  });

  it("full-source capture lists 747 unique sources with 295 verified mappings", async () => {
    const refreshedSources = await readJson("fixtures/imports/catalog-completion/2026-10-01-source-refresh.json");
    expect(refreshedSources.sources).toHaveLength(747);
    expect(new Set(refreshedSources.sources.map((s: any) => s.url)).size).toBe(747);
    expect(refreshedSources.summary.verified_source_mappings).toBe(295);
    for (const source of refreshedSources.sources) if (source.sha256) expect(source.sha256).toMatch(SHA256);
  });
});
