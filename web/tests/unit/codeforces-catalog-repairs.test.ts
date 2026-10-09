import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256 } from "../../../scripts/source-import-lib.mjs";
import { loadHistoricalRepairs } from "./fixtures/cf-historical-repairs";

const adapter = vi.hoisted(() => ({ snapshot: null as any, written: null as any }));
vi.mock("../../src/lib/catalog-runtime", () => ({ listRuntimeCatalogProblemsForImport: async () => adapter.snapshot.problems }));
vi.mock("../../src/lib/codeforces-auth", () => ({ loadCodeforcesApiCredentials: () => null }));
vi.mock("../../src/lib/local-db", () => ({
  localDb: { syncRecords: { toArray: async () => [] } },
  captureMemberSyncGuard: async () => ({}),
  validateMemberSyncGuard: async () => {},
  upsertMemberBundle: async (bundle: unknown) => { adapter.written = bundle; },
}));

import { importCodeforcesMember } from "../../src/lib/codeforces";

const { catalog, review, lists, byId } = loadHistoricalRepairs();
const normalizedTitle = (title: string) => title.normalize("NFKC").replaceAll("’", "'").replace(/\s+/g, " ").trim();
const owners = (snapshot: any, sourceId: string) => snapshot.problems.filter((problem: any) =>
  problem.sources.some((source: any) => source.provider === "codeforces" && source.provider_problem_id === sourceId));

/** Every reviewed CF source ID and the problem it must map to. */
const cases: Array<{ sourceId: string; expected: string }> = [
  ...review.original_identity.flatMap((contest: any) => contest.problems.map((proof: any) => ({
    sourceId: proof.cf_problem.providerProblemId, expected: proof.problem_id,
  }))),
  ...review.withdrawals.map((withdrawal: any) => ({ sourceId: withdrawal.wrongSource.provider_problem_id, expected: withdrawal.retainOwner })),
];

describe("CF historical mapping repairs (2026-10-02)", () => {
  it("records the reviewed counts and leaves non-CF fields of affected problems unchanged", () => {
    expect(review.counts).toEqual({ source_withdrawals: 11, source_reassignments: 7, false_alias_removals: 18, affected_problems: 18 });
    expect(review.before_problems).toHaveLength(18);
    expect(review.after_problems).toHaveLength(18);
    for (const after of review.after_problems) expect(byId.get(after.problemId)).toEqual(after);
    for (const before of review.before_problems) {
      const after = byId.get(before.problemId);
      for (const key of Object.keys(before).filter((key) => !["sources", "aliases"].includes(key))) {
        expect(after[key], `${before.problemId}: preserve ${key}`).toEqual(before[key]);
      }
      expect(after.sources.filter((source: any) => source.provider !== "codeforces"))
        .toEqual(before.sources.filter((source: any) => source.provider !== "codeforces"));
    }
  });

  it("proves original identities against booklets, QOJ sources and exported CF lists", () => {
    for (const contest of review.original_identity) {
      const list = lists.find((list) => list.url === `https://codeforces.com/gym/${contest.cf_contest_id}`);
      expect(list.problems).toHaveLength(contest.problem_count);
      expect(contest.problems).toHaveLength(contest.problem_count);
      expect(new Set(list.problems.map((problem: any) => problem.provider_problem_id)).size).toBe(contest.problem_count);
      expect(contest.original_booklet.sha256).toMatch(/^[a-f0-9]{64}$/);
      for (const proof of contest.problems) {
        const problem = byId.get(proof.problem_id);
        expect(problem.title).toBe(proof.title);
        expect(problem.ordinal).toBe(proof.original_ordinal);
        expect(Number.isInteger(proof.original_pdf_page) && proof.original_pdf_page > 0).toBe(true);
        expect(problem.sources.some((source: any) => source.provider === "qoj"
          && source.provider_problem_id === proof.qoj_problem.provider_problem_id)).toBe(true);
        const exported = list.problems.find((row: any) => row.provider_problem_id === proof.cf_problem.providerProblemId);
        expect(exported.url).toBe(proof.cf_problem.url);
        expect(exported.title).toBe(proof.cf_problem.title);
        expect(normalizedTitle(exported.title)).toBe(normalizedTitle(proof.title));
        expect(owners(catalog, exported.provider_problem_id).map((owner: any) => owner.problemId)).toEqual([proof.problem_id]);
      }
    }
  });

  it("withdraws false sources/aliases and reassigns sources to their owners", () => {
    for (const withdrawal of review.withdrawals) {
      const problem = byId.get(withdrawal.removeFrom);
      expect(problem.aliases).not.toContain(withdrawal.removeFalseAlias);
      expect(owners(catalog, withdrawal.wrongSource.provider_problem_id).map((owner: any) => owner.problemId)).toEqual([withdrawal.retainOwner]);
      expect(problem.sources.some((source: any) => JSON.stringify(source) === JSON.stringify(withdrawal.retainCorrectSource))).toBe(true);
    }
    for (const reassignment of review.reassignments) {
      expect(byId.get(reassignment.from_problem_id).aliases).not.toContain(reassignment.removed_false_alias);
      expect(owners(catalog, reassignment.provider_problem_id).map((owner: any) => owner.problemId)).toEqual([reassignment.to_problem_id]);
    }
    expect(cases).toHaveLength(49);
  });

  describe("the real CF member adapter", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("maps all 49 sources correctly and reproduces the 18 historical failures on the before-state", async () => {
      // A corrected catalog changes future matches; no historical status migration runs.
      let upstream: { contestId: number; index: string } | undefined;
      vi.stubGlobal("navigator", undefined);
      vi.stubGlobal("fetch", async (url: string) => {
        const parsed = new URL(url);
        expect(parsed.origin).toBe("https://codeforces.com");
        expect(parsed.pathname).toBe("/api/user.status");
        expect(parsed.searchParams.get("handle")).toBe("synthetic_validation_account");
        expect(parsed.searchParams.has("apiKey")).toBe(false);
        return { ok: true, json: async () => ({ status: "OK", result: [{ id: 1, verdict: "OK", problem: upstream }] }) };
      });
      const before = structuredClone(catalog);
      for (const row of review.before_problems) before.problems[before.problems.findIndex((problem: any) => problem.problemId === row.problemId)] = row;
      const originalHash = sha256(JSON.stringify(catalog));

      let priorWrong = 0;
      for (const test of cases) {
        const [contestId, index] = test.sourceId.split(":");
        upstream = { contestId: Number(contestId), index };
        for (const candidate of [catalog, before]) {
          adapter.snapshot = candidate;
          adapter.written = null;
          await importCodeforcesMember({ memberId: "synthetic-member", handle: "synthetic_validation_account" });
          const actual = adapter.written.statuses.map((status: any) => status.problemId).sort();
          if (candidate === catalog) expect(actual, test.sourceId).toEqual([test.expected]);
          else if (JSON.stringify(actual) !== JSON.stringify([test.expected])) priorWrong++;
        }
      }
      expect(priorWrong, "Negative control must reproduce all 18 historical mapping failures").toBe(18);
      expect(sha256(JSON.stringify(catalog))).toBe(originalHash);
    });
  });
});
