import type {
  LocalCatalogProblemRecord,
  LocalImportSourceRecord,
  LocalMemberHandleRecord,
  LocalMemberProblemStatusRecord,
  LocalMemberRecord,
  LocalSyncRecord,
} from "./local-model";
import {
  listCatalogProblemsFromDb,
  listCodeforcesMemberSyncTargets,
  upsertMemberBundle,
} from "./local-db";
import { loadCodeforcesApiCredentials, type CodeforcesApiCredentials } from "./codeforces-auth";

type CodeforcesSubmission = {
  id: number;
  verdict?: string;
  problem?: {
    contestId?: number;
    index?: string;
  };
};

type CodeforcesApiEnvelope<T> = {
  status: string;
  comment?: string;
  result: T;
};

type CodeforcesImportSummary = {
  memberId: string;
  handle: string;
  matchedStatusCount: number;
  submissionCount: number;
};

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function sha512Hex(value: string) {
  const payload = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-512", payload);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function generateApiSigPrefix() {
  return Math.random().toString().slice(2, 8).padEnd(6, "0").slice(0, 6);
}

async function buildAuthorizedCodeforcesParams(
  method: string,
  params: Record<string, string>,
  auth: CodeforcesApiCredentials,
): Promise<Record<string, string>> {
  const apiKey = auth.apiKey.trim();
  const apiSecret = auth.apiSecret.trim();
  if (!apiKey || !apiSecret) {
    throw new Error("Codeforces API key and secret are required");
  }

  const time = Math.floor(Date.now() / 1000).toString();
  const requestParams = {
    ...params,
    apiKey,
    time,
  };
  const query = Object.entries(requestParams)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }
      return leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const prefix = generateApiSigPrefix();
  const hash = await sha512Hex(`${prefix}/${method}?${query}#${apiSecret}`);

  return {
    ...requestParams,
    apiSig: `${prefix}${hash}`,
  };
}

async function requestCodeforcesApi<T>(
  method: string,
  params: Record<string, string>,
  auth?: CodeforcesApiCredentials | null,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`https://codeforces.com/api/${method}`);
  const resolvedAuth = auth === undefined ? loadCodeforcesApiCredentials() : auth;
  const requestParams = resolvedAuth
    ? await buildAuthorizedCodeforcesParams(method, params, resolvedAuth)
    : params;
  for (const [key, value] of Object.entries(requestParams)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error(`Codeforces API HTTP ${response.status}`);
  }

  const payload = (await response.json()) as CodeforcesApiEnvelope<T>;
  if (payload.status !== "OK") {
    throw new Error(payload.comment || "Unknown Codeforces API error");
  }

  return payload.result;
}

function normalizeCodeforcesStatus(submissions: CodeforcesSubmission[]) {
  const bestByProviderProblemId = new Map<
    string,
    {
      providerProblemId: string;
      status: "solved" | "attempted";
      sourceUrl: string;
      sourceSubmissionId: number;
    }
  >();

  for (const submission of submissions) {
    const contestId = submission.problem?.contestId;
    const index = submission.problem?.index;
    if (!contestId || !index) {
      continue;
    }

    const providerProblemId = `${contestId}:${index}`;
    const nextStatus: "solved" | "attempted" = submission.verdict === "OK" ? "solved" : "attempted";
    const current = bestByProviderProblemId.get(providerProblemId);
    if (current?.status === "solved") {
      continue;
    }

    bestByProviderProblemId.set(providerProblemId, {
      providerProblemId,
      status: nextStatus,
      sourceUrl: `https://codeforces.com/submission/${submission.id}`,
      sourceSubmissionId: submission.id,
    });
  }

  return [...bestByProviderProblemId.values()];
}

function findProblemByCodeforcesProviderProblemId(
  catalogProblems: LocalCatalogProblemRecord[],
  providerProblemId: string,
): LocalCatalogProblemRecord | undefined {
  return catalogProblems.find((problem) =>
    problem.sources.some(
      (source) =>
        source.provider === "codeforces" &&
        source.provider_problem_id === providerProblemId,
    ),
  );
}

export async function importCodeforcesMember(payload: {
  memberId: string;
  handle: string;
  displayName?: string;
}): Promise<CodeforcesImportSummary> {
  const startedAt = new Date().toISOString();
  const submissions = await requestCodeforcesApi<CodeforcesSubmission[]>("user.status", {
    handle: payload.handle,
  });
  const normalizedStatuses = normalizeCodeforcesStatus(submissions);
  const catalogProblems = await listCatalogProblemsFromDb();
  const importedAt = new Date().toISOString();
  const sourceRecordId = `codeforces:${payload.handle}:${importedAt}`;

  const member: LocalMemberRecord = {
    memberId: payload.memberId,
    displayName: payload.displayName?.trim() || payload.memberId,
    createdAt: importedAt,
    updatedAt: importedAt,
  };

  const handles: LocalMemberHandleRecord[] = [
    {
      handleId: `codeforces:${payload.handle}`,
      memberId: payload.memberId,
      provider: "codeforces",
      handle: payload.handle,
      displayLabel: payload.displayName?.trim() || null,
      createdAt: importedAt,
      updatedAt: importedAt,
    },
  ];

  const candidateStatuses: Array<LocalMemberProblemStatusRecord | null> = normalizedStatuses
    .map((item) => {
      const matchedProblem = findProblemByCodeforcesProviderProblemId(
        catalogProblems,
        item.providerProblemId,
      );
      if (!matchedProblem) {
        return null;
      }
      return {
        statusId: `${payload.memberId}:${matchedProblem.problemId}:codeforces`,
        memberId: payload.memberId,
        problemId: matchedProblem.problemId,
        provider: "codeforces",
        status: item.status,
        firstSeenAt: importedAt,
        lastSeenAt: importedAt,
        sourceRecordId,
        matchMethod: "provider_id",
      };
    });

  const statuses = candidateStatuses.filter((item): item is LocalMemberProblemStatusRecord => !!item);

  const importSource: LocalImportSourceRecord = {
    sourceRecordId,
    kind: "codeforces_api",
    label: `Codeforces API import for ${payload.handle}`,
    importedAt,
    rawMetaJson: {
      handle: payload.handle,
      member_id: payload.memberId,
      submission_count: submissions.length,
      matched_status_count: statuses.length,
    },
  };

  const syncRecord: LocalSyncRecord = {
    syncId: `codeforces-member-sync:${payload.handle}:${importedAt}`,
    sourceRecordId,
    adapter: "codeforces_api",
    startedAt,
    finishedAt: importedAt,
    status: "succeeded",
    summaryJson: {
      handle: payload.handle,
      member_id: payload.memberId,
      submission_count: submissions.length,
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

  return {
    memberId: payload.memberId,
    handle: payload.handle,
    matchedStatusCount: statuses.length,
    submissionCount: submissions.length,
  };
}

export async function syncAllCodeforcesMembers(options?: {
  onProgress?: (payload: {
    currentIndex: number;
    totalMemberCount: number;
    memberId: string;
    displayName: string;
    handle: string;
  }) => void;
  signal?: AbortSignal;
}): Promise<{
  totalMemberCount: number;
  syncedMemberCount: number;
  failedMemberCount: number;
  cancelled: boolean;
  synced: CodeforcesImportSummary[];
  failed: Array<{
    memberId: string;
    displayName: string;
    handle: string;
    error: string;
  }>;
}> {
  const targets = await listCodeforcesMemberSyncTargets();
  const synced: CodeforcesImportSummary[] = [];
  const failed: Array<{
    memberId: string;
    displayName: string;
    handle: string;
    error: string;
  }> = [];
  let cancelled = false;

  for (const [index, target] of targets.entries()) {
    if (options?.signal?.aborted) {
      cancelled = true;
      break;
    }

    options?.onProgress?.({
      currentIndex: index + 1,
      totalMemberCount: targets.length,
      memberId: target.memberId,
      displayName: target.displayName,
      handle: target.handle,
    });

    try {
      const result = await importCodeforcesMember({
        memberId: target.memberId,
        handle: target.handle,
        displayName: target.displayName,
      });
      synced.push(result);
    } catch (error) {
      if (isAbortError(error) || options?.signal?.aborted) {
        cancelled = true;
        break;
      }
      failed.push({
        memberId: target.memberId,
        displayName: target.displayName,
        handle: target.handle,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    totalMemberCount: targets.length,
    syncedMemberCount: synced.length,
    failedMemberCount: failed.length,
    cancelled,
    synced,
    failed,
  };
}
