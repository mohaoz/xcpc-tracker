import type {
  LocalCatalogContestRecord,
  LocalCatalogProblemRecord,
  LocalContestCoverage,
  LocalContestCoverageSummary,
  LocalMemberHandleRecord,
  LocalMemberPerson,
  LocalMemberProblemStatusRecord,
  LocalMemberRecord,
} from "./local-model";

type ProblemStatus = "solved" | "attempted";

export type MemberCoverageInput = {
  members: LocalMemberPerson[];
  statusByMember: Map<string, Map<string, ProblemStatus>>;
};

export type ContestCoverageInput = {
  contest: LocalCatalogContestRecord;
  problems: LocalCatalogProblemRecord[];
};

export function buildMemberCoverageInput(
  members: LocalMemberRecord[],
  handles: LocalMemberHandleRecord[],
  statuses: LocalMemberProblemStatusRecord[],
): MemberCoverageInput {
  const activeMembers = members.filter((member) => !member.deletedAt);
  const activeMemberIds = new Set(activeMembers.map((member) => member.memberId));
  const handlesByMember = new Map<string, LocalMemberHandleRecord[]>();
  const providersByMember = new Map<string, Set<string>>();
  const statusByMember = new Map<string, Map<string, ProblemStatus>>();
  const lastSyncedByMember = new Map<string, string>();

  for (const handle of handles) {
    if (handle.deletedAt || !activeMemberIds.has(handle.memberId)) continue;
    const bucket = handlesByMember.get(handle.memberId) ?? [];
    bucket.push(handle);
    handlesByMember.set(handle.memberId, bucket);
    const providers = providersByMember.get(handle.memberId) ?? new Set<string>();
    providers.add(handle.provider);
    providersByMember.set(handle.memberId, providers);
  }

  for (const status of statuses) {
    if (!activeMemberIds.has(status.memberId)) continue;
    if (status.provider !== "manual" && !providersByMember.get(status.memberId)?.has(status.provider)) continue;
    const byProblem = statusByMember.get(status.memberId) ?? new Map<string, ProblemStatus>();
    if (byProblem.get(status.problemId) !== "solved") {
      byProblem.set(status.problemId, status.status);
    }
    statusByMember.set(status.memberId, byProblem);
    if (status.lastSeenAt > (lastSyncedByMember.get(status.memberId) ?? "")) {
      lastSyncedByMember.set(status.memberId, status.lastSeenAt);
    }
  }

  return {
    statusByMember,
    members: activeMembers.map((member) => {
      const memberHandles = (handlesByMember.get(member.memberId) ?? [])
        .sort((left, right) => left.handle.localeCompare(right.handle));
      const memberStatuses = [...(statusByMember.get(member.memberId)?.values() ?? [])];
      return {
        memberId: member.memberId,
        displayName: member.displayName,
        providerCount: providersByMember.get(member.memberId)?.size ?? 0,
        handleCount: memberHandles.length,
        solvedCount: memberStatuses.filter((status) => status === "solved").length,
        attemptedCount: memberStatuses.filter((status) => status === "attempted").length,
        lastSyncedAt: lastSyncedByMember.get(member.memberId) ?? null,
        handles: memberHandles.map((handle) => ({
          handleId: handle.handleId,
          provider: handle.provider,
          handle: handle.handle,
          displayLabel: handle.displayLabel,
          updatedAt: handle.updatedAt,
        })),
      };
    }).sort((left, right) => left.displayName.localeCompare(right.displayName)),
  };
}

export function buildContestCoverage(
  { contest, problems }: ContestCoverageInput,
  input: MemberCoverageInput,
  options?: { memberIds?: string[] },
): LocalContestCoverage {
  const selectedIds = options?.memberIds ? new Set(options.memberIds) : null;
  const members = selectedIds ? input.members.filter((member) => selectedIds.has(member.memberId)) : input.members;
  const problemRows = problems.map((problem) => {
    const memberRows = members.map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      status: input.statusByMember.get(member.memberId)?.get(problem.problemId) ?? "unseen" as const,
    }));
    return {
      problemId: problem.problemId,
      ordinal: problem.ordinal,
      title: problem.title,
      freshForTeam: memberRows.every((member) => member.status === "unseen"),
      members: memberRows,
    };
  });
  return {
    contest,
    trackedMembers: members,
    problemCount: problemRows.length,
    freshProblemCount: problemRows.filter((problem) => problem.freshForTeam).length,
    problems: problemRows,
  };
}

export function summarizeCatalogCoverage(
  payload: ContestCoverageInput[],
  input: MemberCoverageInput,
  options?: { memberIds?: string[] },
): LocalContestCoverageSummary[] {
  const selectedIds = options?.memberIds ?? input.members.map((member) => member.memberId);
  const teamStatusByProblem = new Map<string, ProblemStatus>();
  for (const memberId of selectedIds) {
    for (const [problemId, status] of input.statusByMember.get(memberId) ?? []) {
      if (teamStatusByProblem.get(problemId) !== "solved") {
        teamStatusByProblem.set(problemId, status);
      }
    }
  }

  return payload.filter(({ problems }) => problems.length > 0).map(({ contest, problems }) => {
    const problemStates = problems.map((problem) => ({
      ordinal: problem.ordinal,
      status: teamStatusByProblem.get(problem.problemId) ?? "unseen" as const,
    }));
    return {
      contestId: contest.contestId,
      problemCount: problemStates.length,
      freshProblemCount: problemStates.filter((problem) => problem.status === "unseen").length,
      solvedProblemCount: problemStates.filter((problem) => problem.status === "solved").length,
      attemptedProblemCount: problemStates.filter((problem) => problem.status === "attempted").length,
      problemStates,
    };
  });
}
