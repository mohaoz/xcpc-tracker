import Dexie, { type Table } from "dexie";

import type {
  LocalCatalogContestRecord,
  LocalContestCoverage,
  LocalContestCoverageSummary,
  LocalCatalogProblemRecord,
  LocalDbStatus,
  LocalCatalogSnapshot,
  LocalImportSourceRecord,
  LocalMemberHandleRecord,
  LocalMemberPerson,
  LocalMemberProblemStatusRecord,
  LocalMemberRecord,
  LocalProblemMatchCacheRecord,
  LocalRuntimeSnapshot,
  LocalSyncRecord,
} from "./local-model";

class XcpcTrackerDb extends Dexie {
  catalogContests!: Table<LocalCatalogContestRecord, string>;
  catalogProblems!: Table<LocalCatalogProblemRecord, string>;
  members!: Table<LocalMemberRecord, string>;
  memberHandles!: Table<LocalMemberHandleRecord, string>;
  memberProblemStatus!: Table<LocalMemberProblemStatusRecord, string>;
  importSources!: Table<LocalImportSourceRecord, string>;
  syncRecords!: Table<LocalSyncRecord, string>;
  problemMatchCache!: Table<LocalProblemMatchCacheRecord, string>;

  constructor() {
    super("xcpc_tracker_local");

    this.version(1).stores({
      catalogContests: "contestId, series, season",
      catalogProblems: "problemId, contestId",
      members: "memberId, updatedAt",
      memberHandles: "handleId, memberId, [provider+handle], updatedAt",
      memberProblemStatus: "statusId, memberId, problemId, [memberId+problemId], [provider+problemId], lastSeenAt",
      importSources: "sourceRecordId, kind, importedAt",
      syncRecords: "syncId, adapter, startedAt, sourceRecordId",
      problemMatchCache: "cacheKey, [provider+externalRef], updatedAt",
    });

    this.version(2).stores({
      catalogContests: "contestId",
      catalogProblems: "problemId, contestId",
      members: "memberId, updatedAt",
      memberHandles: "handleId, memberId, [provider+handle], updatedAt",
      memberProblemStatus: "statusId, memberId, problemId, [memberId+problemId], [provider+problemId], lastSeenAt",
      importSources: "sourceRecordId, kind, importedAt",
      syncRecords: "syncId, adapter, startedAt, sourceRecordId",
      problemMatchCache: "cacheKey, [provider+externalRef], updatedAt",
    });

    this.version(3).stores({
      catalogContests: "contestId, deletedAt",
      catalogProblems: "problemId, contestId",
      members: "memberId, updatedAt",
      memberHandles: "handleId, memberId, [provider+handle], updatedAt",
      memberProblemStatus: "statusId, memberId, problemId, [memberId+problemId], [provider+problemId], lastSeenAt",
      importSources: "sourceRecordId, kind, importedAt",
      syncRecords: "syncId, adapter, startedAt, sourceRecordId",
      problemMatchCache: "cacheKey, [provider+externalRef], updatedAt",
    });
  }
}

export const localDb = new XcpcTrackerDb();

export async function replaceCatalogSnapshot(payload: {
  contests: LocalCatalogContestRecord[];
  problems: LocalCatalogProblemRecord[];
  importSource: LocalImportSourceRecord;
  syncRecord: LocalSyncRecord;
}): Promise<void> {
  await localDb.transaction(
    "rw",
    localDb.catalogContests,
    localDb.catalogProblems,
    localDb.importSources,
    localDb.syncRecords,
    async () => {
      await localDb.catalogContests.clear();
      await localDb.catalogProblems.clear();
      await localDb.catalogContests.bulkPut(payload.contests);
      await localDb.catalogProblems.bulkPut(payload.problems);
      await localDb.importSources.put(payload.importSource);
      await localDb.syncRecords.put(payload.syncRecord);
    },
  );
}

export async function refreshGeneratedCatalogSnapshot(payload: {
  contests: LocalCatalogContestRecord[];
  problems: LocalCatalogProblemRecord[];
  importSource: LocalImportSourceRecord;
  syncRecord: LocalSyncRecord;
}): Promise<void> {
  await localDb.transaction(
    "rw",
    localDb.catalogContests,
    localDb.catalogProblems,
    localDb.importSources,
    localDb.syncRecords,
    async () => {
      const existingContests = await localDb.catalogContests.toArray();
      const activeContestIds = new Set(
        existingContests
          .filter((contest) => !contest.deletedAt)
          .map((contest) => contest.contestId),
      );

      if (activeContestIds.size > 0) {
        const missingProblems = payload.problems.filter((problem) => {
          if (!activeContestIds.has(problem.contestId)) {
            return false;
          }
          return true;
        });

        if (missingProblems.length > 0) {
          const existingProblemIds = new Set(
            (await localDb.catalogProblems.toArray()).map((problem) => problem.problemId),
          );
          const nextProblems = missingProblems.filter(
            (problem) => !existingProblemIds.has(problem.problemId),
          );
          if (nextProblems.length > 0) {
            await localDb.catalogProblems.bulkPut(nextProblems);
          }
        }
      }

      await localDb.importSources.put(payload.importSource);
      await localDb.syncRecords.put(payload.syncRecord);
    },
  );
}

export async function listCatalogContestsFromDb(options?: { includeDeleted?: boolean }): Promise<LocalCatalogContestRecord[]> {
  const records = await localDb.catalogContests.toArray();
  const filtered = options?.includeDeleted ? records : records.filter((record) => !record.deletedAt);
  return filtered.sort((left, right) => left.title.localeCompare(right.title));
}

export async function listDeletedCatalogContestIdsFromDb(): Promise<Set<string>> {
  const records = await localDb.catalogContests.toArray();
  return new Set(records.filter((record) => !!record.deletedAt).map((record) => record.contestId));
}

export async function hasDeletedCatalogContestId(contestId: string): Promise<boolean> {
  const contest = await localDb.catalogContests.get(contestId);
  return !!contest?.deletedAt;
}

export async function listCatalogContestIdsFromDb(): Promise<Set<string>> {
  const records = await localDb.catalogContests.toArray();
  return new Set(records.map((record) => record.contestId));
}

export async function listCatalogProblemsFromDb(): Promise<LocalCatalogProblemRecord[]> {
  return localDb.catalogProblems.toArray();
}

export async function listContestProblemsFromDb(contestId: string): Promise<LocalCatalogProblemRecord[]> {
  const records = await localDb.catalogProblems
    .where("contestId")
    .equals(contestId)
    .toArray();
  return records.sort((left, right) => left.ordinal.localeCompare(right.ordinal));
}

export async function getCatalogContestFromDb(contestId: string): Promise<LocalCatalogContestRecord | undefined> {
  const contest = await localDb.catalogContests.get(contestId);
  if (contest?.deletedAt) {
    return undefined;
  }
  return contest;
}

export async function getCatalogContestDetailFromDb(contestId: string): Promise<{
  contest: LocalCatalogContestRecord;
  problems: LocalCatalogProblemRecord[];
} | null> {
  const [contest, problems] = await Promise.all([
    localDb.catalogContests.get(contestId),
    listContestProblemsFromDb(contestId),
  ]);

  if (!contest) {
    return null;
  }
  if (contest.deletedAt) {
    return null;
  }

  return {
    contest,
    problems,
  };
}

export async function upsertCatalogContestRecord(contest: LocalCatalogContestRecord): Promise<void> {
  await localDb.catalogContests.put({
    ...contest,
    deletedAt: contest.deletedAt ?? null,
  });
}

export async function deleteCatalogContestRecord(contestId: string): Promise<void> {
  const contest = await localDb.catalogContests.get(contestId);
  if (!contest) {
    return;
  }
  await localDb.catalogContests.put({
    ...contest,
    deletedAt: new Date().toISOString(),
  });
}

export async function upsertContestProblemSnapshot(payload: {
  contest: LocalCatalogContestRecord;
  problems: LocalCatalogProblemRecord[];
  importSource: LocalImportSourceRecord;
  syncRecord: LocalSyncRecord;
}): Promise<void> {
  await localDb.transaction(
    "rw",
    [
      localDb.catalogContests,
      localDb.catalogProblems,
      localDb.importSources,
      localDb.syncRecords,
    ],
    async () => {
      await localDb.catalogContests.put(payload.contest);
      const existingProblems = await localDb.catalogProblems
        .where("contestId")
        .equals(payload.contest.contestId)
        .toArray();
      const existingIds = existingProblems.map((problem) => problem.problemId);
      if (existingIds.length > 0) {
        await localDb.catalogProblems.bulkDelete(existingIds);
      }
      await localDb.catalogProblems.bulkPut(payload.problems);
      await localDb.importSources.put(payload.importSource);
      await localDb.syncRecords.put(payload.syncRecord);
    },
  );
}

export async function upsertMemberBundle(payload: {
  member: LocalMemberRecord;
  handles: LocalMemberHandleRecord[];
  statuses: LocalMemberProblemStatusRecord[];
  importSource: LocalImportSourceRecord;
  syncRecord: LocalSyncRecord;
}): Promise<void> {
  await localDb.transaction(
    "rw",
    [
      localDb.members,
      localDb.memberHandles,
      localDb.memberProblemStatus,
      localDb.importSources,
      localDb.syncRecords,
    ],
    async () => {
      await localDb.members.put(payload.member);
      await localDb.memberHandles.bulkPut(payload.handles);

      for (const status of payload.statuses) {
        await localDb.memberProblemStatus.put(status);
      }

      await localDb.importSources.put(payload.importSource);
      await localDb.syncRecords.put(payload.syncRecord);
    },
  );
}

export async function getCatalogDbStatus(): Promise<LocalDbStatus> {
  const [
    contests,
    problems,
    contestCount,
    problemCount,
    memberCount,
    handleCount,
    statusCount,
    importSources,
  ] = await Promise.all([
    localDb.catalogContests.toArray(),
    localDb.catalogProblems.toArray(),
    localDb.catalogContests.count(),
    localDb.catalogProblems.count(),
    localDb.members.count(),
    localDb.memberHandles.count(),
    localDb.memberProblemStatus.count(),
    localDb.importSources.toArray(),
  ]);

  const lastCatalogImportAt = importSources
    .filter((item) => item.kind === "catalog")
    .map((item) => item.importedAt)
    .sort()
    .slice(-1)[0] ?? null;

  const activeContests = contests.filter((contest) => !contest.deletedAt);
  const activeContestIds = new Set(activeContests.map((contest) => contest.contestId));
  const activeProblems = problems.filter((problem) => activeContestIds.has(problem.contestId));
  const syncedContestIds = new Set(activeProblems.map((problem) => problem.contestId));

  return {
    contestCount: activeContests.length,
    syncedContestCount: activeContests.filter((contest) => syncedContestIds.has(contest.contestId)).length,
    problemCount: activeProblems.length,
    memberCount,
    handleCount,
    statusCount,
    lastCatalogImportAt,
  };
}

export async function listMemberPeopleFromDb(): Promise<LocalMemberPerson[]> {
  const [members, handles, statuses, importSources] = await Promise.all([
    localDb.members.toArray(),
    localDb.memberHandles.toArray(),
    localDb.memberProblemStatus.toArray(),
    localDb.importSources.toArray(),
  ]);

  return members
    .map((member) => {
      const memberHandles = handles
        .filter((handle) => handle.memberId === member.memberId)
        .sort((left, right) => left.handle.localeCompare(right.handle));
      const memberStatuses = statuses.filter((status) => status.memberId === member.memberId);
      const providerCount = new Set(memberHandles.map((handle) => handle.provider)).size;
      const solvedProblemIds = new Set(
        memberStatuses
          .filter((status) => status.status === "solved")
          .map((status) => status.problemId),
      );
      const attemptedOnlyProblemIds = new Set(
        memberStatuses
          .filter((status) => status.status === "attempted" && !solvedProblemIds.has(status.problemId))
          .map((status) => status.problemId),
      );
      const touchedProblemIds = new Set([
        ...solvedProblemIds,
        ...attemptedOnlyProblemIds,
      ]);
      const latestImportRecords = memberHandles
        .map((handle) => {
          const matchedSources = importSources
            .filter((source) => {
              const importedHandle = source.rawMetaJson.handle;
              if (typeof importedHandle !== "string") {
                return false;
              }
              if (importedHandle.toLocaleLowerCase() !== handle.handle.toLocaleLowerCase()) {
                return false;
              }
              if (handle.provider === "codeforces") {
                return source.kind === "codeforces_api";
              }
              if (handle.provider === "qoj") {
                return source.kind === "qoj_userscript_json";
              }
              return false;
            })
            .sort((left, right) => right.importedAt.localeCompare(left.importedAt));

          const latestSource = matchedSources[0];
          if (!latestSource) {
            return null;
          }

          const totalProblemCountCandidate =
            latestSource.rawMetaJson.normalized_problem_status_count ??
            latestSource.rawMetaJson.total_problem_count ??
            latestSource.rawMetaJson.problem_count;

          return {
            importedAt: latestSource.importedAt,
            totalProblemCount:
              typeof totalProblemCountCandidate === "number" ? totalProblemCountCandidate : 0,
          };
        })
        .filter((record): record is { importedAt: string; totalProblemCount: number } => record !== null);
      const lastSyncedAt = memberStatuses
        .map((status) => status.lastSeenAt)
        .sort()
        .slice(-1)[0] ?? null;
      const totalProblemCount = latestImportRecords.reduce(
        (sum, record) => sum + record.totalProblemCount,
        0,
      );

      return {
        memberId: member.memberId,
        displayName: member.displayName,
        providerCount,
        handleCount: memberHandles.length,
        totalProblemCount,
        solvedCount: solvedProblemIds.size,
        attemptedCount: attemptedOnlyProblemIds.size,
        lastSyncedAt,
        handles: memberHandles.map((handle) => ({
          handleId: handle.handleId,
          provider: handle.provider,
          handle: handle.handle,
          displayLabel: handle.displayLabel,
          updatedAt: handle.updatedAt,
        })),
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function exportLocalRuntimeSnapshot(options?: { includeProblemStatus?: boolean }): Promise<LocalRuntimeSnapshot> {
  const [members, memberHandles, memberProblemStatus, importSources, syncRecords] = await Promise.all([
    localDb.members.toArray(),
    localDb.memberHandles.toArray(),
    localDb.memberProblemStatus.toArray(),
    localDb.importSources.toArray(),
    localDb.syncRecords.toArray(),
  ]);

  return {
    schemaVersion: 1,
    exportKind: "local_runtime_snapshot",
    exportedAt: new Date().toISOString(),
    members,
    memberHandles,
    memberProblemStatus: options?.includeProblemStatus === false ? [] : memberProblemStatus,
    importSources,
    syncRecords,
  };
}

export async function exportLocalCatalogSnapshot(options?: { includeProblems?: boolean }): Promise<LocalCatalogSnapshot> {
  const [contests, problems] = await Promise.all([
    localDb.catalogContests.toArray(),
    localDb.catalogProblems.toArray(),
  ]);
  const activeContests = contests.filter((contest) => !contest.deletedAt);
  const activeContestIds = new Set(activeContests.map((contest) => contest.contestId));
  const includeProblems = options?.includeProblems !== false;

  return {
    schemaVersion: 1,
    exportKind: "local_catalog_snapshot",
    exportedAt: new Date().toISOString(),
    contests: includeProblems
      ? activeContests
      : activeContests.map((contest) => ({
          ...contest,
          problemIds: [],
        })),
    problems:
      !includeProblems
        ? []
        : problems.filter((problem) => activeContestIds.has(problem.contestId)),
  };
}

export async function importLocalCatalogSnapshot(snapshot: LocalCatalogSnapshot): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.catalogContests, localDb.catalogProblems],
    async () => {
      await localDb.catalogContests.clear();
      await localDb.catalogProblems.clear();

      if (snapshot.contests.length) {
        await localDb.catalogContests.bulkPut(snapshot.contests);
      }
      if (snapshot.problems.length) {
        await localDb.catalogProblems.bulkPut(snapshot.problems);
      }
    },
  );
}

export async function mergeLocalCatalogSnapshot(snapshot: LocalCatalogSnapshot): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.catalogContests, localDb.catalogProblems],
    async () => {
      if (snapshot.contests.length) {
        await localDb.catalogContests.bulkPut(snapshot.contests);
      }

      const touchedContestIds = [...new Set(snapshot.contests.map((contest) => contest.contestId))];
      for (const contestId of touchedContestIds) {
        const existingProblems = await localDb.catalogProblems.where("contestId").equals(contestId).toArray();
        if (existingProblems.length) {
          await localDb.catalogProblems.bulkDelete(existingProblems.map((problem) => problem.problemId));
        }
      }

      if (snapshot.problems.length) {
        await localDb.catalogProblems.bulkPut(snapshot.problems);
      }
    },
  );
}

export async function mergeLocalCatalogContestsOnlySnapshot(snapshot: LocalCatalogSnapshot): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.catalogContests],
    async () => {
      if (snapshot.contests.length) {
        await localDb.catalogContests.bulkPut(snapshot.contests);
      }
    },
  );
}

export async function importLocalCatalogContestsOnlySnapshot(snapshot: LocalCatalogSnapshot): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.catalogContests, localDb.catalogProblems],
    async () => {
      await localDb.catalogContests.clear();
      await localDb.catalogProblems.clear();
      if (snapshot.contests.length) {
        await localDb.catalogContests.bulkPut(snapshot.contests);
      }
    },
  );
}

export async function importLocalCatalogProblemsOnlySnapshot(snapshot: LocalCatalogSnapshot): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.catalogContests, localDb.catalogProblems],
    async () => {
      const touchedContestIds = [...new Set(snapshot.problems.map((problem) => problem.contestId))];
      for (const contestId of touchedContestIds) {
        const existingProblems = await localDb.catalogProblems.where("contestId").equals(contestId).toArray();
        if (existingProblems.length) {
          await localDb.catalogProblems.bulkDelete(existingProblems.map((problem) => problem.problemId));
        }
      }

      if (snapshot.problems.length) {
        await localDb.catalogProblems.bulkPut(snapshot.problems);
      }

      for (const contest of snapshot.contests) {
        const existingContest = await localDb.catalogContests.get(contest.contestId);
        if (!existingContest) {
          continue;
        }
        const nextProblemIds = snapshot.problems
          .filter((problem) => problem.contestId === contest.contestId)
          .map((problem) => problem.problemId);
        await localDb.catalogContests.put({
          ...existingContest,
          problemIds: nextProblemIds.length ? nextProblemIds : existingContest.problemIds,
        });
      }
    },
  );
}

export async function applyLocalCatalogSnapshot(
  snapshot: LocalCatalogSnapshot,
  options?: { mode?: "merge" | "replace"; includeProblems?: boolean },
): Promise<void> {
  const mode = options?.mode ?? "merge";
  const includeProblems = options?.includeProblems ?? true;

  if (mode === "replace") {
    if (includeProblems) {
      await importLocalCatalogSnapshot(snapshot);
      return;
    }
    await importLocalCatalogContestsOnlySnapshot(snapshot);
    return;
  }

  if (includeProblems) {
    await mergeLocalCatalogSnapshot(snapshot);
    return;
  }
  await mergeLocalCatalogContestsOnlySnapshot(snapshot);
}

export async function applyLocalRuntimeSnapshot(
  snapshot: LocalRuntimeSnapshot,
  options?: { mode?: "merge" | "replace"; includeProblemStatus?: boolean },
): Promise<void> {
  const mode = options?.mode ?? "merge";
  const includeProblemStatus = options?.includeProblemStatus ?? true;

  if (mode === "replace") {
    if (includeProblemStatus) {
      await importLocalRuntimeSnapshot(snapshot);
      return;
    }
    await importLocalRuntimeMembersOnlySnapshot(snapshot);
    return;
  }

  if (includeProblemStatus) {
    await mergeLocalRuntimeSnapshot(snapshot);
    return;
  }
  await mergeLocalRuntimeMembersOnlySnapshot(snapshot);
}

export async function addManualCatalogContest(payload: {
  contest: LocalCatalogContestRecord;
  problems?: LocalCatalogProblemRecord[];
}): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.catalogContests, localDb.catalogProblems],
    async () => {
      await localDb.catalogContests.put(payload.contest);
      if (payload.problems?.length) {
        await localDb.catalogProblems.bulkPut(payload.problems);
      }
    },
  );
}

export async function importLocalRuntimeSnapshot(snapshot: LocalRuntimeSnapshot): Promise<void> {
  await localDb.transaction(
    "rw",
    [
      localDb.members,
      localDb.memberHandles,
      localDb.memberProblemStatus,
      localDb.importSources,
      localDb.syncRecords,
    ],
    async () => {
      await localDb.members.clear();
      await localDb.memberHandles.clear();
      await localDb.memberProblemStatus.clear();
      await localDb.importSources.clear();
      await localDb.syncRecords.clear();

      if (snapshot.members.length) {
        await localDb.members.bulkPut(snapshot.members);
      }
      if (snapshot.memberHandles.length) {
        await localDb.memberHandles.bulkPut(snapshot.memberHandles);
      }
      if (snapshot.memberProblemStatus.length) {
        await localDb.memberProblemStatus.bulkPut(snapshot.memberProblemStatus);
      }
      if (snapshot.importSources.length) {
        await localDb.importSources.bulkPut(snapshot.importSources);
      }
      if (snapshot.syncRecords.length) {
        await localDb.syncRecords.bulkPut(snapshot.syncRecords);
      }
    },
  );
}

export async function importLocalRuntimeMembersOnlySnapshot(snapshot: LocalRuntimeSnapshot): Promise<void> {
  await localDb.transaction(
    "rw",
    [
      localDb.members,
      localDb.memberHandles,
      localDb.memberProblemStatus,
      localDb.importSources,
      localDb.syncRecords,
    ],
    async () => {
      await localDb.members.clear();
      await localDb.memberHandles.clear();
      await localDb.memberProblemStatus.clear();
      if (snapshot.members.length) {
        await localDb.members.bulkPut(snapshot.members);
      }
      if (snapshot.memberHandles.length) {
        await localDb.memberHandles.bulkPut(snapshot.memberHandles);
      }
      if (snapshot.importSources.length) {
        await localDb.importSources.bulkPut(snapshot.importSources);
      }
      if (snapshot.syncRecords.length) {
        await localDb.syncRecords.bulkPut(snapshot.syncRecords);
      }
    },
  );
}

export async function mergeLocalRuntimeSnapshot(snapshot: LocalRuntimeSnapshot): Promise<void> {
  await localDb.transaction(
    "rw",
    [
      localDb.members,
      localDb.memberHandles,
      localDb.memberProblemStatus,
      localDb.importSources,
      localDb.syncRecords,
    ],
    async () => {
      if (snapshot.members.length) {
        await localDb.members.bulkPut(snapshot.members);
      }
      if (snapshot.memberHandles.length) {
        await localDb.memberHandles.bulkPut(snapshot.memberHandles);
      }
      if (snapshot.memberProblemStatus.length) {
        await localDb.memberProblemStatus.bulkPut(snapshot.memberProblemStatus);
      }
      if (snapshot.importSources.length) {
        await localDb.importSources.bulkPut(snapshot.importSources);
      }
      if (snapshot.syncRecords.length) {
        await localDb.syncRecords.bulkPut(snapshot.syncRecords);
      }
    },
  );
}

export async function mergeLocalRuntimeMembersOnlySnapshot(snapshot: LocalRuntimeSnapshot): Promise<void> {
  await localDb.transaction(
    "rw",
    [
      localDb.members,
      localDb.memberHandles,
      localDb.importSources,
      localDb.syncRecords,
    ],
    async () => {
      if (snapshot.members.length) {
        await localDb.members.bulkPut(snapshot.members);
      }
      if (snapshot.memberHandles.length) {
        await localDb.memberHandles.bulkPut(snapshot.memberHandles);
      }
      if (snapshot.importSources.length) {
        await localDb.importSources.bulkPut(snapshot.importSources);
      }
      if (snapshot.syncRecords.length) {
        await localDb.syncRecords.bulkPut(snapshot.syncRecords);
      }
    },
  );
}

export async function importLocalRuntimeProblemsOnlySnapshot(snapshot: LocalRuntimeSnapshot): Promise<void> {
  await localDb.transaction(
    "rw",
    [
      localDb.memberProblemStatus,
      localDb.importSources,
      localDb.syncRecords,
    ],
    async () => {
      await localDb.memberProblemStatus.bulkPut(snapshot.memberProblemStatus);
      if (snapshot.importSources.length) {
        await localDb.importSources.bulkPut(snapshot.importSources);
      }
      if (snapshot.syncRecords.length) {
        await localDb.syncRecords.bulkPut(snapshot.syncRecords);
      }
    },
  );
}

export async function clearLocalContestData(): Promise<void> {
  await localDb.transaction(
    "rw",
    [
      localDb.catalogContests,
      localDb.catalogProblems,
      localDb.problemMatchCache,
    ],
    async () => {
      await localDb.catalogContests.clear();
      await localDb.catalogProblems.clear();
      await localDb.problemMatchCache.clear();
    },
  );
}

export async function clearLocalMemberData(): Promise<void> {
  await localDb.transaction(
    "rw",
    [
      localDb.members,
      localDb.memberHandles,
      localDb.memberProblemStatus,
      localDb.importSources,
      localDb.syncRecords,
    ],
    async () => {
      await localDb.members.clear();
      await localDb.memberHandles.clear();
      await localDb.memberProblemStatus.clear();
      await localDb.importSources.clear();
      await localDb.syncRecords.clear();
    },
  );
}

export async function listCodeforcesMemberSyncTargets(): Promise<Array<{
  memberId: string;
  displayName: string;
  handle: string;
}>> {
  const [members, handles] = await Promise.all([
    localDb.members.toArray(),
    localDb.memberHandles.toArray(),
  ]);
  const memberNameById = new Map(members.map((member) => [member.memberId, member.displayName]));

  return handles
    .filter((handle) => handle.provider === "codeforces")
    .map((handle) => ({
      memberId: handle.memberId,
      displayName: memberNameById.get(handle.memberId) ?? handle.memberId,
      handle: handle.handle,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function mergeStatus(statuses: Array<"solved" | "attempted" | "unseen">): "solved" | "attempted" | "unseen" {
  if (statuses.includes("solved")) {
    return "solved";
  }
  if (statuses.includes("attempted")) {
    return "attempted";
  }
  return "unseen";
}

export async function getContestCoverageFromDb(
  contestId: string,
  options?: { memberIds?: string[] },
): Promise<LocalContestCoverage> {
  const [contest, problems, allMembers, allStatuses] = await Promise.all([
    getCatalogContestFromDb(contestId),
    listContestProblemsFromDb(contestId),
    listMemberPeopleFromDb(),
    localDb.memberProblemStatus.toArray(),
  ]);

  if (!contest) {
    throw new Error(`Unknown contest: ${contestId}`);
  }

  const memberIdFilter = options?.memberIds ? new Set(options.memberIds) : null;
  const members = memberIdFilter !== null
    ? allMembers.filter((member) => memberIdFilter.has(member.memberId))
    : allMembers;
  const statuses = memberIdFilter !== null
    ? allStatuses.filter((status) => memberIdFilter.has(status.memberId))
    : allStatuses;

  const problemRows = problems.map((problem) => {
    let anySeen = false;
    const memberRows = members.map((member) => {
      const candidateStatuses = statuses
        .filter((status) => status.memberId === member.memberId && status.problemId === problem.problemId)
        .map((status) => status.status);
      const mergedStatus = mergeStatus(
        candidateStatuses.length > 0 ? candidateStatuses : ["unseen"],
      );
      if (mergedStatus !== "unseen") {
        anySeen = true;
      }
      return {
        memberId: member.memberId,
        displayName: member.displayName,
        status: mergedStatus,
      };
    });

    return {
      problemId: problem.problemId,
      ordinal: problem.ordinal,
      title: problem.title,
      freshForTeam: !anySeen,
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

export async function getContestCoverageSummaryFromDb(
  contestId: string,
  options?: { memberIds?: string[] },
): Promise<LocalContestCoverageSummary | null> {
  const coverage = await getContestCoverageFromDb(contestId, options);
  if (coverage.problemCount === 0) {
    return null;
  }

  const problemStates = coverage.problems.map((problem) => {
    const statuses = problem.members.map((member) => member.status);
    const status = mergeStatus(statuses);
    return {
      ordinal: problem.ordinal,
      status,
    };
  });

  return {
    contestId,
    problemCount: coverage.problemCount,
    freshProblemCount: coverage.freshProblemCount,
    solvedProblemCount: problemStates.filter((problem) => problem.status === "solved").length,
    attemptedProblemCount: problemStates.filter((problem) => problem.status === "attempted").length,
    problemStates,
  };
}

export async function listContestCoverageSummariesFromDb(
  options?: { memberIds?: string[] },
): Promise<LocalContestCoverageSummary[]> {
  const contests = await listCatalogContestsFromDb();
  const summaries = await Promise.all(
    contests.map((contest) => getContestCoverageSummaryFromDb(contest.contestId, options)),
  );
  return summaries.filter((summary): summary is LocalContestCoverageSummary => summary !== null);
}
