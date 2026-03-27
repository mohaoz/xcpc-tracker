import type {
  LocalCatalogProblemRecord,
  LocalImportSourceRecord,
  LocalMemberHandleRecord,
  LocalMemberProblemStatusRecord,
  LocalMemberRecord,
  LocalSyncRecord,
} from "./local-model";
import { listCatalogProblemsFromDb, upsertMemberBundle } from "./local-db";

export type QojImportSummary = {
  memberId: string;
  handle: string;
  matchedStatusCount: number;
  unresolvedStatusCount: number;
  solvedCount: number;
  attemptedCount: number;
};

function normalizeProblemIdTokens(value: string[]) {
  return [...new Set(value.map((item) => item.trim()).filter((item) => item.length > 0))];
}

function findProblemByQojProviderProblemId(
  catalogProblems: LocalCatalogProblemRecord[],
  providerProblemId: string,
): LocalCatalogProblemRecord | undefined {
  return catalogProblems.find((problem) =>
    problem.sources.some((source) => source.provider === "qoj" && source.provider_problem_id === providerProblemId),
  );
}

export async function importQojMember(payload: {
  memberId: string;
  handle: string;
  solvedProblemIds: string[];
  attemptedProblemIds: string[];
  displayName?: string;
  exportedAt?: string;
}): Promise<QojImportSummary> {
  const startedAt = new Date().toISOString();
  const importedAt = new Date().toISOString();
  const sourceRecordId = `qoj:${payload.handle}:${importedAt}`;

  const solvedIds = normalizeProblemIdTokens(payload.solvedProblemIds);
  const attemptedIds = normalizeProblemIdTokens(payload.attemptedProblemIds);
  const statusByProviderProblemId = new Map<string, "solved" | "attempted">();

  for (const providerProblemId of attemptedIds) {
    statusByProviderProblemId.set(providerProblemId, "attempted");
  }
  for (const providerProblemId of solvedIds) {
    statusByProviderProblemId.set(providerProblemId, "solved");
  }

  const catalogProblems = await listCatalogProblemsFromDb();
  const statuses: LocalMemberProblemStatusRecord[] = [];
  const unresolvedProviderProblemIds: string[] = [];

  for (const [providerProblemId, status] of statusByProviderProblemId.entries()) {
    const matchedProblem = findProblemByQojProviderProblemId(catalogProblems, providerProblemId);
    if (!matchedProblem) {
      unresolvedProviderProblemIds.push(providerProblemId);
      continue;
    }
    statuses.push({
      statusId: `${payload.memberId}:${matchedProblem.problemId}:qoj`,
      memberId: payload.memberId,
      problemId: matchedProblem.problemId,
      provider: "qoj",
      status,
      firstSeenAt: importedAt,
      lastSeenAt: importedAt,
      sourceRecordId,
      matchMethod: "provider_id",
    });
  }

  const member: LocalMemberRecord = {
    memberId: payload.memberId,
    displayName: payload.displayName?.trim() || payload.memberId,
    createdAt: importedAt,
    updatedAt: importedAt,
  };

  const handles: LocalMemberHandleRecord[] = [
    {
      handleId: `qoj:${payload.handle}`,
      memberId: payload.memberId,
      provider: "qoj",
      handle: payload.handle,
      displayLabel: payload.displayName?.trim() || null,
      createdAt: importedAt,
      updatedAt: importedAt,
    },
  ];

  const importSource: LocalImportSourceRecord = {
    sourceRecordId,
    kind: "qoj_userscript_json",
    label: `QOJ userscript import for ${payload.handle}`,
    importedAt,
    rawMetaJson: {
      handle: payload.handle,
      exported_at: payload.exportedAt ?? null,
      solved_count: solvedIds.length,
      attempted_count: attemptedIds.length,
      normalized_problem_status_count: statusByProviderProblemId.size,
      matched_status_count: statuses.length,
      unresolved_status_count: unresolvedProviderProblemIds.length,
      unresolved_provider_problem_ids: unresolvedProviderProblemIds.slice(0, 200),
    },
  };

  const syncRecord: LocalSyncRecord = {
    syncId: `qoj-sync:${payload.handle}:${importedAt}`,
    sourceRecordId,
    adapter: "qoj_userscript",
    startedAt,
    finishedAt: importedAt,
    status: "succeeded",
    summaryJson: {
      handle: payload.handle,
      solved_count: solvedIds.length,
      attempted_count: attemptedIds.length,
      normalized_problem_status_count: statusByProviderProblemId.size,
      matched_status_count: statuses.length,
      unresolved_status_count: unresolvedProviderProblemIds.length,
    },
  };

  await upsertMemberBundle({
    member,
    handles,
    statuses,
    importSource,
    syncRecord,
  });

  return {
    memberId: payload.memberId,
    handle: payload.handle,
    matchedStatusCount: statuses.length,
    unresolvedStatusCount: unresolvedProviderProblemIds.length,
    solvedCount: solvedIds.length,
    attemptedCount: attemptedIds.length,
  };
}
