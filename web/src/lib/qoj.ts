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

function findProblemsByQojProviderProblemId(
  catalogProblems: LocalCatalogProblemRecord[],
  providerProblemId: string,
): LocalCatalogProblemRecord[] {
  return catalogProblems.filter((problem) =>
    problem.sources.some(
      (source) =>
        source.provider === "qoj" &&
        source.provider_problem_id === providerProblemId,
    ),
  );
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

export async function importQojUserscriptMembers(payload: QojUserscriptImport): Promise<QojImportSummary> {
  const catalogProblems = await listRuntimeCatalogProblemsForImport();
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

  for (const memberPayload of memberPayloads) {
    const handle = String(memberPayload.handle ?? "").trim();
    if (!handle) {
      continue;
    }
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
      const matchedProblems = findProblemsByQojProviderProblemId(catalogProblems, providerProblemId);
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
      const matchedProblems = findProblemsByQojProviderProblemId(catalogProblems, providerProblemId);
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
