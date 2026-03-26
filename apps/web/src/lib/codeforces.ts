import type {
  CatalogSource,
} from "./catalog";
import type {
  LocalCatalogContestRecord,
  LocalCatalogProblemRecord,
  LocalImportSourceRecord,
  LocalMemberHandleRecord,
  LocalMemberProblemStatusRecord,
  LocalMemberRecord,
  LocalSyncRecord,
} from "./local-model";
import {
  getCatalogContestFromDb,
  listCatalogContestsFromDb,
  listCodeforcesMemberSyncTargets,
  listCatalogProblemsFromDb,
  upsertContestProblemSnapshot,
  upsertMemberBundle,
} from "./local-db";

type CodeforcesSubmission = {
  id: number;
  verdict?: string;
  problem?: {
    contestId?: number;
    index?: string;
    name?: string;
  };
};

type CodeforcesContestStandings = {
  contest: {
    id: number;
    name: string;
  };
  problems: Array<{
    contestId?: number;
    index?: string;
    name: string;
  }>;
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

async function requestCodeforcesApi<T>(
  method: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`https://codeforces.com/api/${method}`);
  for (const [key, value] of Object.entries(params)) {
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

function getCodeforcesContestSource(sources: CatalogSource[]) {
  return sources.find((source) => source.provider === "codeforces" && source.provider_contest_id);
}

export async function syncCodeforcesContestProblems(
  contestId: string,
  options?: {
    signal?: AbortSignal;
  },
): Promise<{
  contestId: string;
  providerContestId: string;
  problemCount: number;
}> {
  const contest = await getCatalogContestFromDb(contestId);
  if (!contest) {
    throw new Error(`Unknown contest: ${contestId}`);
  }

  const codeforcesSource = getCodeforcesContestSource(contest.sources);
  if (!codeforcesSource?.provider_contest_id) {
    throw new Error("This contest does not have a Codeforces contest source");
  }

  const startedAt = new Date().toISOString();
  const standings = await requestCodeforcesApi<CodeforcesContestStandings>("contest.standings", {
    contestId: codeforcesSource.provider_contest_id,
    from: "1",
    count: "1",
  }, options?.signal);
  const importedAt = new Date().toISOString();
  const sourceRecordId = `codeforces-contest:${contestId}:${importedAt}`;

  const problems: LocalCatalogProblemRecord[] = standings.problems
    .filter((problem) => problem.index)
    .map((problem) => ({
      problemId: `${contestId}:${problem.index}`,
      contestId,
      ordinal: problem.index as string,
      title: problem.name,
      aliases: [],
      sources: [
        {
          provider: "codeforces",
          kind: "problem",
          url: `https://codeforces.com/gym/${codeforcesSource.provider_contest_id}/problem/${problem.index}`,
          provider_problem_id: `${codeforcesSource.provider_contest_id}:${problem.index}`,
          label: `Codeforces ${problem.index}`,
        },
      ],
      sourceKind: "runtime_codeforces",
    }));

  const nextContest: LocalCatalogContestRecord = {
    ...contest,
    title: standings.contest.name || contest.title,
    problemIds: problems.map((problem) => problem.problemId),
  };

  const importSource: LocalImportSourceRecord = {
    sourceRecordId,
    kind: "codeforces_api",
    label: `Codeforces contest import for ${contestId}`,
    importedAt,
    rawMetaJson: {
      contest_id: contestId,
      provider_contest_id: codeforcesSource.provider_contest_id,
      problem_count: problems.length,
    },
  };

  const syncRecord: LocalSyncRecord = {
    syncId: `codeforces-contest-sync:${contestId}:${importedAt}`,
    sourceRecordId,
    adapter: "codeforces_api",
    startedAt,
    finishedAt: importedAt,
    status: "succeeded",
    summaryJson: {
      contest_id: contestId,
      provider_contest_id: codeforcesSource.provider_contest_id,
      problem_count: problems.length,
    },
  };

  await upsertContestProblemSnapshot({
    contest: nextContest,
    problems,
    importSource,
    syncRecord,
  });

  return {
    contestId,
    providerContestId: codeforcesSource.provider_contest_id,
    problemCount: problems.length,
  };
}

export async function syncAllCodeforcesContests(options?: {
  onProgress?: (payload: {
    currentIndex: number;
    pendingContestCount: number;
    alreadySyncedCount: number;
    contestId: string;
    contestTitle: string;
  }) => void;
  signal?: AbortSignal;
}): Promise<{
  totalContestCount: number;
  pendingContestCount: number;
  skippedContestCount: number;
  syncedContestCount: number;
  failedContestCount: number;
  cancelled: boolean;
  synced: Array<{
    contestId: string;
    providerContestId: string;
    problemCount: number;
  }>;
  failed: Array<{
    contestId: string;
    error: string;
  }>;
}> {
  const contests = await listCatalogContestsFromDb();
  const codeforcesContests = contests.filter((contest) =>
    contest.sources.some((source) => source.provider === "codeforces" && source.provider_contest_id),
  );
  const pendingContests = codeforcesContests.filter((contest) => contest.problemIds.length === 0);
  const alreadySyncedCount = codeforcesContests.length - pendingContests.length;

  const synced: Array<{
    contestId: string;
    providerContestId: string;
    problemCount: number;
  }> = [];
  const failed: Array<{
    contestId: string;
    error: string;
  }> = [];
  let cancelled = false;

  for (const [index, contest] of pendingContests.entries()) {
    if (options?.signal?.aborted) {
      cancelled = true;
      break;
    }
    options?.onProgress?.({
      currentIndex: index + 1,
      pendingContestCount: pendingContests.length,
      alreadySyncedCount,
      contestId: contest.contestId,
      contestTitle: contest.title,
    });
    try {
      const result = await syncCodeforcesContestProblems(contest.contestId, {
        signal: options?.signal,
      });
      synced.push(result);
    } catch (error) {
      if (isAbortError(error) || options?.signal?.aborted) {
        cancelled = true;
        break;
      }
      failed.push({
        contestId: contest.contestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    totalContestCount: codeforcesContests.length,
    pendingContestCount: pendingContests.length,
    skippedContestCount: alreadySyncedCount,
    syncedContestCount: alreadySyncedCount + synced.length,
    failedContestCount: failed.length,
    cancelled,
    synced,
    failed,
  };
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
  const statuses = candidateStatuses.filter((item): item is LocalMemberProblemStatusRecord => item !== null);

  const importSource: LocalImportSourceRecord = {
    sourceRecordId,
    kind: "codeforces_api",
    label: `Codeforces API import for ${payload.handle}`,
    importedAt,
    rawMetaJson: {
      handle: payload.handle,
      submission_count: submissions.length,
      normalized_problem_status_count: normalizedStatuses.length,
      matched_status_count: statuses.length,
    },
  };

  const syncRecord: LocalSyncRecord = {
    syncId: `codeforces-sync:${payload.handle}:${importedAt}`,
    sourceRecordId,
    adapter: "codeforces_api",
    startedAt,
    finishedAt: importedAt,
    status: "succeeded",
    summaryJson: {
      handle: payload.handle,
      submission_count: submissions.length,
      normalized_problem_status_count: normalizedStatuses.length,
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
    handle: string;
    error: string;
  }>;
}> {
  const targets = await listCodeforcesMemberSyncTargets();
  const synced: CodeforcesImportSummary[] = [];
  const failed: Array<{
    memberId: string;
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
