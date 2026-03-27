import type {
  CatalogSource,
} from "./catalog";
import {
  aggregateAliasesFromSources,
  mergeAliases,
  mergeCatalogSources,
} from "./catalog-sources";
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
  getCatalogContestDetailFromDb,
  listCatalogContestsFromDb,
  listCatalogContestProblemCountsFromDb,
  listCodeforcesMemberSyncTargets,
  listCatalogProblemsFromDb,
  upsertContestProblemSnapshot,
  upsertMemberBundle,
} from "./local-db";
import { loadCodeforcesApiCredentials, type CodeforcesApiCredentials } from "./codeforces-auth";

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

function buildCodeforcesContestAccessHint(providerContestId: string) {
  const hasSavedCredentials = !!loadCodeforcesApiCredentials();
  return hasSavedCredentials
    ? `Failed to fetch Codeforces contest ${providerContestId}. Your saved API credentials were used, but your account may still not have permission to view this contest. Private contests can also return incomplete data.`
    : `Failed to fetch Codeforces contest ${providerContestId}. If this is a private contest, save a Codeforces API key/secret on the Manage page and make sure your account has access. Private contests can also return incomplete data.`;
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

function inferCodeforcesSourceVariant(source: Pick<CatalogSource, "variant" | "url">): "gym_public" | "gym_private" {
  return source.variant?.trim() === "gym_private" ? "gym_private" : "gym_public";
}

function buildCodeforcesProblemUrl(contestSource: CatalogSource, ordinal: string): string {
  const normalizedUrl = contestSource.url.trim().replace(/\/+$/g, "");
  return `${normalizedUrl}/problem/${ordinal}`;
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

function findProblemByOrdinal(
  catalogProblems: LocalCatalogProblemRecord[],
  ordinal: string,
): LocalCatalogProblemRecord | undefined {
  return catalogProblems.find((problem) => problem.ordinal === ordinal);
}

function getCodeforcesContestSources(sources: CatalogSource[], providerContestId?: string | null) {
  return sources.filter(
    (source) =>
      source.provider === "codeforces" &&
      source.kind === "contest" &&
      !!source.provider_contest_id &&
      (!providerContestId || source.provider_contest_id === providerContestId),
  );
}

export async function syncCodeforcesContestProblems(
  contestId: string,
  options?: {
    providerContestId?: string | null;
    signal?: AbortSignal;
  },
): Promise<{
  contestId: string;
  providerContestIds: string[];
  sourceCount: number;
  problemCount: number;
  conflictCount: number;
}> {
  const detail = await getCatalogContestDetailFromDb(contestId);
  if (!detail) {
    throw new Error(`Unknown contest: ${contestId}`);
  }
  const contest = detail.contest;

  const codeforcesSources = getCodeforcesContestSources(contest.sources, options?.providerContestId);
  if (!codeforcesSources.length) {
    throw new Error("This contest does not have a Codeforces contest source");
  }

  const startedAt = new Date().toISOString();
  const importedAt = new Date().toISOString();
  const sourceRecordId = `codeforces-contest:${contestId}:${importedAt}`;
  const contestSourceTitles: Array<{
    provider_contest_id: string;
    source_title: string;
    variant: string | null;
  }> = [];
  const problemTitleConflicts: Array<{
    ordinal: string;
    problem_id: string;
    primary_title: string;
    source_title: string;
    provider_problem_id: string;
  }> = [];
  const problemsById = new Map(
    detail.problems.map((problem) => [
      problem.problemId,
      {
        ...problem,
        aliases: aggregateAliasesFromSources(problem.title, problem.aliases, problem.sources),
      },
    ]),
  );
  let mergedContestSources = [...contest.sources];

  for (const contestSource of codeforcesSources) {
    const providerContestId = contestSource.provider_contest_id;
    if (!providerContestId) {
      continue;
    }

    let standings: CodeforcesContestStandings;
    try {
      standings = await requestCodeforcesApi<CodeforcesContestStandings>(
        "contest.standings",
        {
          contestId: providerContestId,
          from: "1",
          count: "1",
        },
        undefined,
        options?.signal,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${buildCodeforcesContestAccessHint(providerContestId)} ${message}`);
    }
    const resolvedVariant = inferCodeforcesSourceVariant(contestSource);
    const normalizedContestSource: CatalogSource = {
      ...contestSource,
      variant: resolvedVariant,
      source_title: standings.contest.name || contestSource.source_title,
    };
    mergedContestSources = mergeCatalogSources(mergedContestSources, normalizedContestSource);
    contestSourceTitles.push({
      provider_contest_id: providerContestId,
      source_title: standings.contest.name,
      variant: resolvedVariant ?? null,
    });

    for (const problem of standings.problems.filter((item) => item.index)) {
      const ordinal = problem.index as string;
      const problemSource: CatalogSource = {
        provider: "codeforces",
        kind: "problem",
        variant: resolvedVariant,
        url: buildCodeforcesProblemUrl(normalizedContestSource, ordinal),
        provider_problem_id: `${providerContestId}:${ordinal}`,
        source_title: problem.name,
        label: `Codeforces ${ordinal}`,
      };
      const currentProblems = [...problemsById.values()];
      const matchedProblem =
        findProblemByCodeforcesProviderProblemId(currentProblems, problemSource.provider_problem_id!) ??
        findProblemByOrdinal(currentProblems, ordinal);

      if (!matchedProblem) {
        const primaryTitle = problem.name.trim();
        let problemId = `${contestId}:${ordinal}`;
        if (problemsById.has(problemId)) {
          problemId = `${contestId}:${providerContestId}:${ordinal}`;
        }
        const createdProblem: LocalCatalogProblemRecord = {
          problemId,
          contestId,
          ordinal,
          title: primaryTitle,
          aliases: aggregateAliasesFromSources(primaryTitle, [], [problemSource]),
          sources: [problemSource],
          sourceKind: "runtime_codeforces",
        };
        problemsById.set(createdProblem.problemId, createdProblem);
        continue;
      }

      if (problem.name.trim() && problem.name.trim().toLocaleLowerCase() !== matchedProblem.title.trim().toLocaleLowerCase()) {
        problemTitleConflicts.push({
          ordinal,
          problem_id: matchedProblem.problemId,
          primary_title: matchedProblem.title,
          source_title: problem.name.trim(),
          provider_problem_id: problemSource.provider_problem_id!,
        });
      }

      const nextSources = mergeCatalogSources(matchedProblem.sources, problemSource);
      const nextTitle = matchedProblem.title.trim() || problem.name.trim();
      problemsById.set(matchedProblem.problemId, {
        ...matchedProblem,
        title: nextTitle,
        aliases: aggregateAliasesFromSources(
          nextTitle,
          mergeAliases(nextTitle, matchedProblem.aliases, [problem.name]),
          nextSources,
        ),
        sources: nextSources,
        sourceKind: matchedProblem.sourceKind ?? "runtime_codeforces",
      });
    }
  }

  const problems = [...problemsById.values()].sort((left, right) =>
    left.ordinal.localeCompare(right.ordinal),
  );
  const nextContestTitle =
    contest.title.trim() || contestSourceTitles[0]?.source_title?.trim() || contest.title;
  const nextContest: LocalCatalogContestRecord = {
    ...contest,
    title: nextContestTitle,
    aliases: aggregateAliasesFromSources(nextContestTitle, contest.aliases, mergedContestSources),
    sources: mergedContestSources,
    problemIds: problems.map((problem) => problem.problemId),
  };

  const importSource: LocalImportSourceRecord = {
    sourceRecordId,
    kind: "codeforces_api",
    label: `Codeforces contest import for ${contestId}`,
    importedAt,
    rawMetaJson: {
      contest_id: contestId,
      provider_contest_ids: contestSourceTitles.map((source) => source.provider_contest_id),
      source_count: contestSourceTitles.length,
      source_titles: contestSourceTitles,
      problem_count: problems.length,
      problem_title_conflicts: problemTitleConflicts,
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
      provider_contest_ids: contestSourceTitles.map((source) => source.provider_contest_id),
      source_count: contestSourceTitles.length,
      problem_count: problems.length,
      problem_title_conflict_count: problemTitleConflicts.length,
      problem_title_conflicts: problemTitleConflicts,
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
    providerContestIds: contestSourceTitles.map((source) => source.provider_contest_id),
    sourceCount: contestSourceTitles.length,
    problemCount: problems.length,
    conflictCount: problemTitleConflicts.length,
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
    providerContestIds: string[];
    sourceCount: number;
    problemCount: number;
    conflictCount: number;
  }>;
  failed: Array<{
    contestId: string;
    contestTitle: string;
    error: string;
  }>;
}> {
  const contests = await listCatalogContestsFromDb();
  const problemCountsByContestId = await listCatalogContestProblemCountsFromDb();
  const codeforcesContests = contests.filter((contest) =>
    contest.sources.some((source) => source.provider === "codeforces" && source.provider_contest_id),
  );
  const pendingContests = codeforcesContests.filter((contest) => (problemCountsByContestId.get(contest.contestId) ?? 0) === 0);
  const alreadySyncedCount = codeforcesContests.length - pendingContests.length;

  const synced: Array<{
    contestId: string;
    providerContestIds: string[];
    sourceCount: number;
    problemCount: number;
    conflictCount: number;
  }> = [];
  const failed: Array<{
    contestId: string;
    contestTitle: string;
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
        contestTitle: contest.title,
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
