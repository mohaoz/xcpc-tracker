import type {
  LocalCatalogProblemRecord,
  LocalImportSourceRecord,
  LocalMemberHandleRecord,
  LocalMemberProblemStatusRecord,
  LocalMemberRecord,
  LocalSyncRecord,
} from "./local-model";
import { accountStatusId } from './member-status';
import { listRuntimeCatalogProblemsForImport } from "./catalog-runtime";
import { assertHandleOwnership, captureMemberSyncGuard, validateMemberSyncGuard, type MemberSyncGuard, localDb, recordImportSyncAttempt, upsertMemberBundle } from "./local-db";

export async function linkQojMember(memberId:string,handle:string) {
  const at=new Date().toISOString();
  await localDb.transaction('rw',[localDb.members,localDb.memberHandles],async()=>{
    const stored=await localDb.memberHandles.get(`qoj:${handle}`);
    const existing=stored?.memberId===memberId && !stored.deletedAt ? stored : undefined;
    const account: LocalMemberHandleRecord={identityRevision:existing?.identityRevision ?? crypto.randomUUID(),handleId:`qoj:${handle}`,memberId,provider:'qoj',handle,displayLabel:existing?.displayLabel ?? null,createdAt:existing?.createdAt || at,updatedAt:at,deletedAt:null};
    await assertHandleOwnership([account]);
    const member=await localDb.members.get(memberId);
    await localDb.members.put({...member,memberId,identityRevision:member && !member.deletedAt ? member.identityRevision ?? crypto.randomUUID() : crypto.randomUUID(),displayName:member?.displayName || memberId,createdAt:member && !member.deletedAt ? member.createdAt : at,updatedAt:at,deletedAt:null});
    await localDb.memberHandles.put(account);
  });
}

export type QojSyncTarget = {memberId:string;handle:string;displayName?:string;syncGuard:MemberSyncGuard};

// Capture the entire queue in one transaction, before bridge/lock/catalog waits.
// An explicit Add Member first calls linkQojMember and then captures its new identity.
export async function listQojMemberSyncTargets(selected?: Array<{memberId:string;handle:string}>, onlyHandle?: string): Promise<QojSyncTarget[]> {
  return localDb.transaction('rw',localDb.members,localDb.memberHandles,async()=>{
    const [members,handles]=await Promise.all([localDb.members.toArray(),localDb.memberHandles.toArray()]);
    const activeMembers=new Map(members.filter(m=>!m.deletedAt).map(m=>[m.memberId,m]));
    const targets:QojSyncTarget[]=[];
    for(const account of handles) {
      const member=activeMembers.get(account.memberId);
      if(!member || account.deletedAt || account.provider!=='qoj' || (onlyHandle && account.handle!==onlyHandle))continue;
      if(selected && !selected.some(t=>t.memberId===member.memberId && t.handle===account.handle))continue;
      const syncGuard=await captureMemberSyncGuard(member.memberId,'qoj',account.handle,true);
      targets.push({memberId:member.memberId,displayName:member.displayName,handle:account.handle,syncGuard});
    }
    if(selected?.some(t=>!targets.some(target=>target.memberId===t.memberId && target.handle===t.handle))) {
      throw new DOMException('QOJ account removed or rebound','AbortError');
    }
    return targets.sort((a,b)=>(a.displayName || a.memberId).localeCompare(b.displayName || b.memberId) || a.handle.localeCompare(b.handle));
  });
}

type QojUserscriptMember = {
  member_id?: string;
  handle: string;
  display_name?: string;
  profile_url?: string;
  solved?: string[];
  attempted?: string[];
};

type QojUserscriptFetchFailure = {
  member_id?: string;
  handle: string;
  error?: string;
};

export type QojUserscriptImport = {
  provider: "qoj";
  exported_at: string;
  script_version?: number;
  members: QojUserscriptMember[];
  fetch_failures?: QojUserscriptFetchFailure[];
};

export type QojImportSummary = {
  memberCount: number;
  matchedStatusCount: number;
  unmatchedStatusCount: number;
  fetchFailureCount: number;
  importedHandles: string[];
  failedHandles: string[];
};

export type QojImportProgress = {
  currentIndex: number;
  totalCount: number;
  handle: string;
  phase: "member" | "failure";
};

type QojImportOptions = {
  onProgress?: (progress: QojImportProgress) => void;
  requireExisting?: boolean;
  syncGuards?: ReadonlyMap<string, MemberSyncGuard>;
  signal?: AbortSignal;
};

function buildQojProblemIndex(
  catalogProblems: LocalCatalogProblemRecord[],
): Map<string, LocalCatalogProblemRecord[]> {
  const problemIndex = new Map<string, LocalCatalogProblemRecord[]>();
  for (const problem of catalogProblems) {
    for (const source of problem.sources) {
      if (source.provider !== "qoj" || !source.provider_problem_id) {
        continue;
      }
      const matchedProblems = problemIndex.get(source.provider_problem_id) ?? [];
      if (!matchedProblems.includes(problem)) {
        matchedProblems.push(problem);
      }
      problemIndex.set(source.provider_problem_id, matchedProblems);
    }
  }
  return problemIndex;
}

function normalizeQojProblemStatuses(member: QojUserscriptMember) {
  const solved = new Set((member.solved ?? []).map((value) => String(value).trim()).filter(Boolean));
  const attempted = new Set(
    (member.attempted ?? [])
      .map((value) => String(value).trim())
      .filter((value) => value && !solved.has(value)),
  );

  return {
    solved: [...solved],
    attempted: [...attempted],
  };
}

export async function importQojUserscriptMembers(
  payload: QojUserscriptImport,
  options: QojImportOptions = {},
): Promise<QojImportSummary> {
  if (payload?.provider !== 'qoj' || !Array.isArray(payload.members) ||
      (payload.fetch_failures !== undefined && !Array.isArray(payload.fetch_failures))) {
    throw new Error('QOJ 导入格式无效');
  }
  for (const entry of [...payload.members, ...(payload.fetch_failures ?? [])]) {
    if (!entry || typeof entry.handle !== 'string' || !entry.handle.trim() ||
        (entry.member_id !== undefined && (typeof entry.member_id !== 'string' || !entry.member_id.trim()))) {
      throw new Error('QOJ 账号或成员 ID 无效');
    }
  }
  for (const member of payload.members) {
    if (!Array.isArray(member.solved) || !Array.isArray(member.attempted) ||
        ![...member.solved, ...member.attempted].every(id => typeof id === 'string' && /^\d+$/.test(id))) {
      throw new Error('QOJ 做题记录缺失或格式无效，请重新导出');
    }
    if (member.display_name !== undefined && typeof member.display_name !== 'string') throw new Error('QOJ 成员名称无效');
  }
  const importedAt = new Date().toISOString();
  const memberPayloads = Array.isArray(payload.members) ? payload.members : [];
  const fetchFailures = (Array.isArray(payload.fetch_failures) ? payload.fetch_failures : [])
    .map((failure) => ({
      memberId: String(failure.member_id ?? "").trim(),
      handle: String(failure.handle ?? "").trim(),
      error: String(failure.error ?? "QOJ 用户页读取失败").trim() || "QOJ 用户页读取失败",
    }))
    .filter((failure) => failure.handle);
  if (!memberPayloads.length && !fetchFailures.length) {
    throw new Error("QOJ JSON 中没有成员或抓取失败记录");
  }
  // Refresh callers supply identities captured before obtaining the response.
  // Raw file imports may create/restore members, but still guard any identity
  // that already exists when this import starts, including later batch entries.
  const importTargets=[
    ...memberPayloads.map(member=>({handle:String(member.handle ?? '').trim(),memberId:String(member.member_id ?? member.handle ?? '').trim() || String(member.handle ?? '').trim()})),
    ...fetchFailures.map(failure=>({handle:failure.handle,memberId:failure.memberId || failure.handle})),
  ].filter(target=>target.handle);
  if(new Set(importTargets.map(target=>target.handle)).size!==importTargets.length)throw new Error('QOJ JSON 中账号重复');
  const syncGuards=await localDb.transaction('r',localDb.members,localDb.memberHandles,async()=>{
    const guards=new Map<string,MemberSyncGuard>();
    for(const target of importTargets) {
      const supplied=options.syncGuards?.get(target.handle);
      if(options.syncGuards && (!supplied?.member || !supplied.handle || supplied.member.memberId!==target.memberId || supplied.handle.memberId!==target.memberId)) {
        throw new DOMException('QOJ import target changed','AbortError');
      }
      const guard=supplied ?? await captureMemberSyncGuard(target.memberId,'qoj',target.handle,options.requireExisting,false);
      await validateMemberSyncGuard(guard);
      guards.set(target.handle,guard);
    }
    return guards;
  });
  const assertNotCancelled=()=>{if(options.signal?.aborted)throw new DOMException('QOJ import cancelled','AbortError');};
  assertNotCancelled();
  const catalogProblems = await listRuntimeCatalogProblemsForImport();
  assertNotCancelled();
  const qojProblemIndex = buildQojProblemIndex(catalogProblems);
  let matchedStatusCount = 0;
  let unmatchedStatusCount = 0;
  const importedHandles: string[] = [];
  const importableMemberCount = memberPayloads.filter((member) =>
    String(member.handle ?? "").trim(),
  ).length;
  const totalCount = importableMemberCount + fetchFailures.length;
  let currentIndex = 0;
  const bundles: Parameters<typeof upsertMemberBundle>[0][] = [];
  const failures: Parameters<typeof recordImportSyncAttempt>[0][] = [];

  for (const memberPayload of memberPayloads) {
    const handle = String(memberPayload.handle ?? "").trim();
    if (!handle) {
      continue;
    }
    currentIndex += 1;
    options.onProgress?.({ currentIndex, totalCount, handle, phase: "member" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const memberId = String(memberPayload.member_id ?? handle).trim() || handle;
    const displayName = String(memberPayload.display_name ?? memberId).trim() || memberId;
    const sourceRecordId = `qoj:${handle}:${importedAt}`;
    const normalized = normalizeQojProblemStatuses(memberPayload);

    const member: LocalMemberRecord = {
      memberId,
      displayName,
      createdAt: importedAt,
      updatedAt: importedAt,
    };

    const handles: LocalMemberHandleRecord[] = [
      {
        handleId: `qoj:${handle}`,
        memberId,
        provider: "qoj",
        handle,
        displayLabel: displayName !== memberId ? displayName : null,
        createdAt: importedAt,
        updatedAt: importedAt,
      },
    ];

    const statuses: LocalMemberProblemStatusRecord[] = [];
    const unmatchedStatuses: Array<{
      provider_problem_id: string;
      status: "solved" | "attempted";
    }> = [];

    for (const providerProblemId of normalized.solved) {
      const matchedProblems = qojProblemIndex.get(providerProblemId) ?? [];
      if (!matchedProblems.length) {
        unmatchedStatusCount += 1;
        unmatchedStatuses.push({ provider_problem_id: providerProblemId, status: "solved" });
        continue;
      }
      for (const matchedProblem of matchedProblems) {
        statuses.push({
          statusId: accountStatusId(memberId, matchedProblem.problemId, `qoj:${handle}`),
          handleId: `qoj:${handle}`,
          memberId,
          problemId: matchedProblem.problemId,
          provider: "qoj",
          status: "solved",
          firstSeenAt: importedAt,
          lastSeenAt: importedAt,
          sourceRecordId,
          matchMethod: "provider_id",
        });
        matchedStatusCount += 1;
      }
    }

    for (const providerProblemId of normalized.attempted) {
      const matchedProblems = qojProblemIndex.get(providerProblemId) ?? [];
      if (!matchedProblems.length) {
        unmatchedStatusCount += 1;
        unmatchedStatuses.push({ provider_problem_id: providerProblemId, status: "attempted" });
        continue;
      }
      for (const matchedProblem of matchedProblems) {
        statuses.push({
          statusId: accountStatusId(memberId, matchedProblem.problemId, `qoj:${handle}`),
          handleId: `qoj:${handle}`,
          memberId,
          problemId: matchedProblem.problemId,
          provider: "qoj",
          status: "attempted",
          firstSeenAt: importedAt,
          lastSeenAt: importedAt,
          sourceRecordId,
          matchMethod: "provider_id",
        });
        matchedStatusCount += 1;
      }
    }

    const importSource: LocalImportSourceRecord = {
      sourceRecordId,
      kind: "qoj_userscript_json",
      label: `QOJ userscript import for ${handle}`,
      importedAt,
      rawMetaJson: {
        handle,
        member_id: memberId,
        display_name: displayName,
        profile_url: memberPayload.profile_url ?? null,
        solved_count: normalized.solved.length,
        attempted_count: normalized.attempted.length,
        normalized_problem_status_count: normalized.solved.length + normalized.attempted.length,
        matched_status_count: statuses.length,
        unmatched_status_count: unmatchedStatuses.length,
        solved_provider_problem_ids: normalized.solved,
        attempted_provider_problem_ids: normalized.attempted,
        unmatched_problem_statuses: unmatchedStatuses,
        script_version: payload.script_version ?? null,
        batch_exported_at: payload.exported_at || null,
        batch_member_count: memberPayloads.length,
        batch_fetch_failure_count: fetchFailures.length,
        batch_fetch_failures: fetchFailures.map((failure) => ({
          member_id: failure.memberId || null,
          handle: failure.handle,
          error: failure.error,
        })),
      },
    };

    const syncRecord: LocalSyncRecord = {
      syncId: `qoj-sync:${handle}:${importedAt}`,
      sourceRecordId,
      adapter: "qoj_userscript",
      startedAt: payload.exported_at || importedAt,
      finishedAt: importedAt,
      status: "succeeded",
      summaryJson: {
        handle,
        member_id: memberId,
        solved_count: normalized.solved.length,
        attempted_count: normalized.attempted.length,
        matched_status_count: statuses.length,
        unmatched_status_count: unmatchedStatuses.length,
      },
    };

    assertNotCancelled();
    bundles.push({
      member,
      handles,
      statuses,
      importSource,
      syncRecord,
    });
    importedHandles.push(handle);
  }

  for (const [failureIndex, failure] of fetchFailures.entries()) {
    currentIndex += 1;
    options.onProgress?.({
      currentIndex,
      totalCount,
      handle: failure.handle,
      phase: "failure",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const sourceRecordId = `qoj:${failure.handle}:${importedAt}:fetch-failed:${failureIndex}`;
    assertNotCancelled();
    failures.push({
      importSource: {
        sourceRecordId,
        kind: "qoj_userscript_json",
        label: `QOJ userscript fetch failure for ${failure.handle}`,
        importedAt,
        rawMetaJson: {
          handle: failure.handle,
          member_id: failure.memberId || null,
          fetch_error: failure.error,
          script_version: payload.script_version ?? null,
          batch_exported_at: payload.exported_at || null,
          batch_member_count: memberPayloads.length,
          batch_fetch_failure_count: fetchFailures.length,
        },
      },
      syncRecord: {
        syncId: `qoj-sync:${failure.handle}:${importedAt}:fetch-failed:${failureIndex}`,
        sourceRecordId,
        adapter: "qoj_userscript",
        startedAt: payload.exported_at || importedAt,
        finishedAt: importedAt,
        status: "failed",
        summaryJson: {
          handle: failure.handle,
          member_id: failure.memberId || null,
          fetch_error: failure.error,
        },
      },
    });
  }

  // Mapping, progress callbacks and timers finish before opening the transaction.
  // Validate every original identity before writing any bundle, including multiple
  // accounts of the same member. Nested writes share this all-or-nothing transaction.
  await localDb.transaction('rw', [localDb.members, localDb.memberHandles,
    localDb.memberProblemStatus, localDb.importSources, localDb.syncRecords], async () => {
    assertNotCancelled();
    for (const guard of syncGuards.values()) await validateMemberSyncGuard(guard);
    for (const bundle of bundles) {
      assertNotCancelled();
      await upsertMemberBundle(bundle);
    }
    for (const failure of failures) {
      assertNotCancelled();
      await recordImportSyncAttempt(failure);
    }
    assertNotCancelled();
  });

  return {
    memberCount: importedHandles.length,
    matchedStatusCount,
    unmatchedStatusCount,
    fetchFailureCount: fetchFailures.length,
    importedHandles,
    failedHandles: fetchFailures.map((failure) => failure.handle),
  };
}
