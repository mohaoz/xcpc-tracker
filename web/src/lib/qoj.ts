import type {
  LocalImportSourceRecord,
  LocalMemberHandleRecord,
  LocalMemberProblemStatusRecord,
  LocalMemberRecord,
  LocalSyncRecord,
} from "./local-model";
import { listCatalogProblemsFromDb, upsertMemberBundle } from "./local-db";

type QojUserscriptMember = {
  member_id?: string;
  handle: string;
  display_name?: string;
  profile_url?: string;
  solved?: string[];
  attempted?: string[];
};

export type QojUserscriptImport = {
  provider: "qoj";
  exported_at: string;
  members: QojUserscriptMember[];
};

export type QojImportSummary = {
  memberCount: number;
  matchedStatusCount: number;
  unmatchedStatusCount: number;
  importedHandles: string[];
};

function findProblemByQojProviderProblemId(
  catalogProblems: Awaited<ReturnType<typeof listCatalogProblemsFromDb>>,
  providerProblemId: string,
) {
  return catalogProblems.find((problem) =>
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
  const catalogProblems = await listCatalogProblemsFromDb();
  const importedAt = new Date().toISOString();
  let matchedStatusCount = 0;
  let unmatchedStatusCount = 0;
  const importedHandles: string[] = [];

  for (const memberPayload of payload.members) {
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

    for (const providerProblemId of normalized.solved) {
      const matchedProblem = findProblemByQojProviderProblemId(catalogProblems, providerProblemId);
      if (!matchedProblem) {
        unmatchedStatusCount += 1;
        continue;
      }
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

    for (const providerProblemId of normalized.attempted) {
      const matchedProblem = findProblemByQojProviderProblemId(catalogProblems, providerProblemId);
      if (!matchedProblem) {
        unmatchedStatusCount += 1;
        continue;
      }
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

  return {
    memberCount: importedHandles.length,
    matchedStatusCount,
    unmatchedStatusCount,
    importedHandles,
  };
}
