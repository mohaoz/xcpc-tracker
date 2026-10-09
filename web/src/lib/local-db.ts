import Dexie, { type ObservabilitySet, type Table } from "dexie";
import { isSpoilerDefault, validatePreferences } from './spoiler-policy';
import { validateRuntimeSnapshot } from './runtime-snapshot';
import { statusHandleId, withStatusProvenance } from './member-status';
import {
  buildContestCoverage,
  buildMemberCoverageInput,
  summarizeCatalogCoverage,
  type MemberCoverageInput,
} from "./local-coverage";

import type {
  ContestPreference,
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
  appSettings!: Table<{key: string; value: boolean | string}, string>;
  contestPreferences!: Table<ContestPreference, string>;
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

    this.version(4).stores({
      catalogContests: "contestId, deletedAt",
      catalogProblems: "problemId, contestId",
      members: "memberId, updatedAt, deletedAt",
      memberHandles: "handleId, memberId, [provider+handle], updatedAt, deletedAt",
      memberProblemStatus: "statusId, memberId, problemId, [memberId+problemId], [provider+problemId], lastSeenAt",
      importSources: "sourceRecordId, kind, importedAt",
      syncRecords: "syncId, adapter, startedAt, sourceRecordId",
      problemMatchCache: "cacheKey, [provider+externalRef], updatedAt",
    });
    this.version(5).stores({ contestPreferences: "contest_id" });
    this.version(6).stores({ appSettings: 'key' });
    this.version(7).stores({
      memberProblemStatus: 'statusId, memberId, problemId, [memberId+problemId], [provider+problemId], lastSeenAt, handleId',
    }).upgrade(async transaction => {
      const handles = await transaction.table('memberHandles').toArray() as LocalMemberHandleRecord[];
      // Rebinding receives a fresh generation, even when it happens in the same
      // millisecond. Timestamps alone cannot safely identify an in-flight target.
      for (const tableName of ['members', 'memberHandles']) {
        for (const row of await transaction.table(tableName).toArray()) {
          if (!row.identityRevision) await transaction.table(tableName).put({ ...row, identityRevision: crypto.randomUUID() });
        }
      }
      const sources = new Map<string, LocalImportSourceRecord>(
        (await transaction.table('importSources').toArray()).map(source => [source.sourceRecordId, source]),
      );
      const table = transaction.table('memberProblemStatus');
      for (const row of await table.toArray() as LocalMemberProblemStatusRecord[]) {
        const next = withStatusProvenance(row, handles, sources);
        if (next.statusId === row.statusId) continue;
        await table.put(mergeMemberProblemStatusRecord(await table.get(next.statusId), next));
        await table.delete(row.statusId);
      }
    });
  }
}

export const localDb = new XcpcTrackerDb();

function attachProblemIdsToContests(
  contests: LocalCatalogContestRecord[],
  problems: LocalCatalogProblemRecord[],
): LocalCatalogContestRecord[] {
  const problemIdsByContestId = new Map<string, string[]>();

  for (const problem of problems) {
    const bucket = problemIdsByContestId.get(problem.contestId) ?? [];
    bucket.push(problem.problemId);
    problemIdsByContestId.set(problem.contestId, bucket);
  }

  return contests.map((contest) => ({
    ...contest,
    problemIds: problemIdsByContestId.get(contest.contestId) ?? contest.problemIds ?? [],
  }));
}

function memberProblemStatusPriority(status: "solved" | "attempted"): number {
  return status === "solved" ? 2 : 1;
}

function mergeMemberProblemStatusRecord(
  existing: LocalMemberProblemStatusRecord | undefined,
  incoming: LocalMemberProblemStatusRecord,
): LocalMemberProblemStatusRecord {
  if (!existing) {
    return incoming;
  }

  const incomingWins =
    memberProblemStatusPriority(incoming.status) >= memberProblemStatusPriority(existing.status);
  const baseRecord = incomingWins ? incoming : existing;

  return {
    ...baseRecord,
    statusId: existing.statusId,
    firstSeenAt: existing.firstSeenAt < incoming.firstSeenAt
      ? existing.firstSeenAt
      : incoming.firstSeenAt,
    lastSeenAt: existing.lastSeenAt > incoming.lastSeenAt
      ? existing.lastSeenAt
      : incoming.lastSeenAt,
  };
}

async function upsertMemberProblemStatusWithPriority(
  status: LocalMemberProblemStatusRecord,
): Promise<void> {
  const existing = await localDb.memberProblemStatus.get(status.statusId);
  await localDb.memberProblemStatus.put(mergeMemberProblemStatusRecord(existing, status));
}

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

export async function listContestProblemsByContestIdsFromDb(contestIds: string[]): Promise<Map<string, LocalCatalogProblemRecord[]>> {
  const problemsByContestId = new Map<string, LocalCatalogProblemRecord[]>();
  const uniqueContestIds = [...new Set(contestIds.filter(Boolean))];

  if (!uniqueContestIds.length) return problemsByContestId;
  for (const contestId of uniqueContestIds) problemsByContestId.set(contestId, []);
  const problems = await localDb.catalogProblems.where("contestId").anyOf(uniqueContestIds).toArray();
  for (const problem of problems) {
    problemsByContestId.get(problem.contestId)!.push(problem);
  }
  for (const bucket of problemsByContestId.values()) {
    bucket.sort((left, right) => left.ordinal.localeCompare(right.ordinal));
  }

  return problemsByContestId;
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

// Call inside the same transaction as the write so concurrent imports cannot steal handles.
export async function assertHandleOwnership(handles: LocalMemberHandleRecord[]): Promise<void> {
  for (const handle of handles) {
    const byId = await localDb.memberHandles.get(handle.handleId);
    const byAccount = await localDb.memberHandles.where('[provider+handle]').equals([handle.provider, handle.handle]).toArray();
    if ([byId, ...byAccount].some(existing => existing && !existing.deletedAt && existing.memberId !== handle.memberId)) {
      throw new Error(`${handle.provider} 账号 ${handle.handle} 已绑定其他成员`);
    }
    if (byId && (byId.provider !== handle.provider || byId.handle !== handle.handle)) {
      throw new Error('账号 ID 与已有平台账号不一致');
    }
  }
}

export type MemberSyncGuard = {
  member?: Pick<LocalMemberRecord, 'memberId' | 'identityRevision'>;
  handle?: Pick<LocalMemberHandleRecord, 'handleId' | 'memberId' | 'identityRevision'>;
};

export async function captureMemberSyncGuard(memberId: string, provider: string, handle: string, requireExisting = false, initializeIdentity = true): Promise<MemberSyncGuard> {
  return localDb.transaction(initializeIdentity ? 'rw' : 'r', localDb.members, localDb.memberHandles, async () => {
    const member = await localDb.members.get(memberId);
    const account = (await localDb.memberHandles.where('[provider+handle]').equals([provider, handle]).toArray())
      .find(row => row.memberId === memberId && !row.deletedAt);
    if (requireExisting && (!member || member.deletedAt || !account)) throw new DOMException('Sync target removed', 'AbortError');
    if (initializeIdentity && member && !member.deletedAt && !member.identityRevision) {
      member.identityRevision = crypto.randomUUID();
      await localDb.members.put(member);
    }
    if (initializeIdentity && account && !account.identityRevision) {
      account.identityRevision = crypto.randomUUID();
      await localDb.memberHandles.put(account);
    }
    return {
      member: member && !member.deletedAt ? { memberId, identityRevision: member.identityRevision } : undefined,
      handle: account ? { handleId: account.handleId, memberId, identityRevision: account.identityRevision } : undefined,
    };
  });
}

async function assertSyncGuard(guard?: MemberSyncGuard): Promise<void> {
  if (guard?.member) {
    const member = await localDb.members.get(guard.member.memberId);
    if (!member || member.deletedAt || member.identityRevision !== guard.member.identityRevision) throw new DOMException('Member removed or replaced', 'AbortError');
  }
  if (guard?.handle) {
    const handle = await localDb.memberHandles.get(guard.handle.handleId);
    if (!handle || handle.deletedAt || handle.memberId !== guard.handle.memberId || handle.identityRevision !== guard.handle.identityRevision) throw new DOMException('Account removed or rebound', 'AbortError');
  }
}

export async function validateMemberSyncGuard(guard: MemberSyncGuard): Promise<void> {
  await localDb.transaction('r', localDb.members, localDb.memberHandles, () => assertSyncGuard(guard));
}

export async function upsertMemberBundle(payload: {
  member: LocalMemberRecord;
  handles: LocalMemberHandleRecord[];
  statuses: LocalMemberProblemStatusRecord[];
  importSource: LocalImportSourceRecord;
  syncRecord: LocalSyncRecord;
  syncGuard?: MemberSyncGuard;
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
      await assertSyncGuard(payload.syncGuard);
      await assertHandleOwnership(payload.handles);
      const existingMember = await localDb.members.get(payload.member.memberId);
      await localDb.members.put({ ...payload.member,
        displayName: existingMember && !existingMember.deletedAt ? existingMember.displayName : payload.member.displayName,
        identityRevision: existingMember && !existingMember.deletedAt ? existingMember.identityRevision ?? crypto.randomUUID() : crypto.randomUUID(),
        createdAt: existingMember && !existingMember.deletedAt ? existingMember.createdAt : payload.member.createdAt,
      });
      for (const handle of payload.handles) {
        const existing = await localDb.memberHandles.get(handle.handleId);
        await localDb.memberHandles.put({ ...handle,
          displayLabel: existing && !existing.deletedAt && existing.memberId === handle.memberId ? existing.displayLabel ?? handle.displayLabel : handle.displayLabel,
          identityRevision: existing && !existing.deletedAt && existing.memberId === handle.memberId ? existing.identityRevision ?? crypto.randomUUID() : crypto.randomUUID(),
          createdAt: existing && !existing.deletedAt && existing.memberId === handle.memberId ? existing.createdAt : handle.createdAt,
          deletedAt: handle.deletedAt ?? null,
        });
      }

      for (const status of payload.statuses) {
        await upsertMemberProblemStatusWithPriority(status);
      }

      await localDb.importSources.put(payload.importSource);
      await localDb.syncRecords.put(payload.syncRecord);
    },
  );
}

export async function recordImportSyncAttempt(payload: {
  importSource: LocalImportSourceRecord;
  syncRecord: LocalSyncRecord;
}): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.importSources, localDb.syncRecords],
    async () => {
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

  const activeMembers = (await localDb.members.toArray()).filter((member) => !member.deletedAt);
  const activeMemberIds = new Set(activeMembers.map((member) => member.memberId));
  const activeHandles = (await localDb.memberHandles.toArray()).filter((handle) => !handle.deletedAt && activeMemberIds.has(handle.memberId));

  return {
    contestCount: activeContests.length,
    syncedContestCount: activeContests.filter((contest) => syncedContestIds.has(contest.contestId)).length,
    problemCount: activeProblems.length,
    memberCount: activeMembers.length,
    handleCount: activeHandles.length,
    statusCount,
    lastCatalogImportAt,
  };
}

export async function readMemberCoverageInputFromDb(): Promise<MemberCoverageInput> {
  return localDb.transaction("r", localDb.members, localDb.memberHandles, localDb.memberProblemStatus, async () => {
    const [members, handles, statuses] = await Promise.all([
      localDb.members.toArray(),
      localDb.memberHandles.toArray(),
      localDb.memberProblemStatus.toArray(),
    ]);
    return buildMemberCoverageInput(members, handles, statuses);
  });
}

export async function listMemberPeopleFromDb(): Promise<LocalMemberPerson[]> {
  return (await readMemberCoverageInputFromDb()).members;
}

// Committed writes invalidate list inputs, including writes made by another tab.
export function subscribeCoverageDataMutated(listener: () => void): () => void {
  const prefixes = ["catalogContests", "catalogProblems", "members", "memberHandles", "memberProblemStatus"]
    .map((table) => `idb://${localDb.name}/${table}/`);
  const onMutation = (parts: ObservabilitySet) => {
    if (Object.keys(parts).some((part) => prefixes.some((prefix) => part.startsWith(prefix)))) {
      listener();
    }
  };
  Dexie.on("storagemutated", onMutation);
  return () => Dexie.on("storagemutated").unsubscribe(onMutation);
}

export async function getMemberPersonFromDb(memberId: string): Promise<LocalMemberPerson | null> {
  const people = await listMemberPeopleFromDb();
  return people.find((person) => person.memberId === memberId) ?? null;
}

export async function listMemberHandleProblemCountsFromDb(memberId: string): Promise<Record<string, {
  solvedCount: number;
  attemptedCount: number;
  totalCount: number;
}>> {
  const [handles, statuses] = await Promise.all([
    localDb.memberHandles.where("memberId").equals(memberId).toArray(),
    localDb.memberProblemStatus.where("memberId").equals(memberId).toArray(),
  ]);
  const activeHandles = handles.filter((handle) => !handle.deletedAt);
  const activeHandlesByProvider = new Map<string, LocalMemberHandleRecord[]>();
  for (const handle of activeHandles) {
    const bucket = activeHandlesByProvider.get(handle.provider) ?? [];
    bucket.push(handle);
    activeHandlesByProvider.set(handle.provider, bucket);
  }

  const result: Record<string, { solvedCount: number; attemptedCount: number; totalCount: number }> = {};
  for (const handle of activeHandles) {
    const sameProviderHandles = activeHandlesByProvider.get(handle.provider) ?? [];
    const handleStatuses = statuses.filter((status) => {
      if (status.provider !== handle.provider) {
        return false;
      }
      const owner = statusHandleId(status, handles);
      return owner ? owner === handle.handleId : sameProviderHandles.length === 1;
    });
    const solvedProblemIds = new Set(
      handleStatuses
        .filter((status) => status.status === "solved")
        .map((status) => status.problemId),
    );
    const attemptedProblemIds = new Set(
      handleStatuses
        .filter((status) => status.status === "attempted" && !solvedProblemIds.has(status.problemId))
        .map((status) => status.problemId),
    );

    result[handle.handleId] = {
      solvedCount: solvedProblemIds.size,
      attemptedCount: attemptedProblemIds.size,
      totalCount: solvedProblemIds.size + attemptedProblemIds.size,
    };
  }

  return result;
}

export async function exportLocalRuntimeSnapshot(options?: { includeProblemStatus?: boolean }): Promise<LocalRuntimeSnapshot> {
  const allowMedalEstimates = (await localDb.appSettings.get('allow_medal_estimates'))?.value !== false;
  const storedSpoilerDefault = (await localDb.appSettings.get('spoiler_default'))?.value;
  const spoilerDefault = isSpoilerDefault(storedSpoilerDefault) ? storedSpoilerDefault : 'touched';
  const preferences = await localDb.contestPreferences.toArray();
  const [members, memberHandles, memberProblemStatus, importSources, syncRecords] = await Promise.all([
    localDb.members.toArray(),
    localDb.memberHandles.toArray(),
    localDb.memberProblemStatus.toArray(),
    localDb.importSources.toArray(),
    localDb.syncRecords.toArray(),
  ]);
  const activeMembers = members.filter((member) => !member.deletedAt);
  const activeMemberIds = new Set(activeMembers.map((member) => member.memberId));
  const activeHandles = memberHandles.filter((handle) => !handle.deletedAt && activeMemberIds.has(handle.memberId));
  const activeHandleValues = new Set(activeHandles.map((handle) => handle.handle.toLocaleLowerCase()));
  const activeHandleIds = new Set(activeHandles.map(handle => handle.handleId));
  const activeStatuses = memberProblemStatus.filter((status) => activeMemberIds.has(status.memberId) && (!status.handleId || activeHandleIds.has(status.handleId)));
  const activeSourceRecordIds = new Set(activeStatuses.map((status) => status.sourceRecordId));
  const filteredImportSources = importSources.filter((source) => {
    if (activeSourceRecordIds.has(source.sourceRecordId)) {
      return true;
    }
    const importedHandle = source.rawMetaJson.handle;
    return typeof importedHandle === "string" && activeHandleValues.has(importedHandle.toLocaleLowerCase());
  });
  const filteredSourceRecordIds = new Set(filteredImportSources.map((source) => source.sourceRecordId));
  const filteredSyncRecords = syncRecords.filter((record) => filteredSourceRecordIds.has(record.sourceRecordId));

  return {
    schemaVersion: 1,
    exportKind: "local_runtime_snapshot",
    contest_preferences: preferences,
    app_settings: {allow_medal_estimates: allowMedalEstimates, spoiler_default: spoilerDefault},
    exportedAt: new Date().toISOString(),
    members: activeMembers.map(({ identityRevision: _revision, ...member }) => member),
    memberHandles: activeHandles.map(({ identityRevision: _revision, ...handle }) => handle),
    memberProblemStatus: options?.includeProblemStatus === false ? [] : activeStatuses,
    importSources: filteredImportSources,
    syncRecords: filteredSyncRecords,
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
    version: undefined,
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

      const contests = attachProblemIdsToContests(snapshot.contests, snapshot.problems);
      if (snapshot.contests.length) {
        await localDb.catalogContests.bulkPut(contests);
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
      const contests = attachProblemIdsToContests(snapshot.contests, snapshot.problems);
      if (snapshot.contests.length) {
        await localDb.catalogContests.bulkPut(contests);
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

export async function listCatalogContestProblemCountsFromDb(): Promise<Map<string, number>> {
  const problems = await localDb.catalogProblems.toArray();
  const counts = new Map<string, number>();
  for (const problem of problems) {
    counts.set(problem.contestId, (counts.get(problem.contestId) ?? 0) + 1);
  }
  return counts;
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
  validateRuntimeSnapshot(snapshot);
  const sourceById = new Map(snapshot.importSources.map(source => [source.sourceRecordId, source]));
  snapshot = { ...snapshot, memberProblemStatus: snapshot.memberProblemStatus.map(status =>
    withStatusProvenance(status, snapshot.memberHandles, sourceById)),
  };
  const preferences = validatePreferences(snapshot.contest_preferences);
  if (snapshot.app_settings !== undefined && (!snapshot.app_settings || typeof snapshot.app_settings.allow_medal_estimates !== 'boolean'
    || (snapshot.app_settings.spoiler_default !== undefined && !isSpoilerDefault(snapshot.app_settings.spoiler_default)))) throw new Error('Invalid app settings');
  await localDb.transaction('rw', [localDb.members, localDb.memberHandles, localDb.memberProblemStatus, localDb.importSources, localDb.syncRecords, localDb.contestPreferences, localDb.appSettings], async () => {
    await applyLocalRuntimeSnapshotData(snapshot, options);
    // Backups written before spoiler_default existed may carry bulk-written
    // rows for every contest; like local data, they are not restored (see
    // migrateSpoilerPreferencesOnce). Newer backups hold manual choices only.
    const legacyPreferences = snapshot.app_settings?.spoiler_default === undefined;
    if (snapshot.contest_preferences !== undefined && !legacyPreferences) {
      if (options?.mode === 'replace') await localDb.contestPreferences.clear();
      if (preferences.length) await localDb.contestPreferences.bulkPut(preferences);
    }
    if (snapshot.app_settings !== undefined) {
      await localDb.appSettings.put({key:'allow_medal_estimates',value:snapshot.app_settings.allow_medal_estimates});
      // Older backups have no spoiler_default; keep the current default then.
      if (snapshot.app_settings.spoiler_default !== undefined) await localDb.appSettings.put({key:'spoiler_default',value:snapshot.app_settings.spoiler_default});
    }
  });
}

async function applyLocalRuntimeSnapshotData(
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

export async function replaceManualCatalogContest(payload: {
  contest: LocalCatalogContestRecord;
  problems: LocalCatalogProblemRecord[];
}): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.catalogContests, localDb.catalogProblems],
    async () => {
      await localDb.catalogContests.put(payload.contest);
      const existingProblemIds = (
        await localDb.catalogProblems.where("contestId").equals(payload.contest.contestId).toArray()
      ).map((problem) => problem.problemId);
      if (existingProblemIds.length) {
        await localDb.catalogProblems.bulkDelete(existingProblemIds);
      }
      if (payload.problems.length) {
        await localDb.catalogProblems.bulkPut(payload.problems);
      }
    },
  );
}

export async function upsertManualMemberProblemStatus(payload: {
  memberId: string;
  // Use the displayed snapshot, never recapture identity when a stale cell is clicked.
  memberIdentityRevision: LocalMemberRecord["identityRevision"];
  problemId: string;
  status: "solved" | "attempted" | null;
  note?: string | null;
}): Promise<void> {
  const importedAt = new Date().toISOString();
  const sourceRecordId = `manual-entry:${payload.memberId}:${payload.problemId}:${importedAt}`;
  const syncId = `manual-sync:${payload.memberId}:${payload.problemId}:${importedAt}`;

  await localDb.transaction(
    "rw",
    [
      localDb.members,
      localDb.memberProblemStatus,
      localDb.importSources,
      localDb.syncRecords,
    ],
    async () => {
      await assertSyncGuard({ member: { memberId: payload.memberId, identityRevision: payload.memberIdentityRevision } });
      const existingStatuses = await localDb.memberProblemStatus
        .where("[memberId+problemId]")
        .equals([payload.memberId, payload.problemId])
        .toArray();
      const existingManualStatuses = existingStatuses.filter((status) => status.provider === "manual");
      const existingManualStatus = existingManualStatuses[0];
      const nextStatus =
        existingManualStatus?.status === "solved" || payload.status === "solved"
          ? "solved"
          : "attempted";

      await localDb.importSources.put({
        sourceRecordId,
        kind: "manual_entry",
        label: "Manual Member Problem Status",
        importedAt,
        rawMetaJson: {
          member_id: payload.memberId,
          problem_id: payload.problemId,
          status: payload.status,
          applied_status: payload.status === null ? null : nextStatus,
          action: payload.status === null ? "clear" : "set",
          note: payload.note?.trim() || null,
        },
      });

      await localDb.syncRecords.put({
        syncId,
        sourceRecordId,
        adapter: "manual",
        startedAt: importedAt,
        finishedAt: importedAt,
        status: "succeeded",
        summaryJson: {
          member_id: payload.memberId,
          problem_id: payload.problemId,
          status: payload.status,
          applied_status: payload.status === null ? null : nextStatus,
          action: payload.status === null ? "clear" : "set",
          note: payload.note?.trim() || null,
        },
      });

      if (existingManualStatuses.length > 0) {
        await localDb.memberProblemStatus.bulkDelete(
          existingManualStatuses.map((status) => status.statusId),
        );
      }

      if (payload.status === null) {
        return;
      }

      await upsertMemberProblemStatusWithPriority({
        statusId: existingManualStatus?.statusId ?? crypto.randomUUID(),
        memberId: payload.memberId,
        problemId: payload.problemId,
        provider: "manual",
        status: nextStatus,
        firstSeenAt: existingManualStatus?.firstSeenAt ?? importedAt,
        lastSeenAt: importedAt,
        sourceRecordId,
        matchMethod: "manual",
      });
    },
  );
}

export async function getManualMemberProblemStatusFromDb(
  memberId: string,
  problemId: string,
  memberIdentityRevision: LocalMemberRecord["identityRevision"],
): Promise<"solved" | "attempted" | null> {
  return localDb.transaction('r', localDb.members, localDb.memberProblemStatus, async () => {
    await assertSyncGuard({ member: { memberId, identityRevision: memberIdentityRevision } });
    const existingStatuses = await localDb.memberProblemStatus
      .where("[memberId+problemId]")
      .equals([memberId, problemId])
      .toArray();
    const manualStatus = existingStatuses.find((status) => status.provider === "manual");
    return manualStatus?.status ?? null;
  });
}

async function putSnapshotIdentities(snapshot: LocalRuntimeSnapshot): Promise<void> {
  for (const member of snapshot.members) {
    const existing = await localDb.members.get(member.memberId);
    await localDb.members.put({ ...member,
      identityRevision: existing && !existing.deletedAt ? existing.identityRevision ?? crypto.randomUUID() : crypto.randomUUID(),
    });
  }
  for (const handle of snapshot.memberHandles) {
    const existing = await localDb.memberHandles.get(handle.handleId);
    await localDb.memberHandles.put({ ...handle,
      identityRevision: existing && !existing.deletedAt && existing.memberId === handle.memberId && existing.provider === handle.provider && existing.handle === handle.handle
        ? existing.identityRevision ?? crypto.randomUUID() : crypto.randomUUID(),
    });
  }
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

      await putSnapshotIdentities(snapshot);
      if (snapshot.memberProblemStatus.length) {
        for (const status of snapshot.memberProblemStatus) {
          await upsertMemberProblemStatusWithPriority(status);
        }
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
      await putSnapshotIdentities(snapshot);
      if (snapshot.importSources.length) {
        await localDb.importSources.bulkPut(snapshot.importSources);
      }
      if (snapshot.syncRecords.length) {
        await localDb.syncRecords.bulkPut(snapshot.syncRecords);
      }
    },
  );
}

async function assertSnapshotMergeOwnership(snapshot: LocalRuntimeSnapshot): Promise<void> {
  await assertHandleOwnership(snapshot.memberHandles);
  for (const status of snapshot.memberProblemStatus) {
    const existing = await localDb.memberProblemStatus.get(status.statusId);
    if (existing && (existing.memberId !== status.memberId || existing.problemId !== status.problemId || existing.provider !== status.provider || existing.handleId !== status.handleId)) {
      throw new Error('做题状态 ID 与已有成员或账号不一致');
    }
  }
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
      await assertSnapshotMergeOwnership(snapshot);
      await putSnapshotIdentities(snapshot);
      if (snapshot.memberProblemStatus.length) {
        for (const status of snapshot.memberProblemStatus) {
          await upsertMemberProblemStatusWithPriority(status);
        }
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
      await assertHandleOwnership(snapshot.memberHandles);
      await putSnapshotIdentities(snapshot);
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
      for (const status of snapshot.memberProblemStatus) {
        await upsertMemberProblemStatusWithPriority(status);
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

export async function resetLocalDb(): Promise<void> {
  await localDb.delete();
  await localDb.open();
}

export async function listCodeforcesMemberSyncTargets(): Promise<Array<{
  memberId: string;
  displayName: string;
  handle: string;
  syncGuard: MemberSyncGuard;
}>> {
  // A batch owns these identities from queue creation, not from each later
  // request's start. Deleting/rebinding a queued account invalidates its guard.
  return localDb.transaction('rw', localDb.members, localDb.memberHandles, async () => {
    const [members, handles] = await Promise.all([localDb.members.toArray(), localDb.memberHandles.toArray()]);
    const activeMembers = new Map(members.filter(member => !member.deletedAt).map(member => [member.memberId, member]));
    const targets = [];
    for (const handle of handles) {
      const member = activeMembers.get(handle.memberId);
      if (!member || handle.deletedAt || handle.provider !== 'codeforces') continue;
      const syncGuard = await captureMemberSyncGuard(member.memberId, handle.provider, handle.handle, true);
      targets.push({memberId: member.memberId, displayName: member.displayName, handle: handle.handle, syncGuard});
    }
    return targets.sort((left, right) => left.displayName.localeCompare(right.displayName));
  });
}

export async function softDeleteMemberHandle(handleId: string): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.memberHandles, localDb.memberProblemStatus, localDb.importSources],
    async () => {
      const handle = await localDb.memberHandles.get(handleId);
      if (!handle) {
        return;
      }

      await localDb.memberHandles.put({
        ...handle,
        deletedAt: new Date().toISOString(),
      });

      const providerStatuses = await localDb.memberProblemStatus
        .where("memberId")
        .equals(handle.memberId)
        .toArray();
      const handles = await localDb.memberHandles.where('memberId').equals(handle.memberId).toArray();
      const sources = new Map((await localDb.importSources.toArray()).map(source => [source.sourceRecordId, source]));
      const hasOtherAccount = handles.some(other => !other.deletedAt && other.provider === handle.provider);
      const statusIds = providerStatuses
        .filter(status => {
          if (status.provider !== handle.provider || status.provider === 'manual') return false;
          const owner = statusHandleId(status, handles, sources);
          return owner ? owner === handleId : !hasOtherAccount;
        })
        .map((status) => status.statusId);
      if (statusIds.length > 0) {
        await localDb.memberProblemStatus.bulkDelete(statusIds);
      }
    },
  );
}

export async function softDeleteMember(memberId: string): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.members, localDb.memberHandles, localDb.memberProblemStatus],
    async () => {
      const member = await localDb.members.get(memberId);
      if (member) {
        await localDb.members.put({
          ...member,
          deletedAt: new Date().toISOString(),
        });
      }

      const handles = await localDb.memberHandles.where("memberId").equals(memberId).toArray();
      for (const handle of handles) {
        await localDb.memberHandles.put({
          ...handle,
          deletedAt: new Date().toISOString(),
        });
      }

      const statuses = await localDb.memberProblemStatus.where("memberId").equals(memberId).toArray();
      if (statuses.length > 0) {
        await localDb.memberProblemStatus.bulkDelete(statuses.map((status) => status.statusId));
      }
    },
  );
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
  const [contest, problems] = await Promise.all([
    getCatalogContestFromDb(contestId),
    listContestProblemsFromDb(contestId),
  ]);

  if (!contest) {
    throw new Error(`Unknown contest: ${contestId}`);
  }

  return getContestCoverageForCatalog(contest, problems, options);
}

export async function getContestCoverageForCatalog(
  contest: LocalCatalogContestRecord,
  problems: LocalCatalogProblemRecord[],
  options?: { memberIds?: string[] },
): Promise<LocalContestCoverage> {
  const input = await readMemberCoverageInputFromDb();
  return buildContestCoverage({ contest, problems }, input, options);
}

export async function getContestCoverageSummaryFromDb(
  contestId: string,
  options?: { memberIds?: string[] },
): Promise<LocalContestCoverageSummary | null> {
  const coverage = await getContestCoverageFromDb(contestId, options);
  return summarizeContestCoverage(coverage);
}

export function summarizeContestCoverage(
  coverage: LocalContestCoverage,
): LocalContestCoverageSummary | null {
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
    contestId: coverage.contest.contestId,
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
  const [contests, input] = await Promise.all([
    listCatalogContestsFromDb(),
    readMemberCoverageInputFromDb(),
  ]);
  const problemsByContest = await listContestProblemsByContestIdsFromDb(contests.map((contest) => contest.contestId));
  return summarizeCatalogCoverage(contests.map((contest) => ({
    contest,
    problems: problemsByContest.get(contest.contestId) ?? [],
  })), input, options);
}

export async function listContestCoverageSummariesForCatalog(
  payload: Array<{
    contest: LocalCatalogContestRecord;
    problems: LocalCatalogProblemRecord[];
  }>,
  options?: { memberIds?: string[] },
): Promise<LocalContestCoverageSummary[]> {
  const input = await readMemberCoverageInputFromDb();
  return summarizeCatalogCoverage(payload, input, options);
}

/**
 * contestPreferences now hold manual per-contest choices only, and the
 * "全部剧透" switch became the appSettings `spoiler_default` setting. Earlier bulk
 * toggles wrote a row for every contest, indistinguishable from manual ones,
 * so all rows are cleared once and everyone starts from the default
 * (spoilers only for touched contests). Done in one transaction guarded by a
 * flag instead of a schema version bump, so open tabs and rollbacks keep
 * working.
 */
export async function migrateSpoilerPreferencesOnce(): Promise<void> {
  await localDb.transaction('rw', localDb.contestPreferences, localDb.appSettings, async () => {
    if ((await localDb.appSettings.get('spoiler_prefs_v2'))?.value === true) return;
    await localDb.contestPreferences.clear();
    await localDb.appSettings.put({ key: 'spoiler_prefs_v2', value: true });
  });
}
