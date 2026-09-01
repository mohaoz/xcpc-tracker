import type {
  LocalCatalogProblemRecord,
  LocalImportSourceRecord,
  LocalMemberHandleRecord,
  LocalMemberProblemStatusRecord,
  LocalMemberRecord,
  LocalSyncRecord,
} from "./local-model";
import { listRuntimeCatalogProblemsForImport } from "./catalog-runtime";
import { recordImportSyncAttempt, upsertMemberBundle } from "./local-db";

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
  const catalogProblems = await listRuntimeCatalogProblemsForImport();
  const qojProblemIndex = buildQojProblemIndex(catalogProblems);
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
  let matchedStatusCount = 0;
  let unmatchedStatusCount = 0;
  const importedHandles: string[] = [];
  const importableMemberCount = memberPayloads.filter((member) =>
    String(member.handle ?? "").trim(),
  ).length;
  const totalCount = importableMemberCount + fetchFailures.length;
  let currentIndex = 0;

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
          statusId: `${memberId}:${matchedProblem.problemId}:qoj`,
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
          statusId: `${memberId}:${matchedProblem.problemId}:qoj`,
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

    await upsertMemberBundle({
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
    await recordImportSyncAttempt({
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

  return {
    memberCount: importedHandles.length,
    matchedStatusCount,
    unmatchedStatusCount,
    fetchFailureCount: fetchFailures.length,
    importedHandles,
    failedHandles: fetchFailures.map((failure) => failure.handle),
  };
}
