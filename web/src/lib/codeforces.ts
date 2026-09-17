import type {
  LocalCatalogProblemRecord,
  LocalImportSourceRecord,
  LocalMemberHandleRecord,
  LocalMemberProblemStatusRecord,
  LocalMemberRecord,
  LocalSyncRecord,
} from "./local-model";
import { listRuntimeCatalogProblemsForImport } from "./catalog-runtime";
import {
  localDb,
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

function findProblemsByCodeforcesProviderProblemId(
  catalogProblems: LocalCatalogProblemRecord[],
  providerProblemId: string,
): LocalCatalogProblemRecord[] {
  return catalogProblems.filter((problem) =>
    problem.sources.some(
      (source) =>
        source.provider === "codeforces" &&
        source.provider_problem_id === providerProblemId,
    ),
  );
}

type SyncOptions = {automatic?: boolean; signal?: AbortSignal};

export async function importCodeforcesMember(payload: {
  memberId: string;
  handle: string;
  displayName?: string;
}, options: SyncOptions = {}): Promise<CodeforcesImportSummary> {
  const skipped = {memberId:payload.memberId,handle:payload.handle,matchedStatusCount:0,submissionCount:0};
  const run = async () => {
    options.signal?.throwIfAborted();
    const history = (await localDb.syncRecords.toArray()).filter(r => r.adapter === 'codeforces_api');
    const latest = history.filter(r => r.summaryJson.handle === payload.handle && r.summaryJson.member_id === payload.memberId).sort((a,b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (options.automatic && latest && (Date.now()-Date.parse(latest.startedAt)<30*60000 || (latest.status==='failed' && latest.summaryJson.manual !== false))) return skipped;
    const recent = Math.max(0,...history.map(r=>Date.parse(r.finishedAt || r.startedAt)).filter(Number.isFinite));
    const wait = Math.max(0,2100-(Date.now()-recent));
    if (wait) await new Promise<void>((resolve,reject)=>{
      const done=()=>{options.signal?.removeEventListener('abort',abort);resolve();};
      const timer=setTimeout(done,wait);
      const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};
      options.signal?.addEventListener('abort',abort,{once:true});
      if(options.signal?.aborted)abort();
    });
    return performCodeforcesImport(payload,options);
  };
  const locks = globalThis.navigator?.locks;
  if (!locks) return options.automatic ? skipped : run();
  return locks.request('xcpc-codeforces-sync',{...(options.automatic ? {ifAvailable:true} : {signal:options.signal})},async lock=>lock ? run() : skipped);
}

async function performCodeforcesImport(payload: {memberId:string;handle:string;displayName?:string}, options:SyncOptions): Promise<CodeforcesImportSummary> {
  const startedAt = new Date().toISOString();
  try { return await importCodeforcesMemberData(payload,options); }
  catch (error) {
    const finishedAt = new Date().toISOString();
    const sourceRecordId = `codeforces:${payload.handle}:${finishedAt}:failed`;
    const summary = {handle: payload.handle, member_id: payload.memberId, manual:!options.automatic, fetch_error: error instanceof Error ? error.message : String(error)};
    await localDb.transaction('rw', [localDb.importSources, localDb.syncRecords], async () => {
      await localDb.importSources.put({sourceRecordId, kind:'codeforces_api', label:`Codeforces sync failed: ${payload.handle}`, importedAt:finishedAt, rawMetaJson:summary});
      await localDb.syncRecords.put({syncId:sourceRecordId, sourceRecordId, adapter:'codeforces_api', startedAt, finishedAt, status:'failed', summaryJson:summary});
    });
    throw error;
  }
}

async function importCodeforcesMemberData(payload: {
  memberId: string;
  handle: string;
  displayName?: string;
}, options: SyncOptions): Promise<CodeforcesImportSummary> {
  const startedAt = new Date().toISOString();
  const submissions = await requestCodeforcesApi<CodeforcesSubmission[]>("user.status", {
    handle: payload.handle,
  }, undefined, options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000));
  const normalizedStatuses = normalizeCodeforcesStatus(submissions);
  const catalogProblems = await listRuntimeCatalogProblemsForImport();
  const problemsByProviderId = new Map<string, LocalCatalogProblemRecord[]>();
  for (const problem of catalogProblems) for (const source of problem.sources) {
    if (source.provider !== 'codeforces' || !source.provider_problem_id) continue;
    const bucket = problemsByProviderId.get(source.provider_problem_id) ?? [];
    if (!bucket.includes(problem)) bucket.push(problem);
    problemsByProviderId.set(source.provider_problem_id, bucket);
  }
  const unmatchedStatuses = normalizedStatuses.filter(item => !problemsByProviderId.has(item.providerProblemId));
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

  const statuses: LocalMemberProblemStatusRecord[] = normalizedStatuses.flatMap((item) => {
    const matchedProblems = problemsByProviderId.get(item.providerProblemId) ?? [];
    return matchedProblems.map((matchedProblem) => ({
      statusId: `${payload.memberId}:${matchedProblem.problemId}:codeforces`,
      memberId: payload.memberId,
      problemId: matchedProblem.problemId,
      provider: "codeforces" as const,
      status: item.status,
      firstSeenAt: importedAt,
      lastSeenAt: importedAt,
      sourceRecordId,
      matchMethod: "provider_id" as const,
    }));
  });

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
      unmatched_status_count: unmatchedStatuses.length,
      unmatched_problem_statuses: unmatchedStatuses,
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
      manual: !options.automatic,
      submission_count: submissions.length,
      matched_status_count: statuses.length,
      unmatched_status_count: importSource.rawMetaJson.unmatched_status_count,
    },
  };

  options.signal?.throwIfAborted();
  if (options.automatic && !(await listCodeforcesMemberSyncTargets()).some(t=>t.memberId===payload.memberId && t.handle===payload.handle)) throw new DOMException('Member removed','AbortError');
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
      }, {signal: options?.signal});
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
