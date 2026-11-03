import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { problemIdentity, readJson, sha256 } from "../../scripts/source-import-lib.mjs";

const catalog = await readJson("catalog/default-catalog.min.json");
const rawPath = "fixtures/imports/qoj/2026-11-02-changchun-xian-browser-export.json";
const raw = await readJson(rawPath);
const reviewed = await readJson("fixtures/imports/qoj/2026-11-02-changchun-xian-reviewed.json");
const standings = await readJson("fixtures/imports/rankland/2026-11-02-changchun-xian.json");
const ratingPath = "fixtures/imports/xcpc-rating/2026-11-02-changchun-xian-rows.json";
const ratings = await readJson(ratingPath);
const ratingReview = await readJson("fixtures/imports/xcpc-rating/2026-11-02-changchun-xian-review.json");

describe("Changchun/Xi'an 2026 catalog additions", () => {
  it("binds the reviews to the unchanged user export and exact Rating rows", async () => {
    expect(reviewed.review.status).toBe("approved");
    expect(reviewed.review.raw_sha256).toBe(sha256(await readFile(rawPath)));
    expect(ratingReview.review.status).toBe("approved");
    expect(ratingReview.source_sha256).toBe(sha256(await readFile(ratingPath)));
    expect(standings.rating_reviewed_subset_sha256).toBe(ratingReview.source_sha256);
    expect(raw).toHaveLength(2);
    expect(ratings).toHaveLength(26);
    expect(ratingReview.matches).toHaveLength(26);
    expect(ratingReview.unresolved).toHaveLength(0);
  });

  it("publishes complete one-to-one QOJ identities with the reviewed original date and page", () => {
    for (const entry of reviewed.contests) {
      const input = raw.find((row: any) => row.url === entry.url);
      const evidence = standings.contests.find((row: any) => row.qoj_url === entry.url);
      const contest = catalog.contests.find((row: any) => row.contestId === entry.target_contest.contest_id);
      expect(entry.problems).toStrictEqual(input.problems);
      expect(input.fetched_url).toBe(input.url);
      expect(input.source_title).toBe("QOJ.ac");
      expect(contest.title).toBe(evidence.source_title);
      expect(contest.aliases).not.toContain("QOJ.ac");
      expect(contest.startAt).toBe(new Date(evidence.start_at).toISOString());
      expect(evidence.page_verified).toBe(true);
      expect(evidence.srk_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(evidence.page_info_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(contest.sources.find((s: any) => s.is_default)?.url).toBe(evidence.page_url);
      expect(contest.problemIds).toHaveLength(13);
      expect(entry.problems.map((p: any) => p.ordinal).join("")).toBe("ABCDEFGHIJKLM");
      for (const exported of entry.problems) {
        const owners = catalog.problems.filter((p: any) => p.sources.some((s: any) =>
          s.provider === "qoj" && problemIdentity(s.url) === problemIdentity(exported.url),
        ));
        expect(owners).toHaveLength(1);
        const problem = owners[0];
        expect(problem.contestId).toBe(contest.contestId);
        expect(problem.ordinal).toBe(exported.ordinal);
        expect(problem.title).toBe(exported.title);
        expect(problem.sources.find((s: any) => s.provider === "qoj").provider_problem_id).toBe(exported.provider_problem_id);
        expect(evidence.problems.find((p: any) => p.ordinal === exported.ordinal)).toStrictEqual({
          ordinal: exported.ordinal, title: exported.title, url: exported.url,
        });
      }
    }
  });

  it("uses exact title/ID Rating matches and keeps unknown classifications untagged", () => {
    for (const match of ratingReview.matches) {
      expect(match.evidence).toBe("provider_problem_id_and_title");
      const row = ratings.find((r: any) => r.contestSlug === match.contest_slug && r.alias === match.ordinal);
      const problem = catalog.problems.find((p: any) => p.problemId === match.problem_id);
      const contest = catalog.contests.find((c: any) => c.contestId === problem.contestId);
      expect(row.title).toBe(problem.title);
      expect(problem.sources.some((s: any) => s.provider === "qoj" && s.url === row.problemUrl)).toBe(true);
      expect(Date.parse(row.startAt)).toBe(Date.parse(contest.startAt));
      expect(Number.isFinite(problem.rating) && problem.rating >= 0).toBe(true);
      expect(problem.rating).toBe(row.problemRating);
      expect(row.status).toBe("unknown");
      expect(row.detailTags).toStrictEqual([]);
      expect(problem.tags).toStrictEqual([]);
      expect(problem.sources.some((s: any) => s.provider === "xcpc_rating" &&
        s.provider_problem_id === `${match.contest_slug}:${match.ordinal}` && s.source_title === row.title,
      )).toBe(true);
    }
  });

  it("accepts Changchun's verified boundaries and Xi'an's specifically confirmed bronze team", () => {
    const changchun = standings.contests.find((c: any) => c.qoj_url.endsWith("/4582"));
    expect(changchun.sorter.config.extendedAlgorithms[0].algorithm).toBe("CCPC26");
    expect(changchun.sorter.config.rankingTimePrecision).toBe("min");
    expect(changchun.award_decision.status).toBe("approved");
    const contest = catalog.contests.find((c: any) => c.contestId === changchun.contest_id);
    expect(contest.awardCutoffs).toStrictEqual(changchun.award_decision.value);
    expect(contest.awardCutoffs.source).toBe("explicit");
    expect(contest.awardCutoffs.eligibleTeamCount).toBe(301);
    expect(["gold", "silver", "bronze"].map(m => contest.awardCutoffs.cutoffs[m].solved)).toStrictEqual([7, 6, 4]);
    const boundaries = changchun.award_decision.evidence.boundaries;
    expect(boundaries.map((b: any) => b.rank)).toStrictEqual([30, 90, 180]);
    for (const boundary of boundaries) {
      expect(boundary.ranking_penalty_minutes).toBe(Math.floor(boundary.raw_penalty_minutes));
      expect(boundary.boundary_tie).toBe(false);
      expect(boundary.next_solved < boundary.solved ||
        boundary.next_ranking_penalty_minutes > boundary.ranking_penalty_minutes).toBe(true);
    }
    const xian = standings.contests.find((c: any) => c.qoj_url.endsWith("/4593"));
    const xianContest = catalog.contests.find((c: any) => c.contestId === xian.contest_id);
    expect(xian.award_decision.status).toBe("approved");
    expect(xianContest.awardCutoffs).toStrictEqual(xian.award_decision.value);
    expect(xianContest.awardCutoffs.source).toBe("explicit");
    expect(xianContest.awardCutoffs.eligibleTeamCount).toBe(402);
    expect(["gold", "silver", "bronze"].map(m => xianContest.awardCutoffs.cutoffs[m].solved)).toStrictEqual([4, 4, 3]);
    expect(xianContest.awardCutoffs.cutoffs.bronze).toStrictEqual({
      rank: 246, teamId: "Team291", solved: 3, penalty: 736,
    });
    expect(xianContest.estimatedAwardCutoffs).toBeUndefined();
    expect(xian.calculator_proposal.reason).toContain("Tied medal boundary");
    const resolution = xian.award_decision.tie_resolution;
    expect(resolution.authority).toBe("user_confirmation_in_conversation");
    expect(resolution.statement).toBe("实际上是韶关获奖");
    expect(resolution.awarded_team_id).toBe("Team291");
    expect(resolution.awarded_organization).toBe("韶关学院");
    expect(resolution.tied_team_ids).toStrictEqual(["Team291", "Team049"]);
    expect(xian.award_decision.superseded_decision.status).toBe("withheld");
    const report = xian.boundary_report;
    expect(report.eligible_official_teams).toBe(402);
    expect(report.award_config).toStrictEqual({ value: [41, 82, 123], noTied: true });
    expect(report.boundaries.map((b: any) => b.tie_crosses_quota)).toStrictEqual([false, false, true]);
    const bronze = report.boundaries[2];
    expect(bronze.cumulative_quota).toBe(246);
    expect(bronze.exact_tie_rows_in_source_order.map((r: any) => r.team_id)).toStrictEqual(["Team291", "Team049"]);
    for (const row of bronze.exact_tie_rows_in_source_order) {
      expect(row.solved).toBe(3);
      expect(row.penalty_minutes).toBe(736);
    }
  });
});
