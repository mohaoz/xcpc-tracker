import { describe, expect, it } from "vitest";

import { buildContestCoverage, buildMemberCoverageInput, summarizeCatalogCoverage } from "../../src/lib/local-coverage";
import { isContestTouched, shouldShowSpoilers, validatePreferences } from "../../src/lib/spoiler-policy";
import { coveragePayload, coverageRecords } from "./fixtures/coverage";

describe("spoiler policy", () => {
  it("treats an attempt without a solve as touched", () => {
    expect(isContestTouched({ solvedProblemCount: 0, attemptedProblemCount: 1 })).toBe(true);
    expect(isContestTouched({ solvedProblemCount: 0, attemptedProblemCount: 0 })).toBe(false);
  });

  it("defaults to the touched state and lets explicit preferences win", () => {
    expect(shouldShowSpoilers(undefined, false)).toBe(false);
    expect(shouldShowSpoilers(undefined, true)).toBe(true);
    expect(shouldShowSpoilers("non_spoiler", true)).toBe(false);
    expect(shouldShowSpoilers("spoiler", false)).toBe(true);
  });

  it("hides spoilers until preferences are loaded", () => {
    expect(shouldShowSpoilers("spoiler", true, false)).toBe(false);
  });

  it("rejects invalid preference modes", () => {
    expect(() => validatePreferences([{ contest_id: "x", spoiler_mode: "bad" }])).toThrow();
  });
});

describe("member coverage input", () => {
  const records = coverageRecords();
  const input = buildMemberCoverageInput(records.members, records.memberHandles, records.memberProblemStatus);

  it("keeps only active members and statuses from linked providers", () => {
    expect(input.members.map(({ memberId, solvedCount, attemptedCount, lastSyncedAt }) => ({ memberId, solvedCount, attemptedCount, lastSyncedAt })))
      .toEqual([
        { memberId: "alice", solvedCount: 1, attemptedCount: 1, lastSyncedAt: "2026-02-01" },
        { memberId: "bob", solvedCount: 1, attemptedCount: 0, lastSyncedAt: "2026-01-01" },
      ]);
  });

  describe("catalog summaries", () => {
    const payload = coveragePayload();
    const states = (options?: { memberIds?: string[] }) =>
      summarizeCatalogCoverage(payload, input, options)[0].problemStates.map((problem) => problem.status);

    it("merges members with solved taking precedence", () => {
      expect(states()).toEqual(["solved", "attempted", "solved", "unseen"]);
    });

    it("follows the member selection", () => {
      expect(states({ memberIds: ["bob"] })).toEqual(["unseen", "unseen", "solved", "unseen"]);
      expect(states({ memberIds: [] })).toEqual(["unseen", "unseen", "unseen", "unseen"]);
      expect(states({ memberIds: ["deleted", "missing"] })).toEqual(states({ memberIds: [] }));
    });

    it("skips contests without problems and counts shared problems in each contest", () => {
      const summaries = summarizeCatalogCoverage(payload, input);
      expect(summaries).toHaveLength(2);
      expect(summaries[1].solvedProblemCount).toBe(1);
    });
  });

  it("builds a per-problem member matrix", () => {
    const matrix = buildContestCoverage(coveragePayload()[0], input);
    expect(matrix.freshProblemCount).toBe(1);
    expect(matrix.problems[1].members.map((item) => item.status)).toEqual(["attempted", "unseen"]);
  });
});
