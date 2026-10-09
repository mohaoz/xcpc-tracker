import type {
  LocalCatalogContestRecord,
  LocalCatalogProblemRecord,
  LocalMemberHandleRecord,
  LocalMemberProblemStatusRecord,
  LocalMemberRecord,
} from "../../../src/lib/local-model";

export const member = (memberId: string, deletedAt: string | null = null) =>
  ({ memberId, displayName: memberId, createdAt: "2026-01-01", updatedAt: "2026-01-01", deletedAt }) as LocalMemberRecord;

export const handle = (memberId: string, provider: string, deletedAt: string | null = null) =>
  ({
    memberId, provider, handleId: `${memberId}:${provider}`, handle: memberId, displayLabel: null,
    createdAt: "2026-01-01", updatedAt: "2026-01-01", deletedAt,
  }) as LocalMemberHandleRecord;

export const status = (
  memberId: string, problemId: string, provider: string, state: "solved" | "attempted", lastSeenAt = "2026-01-01",
) => ({ memberId, problemId, provider, status: state, lastSeenAt }) as LocalMemberProblemStatusRecord;

export const contest = (contestId: string, ids: string[]) => ({
  contest: {
    contestId, title: contestId, tags: [], aliases: [], sources: [], curationStatus: "reviewed", problemIds: ids,
  } as unknown as LocalCatalogContestRecord,
  problems: ids.map((problemId, i) => ({
    problemId, contestId, title: problemId, ordinal: String(i + 1), aliases: [], sources: [],
  })) as LocalCatalogProblemRecord[],
});

/** Two active members with overlapping providers plus deleted/orphan rows. */
export function coverageRecords() {
  return {
    members: [member("alice"), member("bob"), member("deleted", "2026-01-01")],
    memberHandles: [handle("alice", "qoj"), handle("alice", "codeforces"), handle("bob", "qoj", "2026-01-01")],
    memberProblemStatus: [
      status("alice", "p1", "qoj", "attempted"),
      status("alice", "p1", "codeforces", "solved"),
      status("alice", "p1", "manual", "attempted"),
      status("alice", "p2", "qoj", "attempted", "2026-02-01"),
      status("bob", "p2", "qoj", "solved", "2026-03-01"),
      status("bob", "p3", "manual", "solved"),
      status("deleted", "p4", "manual", "solved"),
      status("missing", "p4", "manual", "solved"),
    ],
  };
}

export const coveragePayload = () => [contest("c1", ["p1", "p2", "p3", "p4"]), contest("shared", ["p1"]), contest("empty", [])];
