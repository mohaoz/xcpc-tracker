import { aggregateAliasesFromSources } from "./catalog-sources";

export type CatalogContestIndexItem = {
  id: string;
  title: string;
  aliases: string[];
  tags: string[];
  start_at?: string | null;
  curation_status: "contest_stub" | "problem_listed" | "reviewed";
  sources?: CatalogSource[];
  awardCutoffs?: CatalogAwardCutoffs | null;
  notes?: string | null;
  generated_from?: string;
  problem_count: number;
};

export type CatalogContestIndex = {
  generated_at: string;
  source: string;
  contest_count: number;
  problem_count?: number;
  contests: CatalogContestIndexItem[];
};

export type CatalogSource = {
  provider: string;
  kind: string;
  url?: string;
  provider_contest_id?: string;
  provider_problem_id?: string;
  source_title?: string;
  label?: string;
};

export type CatalogAwardCutoff = {
  rank: number;
  solved: number;
  penalty: number;
  teamId: string;
};

export type CatalogAwardCutoffs = {
  source: "explicit" | "inferred_official_medal_ratio_10_20_30" | "inferred_all_teams_medal_ratio_10_20_30" | string;
  sourceProvider: string;
  sourceLabel: string;
  sourceUrl: string;
  eligibleTeamCount: number;
  cutoffs: Record<"gold" | "silver" | "bronze", CatalogAwardCutoff | null>;
};

export type CatalogProblem = {
  id: string;
  ordinal: string;
  title: string;
  aliases: string[];
  sources: CatalogSource[];
};

export type CatalogContestDetail = {
  id: string;
  title: string;
  aliases: string[];
  tags: string[];
  start_at?: string | null;
  curation_status: "contest_stub" | "problem_listed" | "reviewed";
  sources: CatalogSource[];
  awardCutoffs?: CatalogAwardCutoffs;
  problems: CatalogProblem[];
  notes?: string;
  generated_from?: string;
  problem_count?: number;
};

export type GeneratedCatalogBundle = {
  generated_at: string;
  source: string;
  contest_count: number;
  contests: CatalogContestDetail[];
};

type CatalogSnapshotSource = {
  provider: string;
  kind: string;
  url?: string;
  provider_contest_id?: string;
  provider_problem_id?: string;
  source_title?: string;
  label?: string;
};

type CatalogSnapshotContest = {
  contestId: string;
  title: string;
  aliases: string[];
  tags: string[];
  startAt?: string | null;
  curationStatus: "contest_stub" | "problem_listed" | "reviewed";
  problemIds: string[];
  sources: CatalogSnapshotSource[];
  awardCutoffs?: CatalogAwardCutoffs;
  notes?: string;
  generatedFrom?: string;
};

type CatalogSnapshotProblem = {
  problemId: string;
  contestId: string;
  ordinal: string;
  title: string;
  aliases: string[];
  sources: CatalogSnapshotSource[];
};

export type CatalogSnapshotBundle = {
  schemaVersion: number;
  exportKind: "local_catalog_snapshot";
  version?: string;
  exportedAt: string;
  contests: CatalogSnapshotContest[];
  problems: CatalogSnapshotProblem[];
};

export type CatalogCoverageBasis = {
  generated_at: string;
  contest_count: number;
  problem_count: number;
  contests: Array<{
    contestId: string;
    problems: Array<{
      problemId: string;
      ordinal: string;
      title: string;
    }>;
  }>;
};

export type CatalogProblemLookup = {
  generated_at: string;
  problem_count: number;
  problems: CatalogSnapshotProblem[];
};

async function requestStaticJson<T>(path: string, options?: { cacheMode?: RequestCache }): Promise<T> {
  const normalizedBaseUrl = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  const response = await fetch(`${normalizedBaseUrl}${normalizedPath}`, {
    headers: {
      "Content-Type": "application/json",
    },
    cache: options?.cacheMode ?? "default",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

let catalogBundlePromise: Promise<GeneratedCatalogBundle> | null = null;
let catalogSnapshotPromise: Promise<CatalogSnapshotBundle> | null = null;
let contestIndexPromise: Promise<CatalogContestIndex> | null = null;
let coverageBasisPromise: Promise<CatalogCoverageBasis> | null = null;
let problemLookupPromise: Promise<CatalogProblemLookup> | null = null;
const contestDetailPromiseMap = new Map<string, Promise<CatalogContestDetail>>();

export function resetCatalogFetchCache(): void {
  catalogBundlePromise = null;
  catalogSnapshotPromise = null;
  contestIndexPromise = null;
  coverageBasisPromise = null;
  problemLookupPromise = null;
  contestDetailPromiseMap.clear();
}

export async function fetchBundledCatalogSnapshot(options?: { forceRefresh?: boolean }): Promise<CatalogSnapshotBundle> {
  if (options?.forceRefresh) {
    resetCatalogFetchCache();
    catalogSnapshotPromise = requestStaticJson<CatalogSnapshotBundle>("default-catalog.min.json", {
      cacheMode: "reload",
    });
    return catalogSnapshotPromise;
  }

  catalogSnapshotPromise ??= requestStaticJson<CatalogSnapshotBundle>("default-catalog.min.json");
  return catalogSnapshotPromise;
}

export async function fetchGeneratedCatalogBundle(options?: { forceRefresh?: boolean }): Promise<GeneratedCatalogBundle> {
  if (options?.forceRefresh) {
    resetCatalogFetchCache();
  }

  catalogBundlePromise ??= fetchBundledCatalogSnapshot(options).then((snapshot) => {
    const problemsByContestId = new Map<string, CatalogProblem[]>();
    for (const problem of snapshot.problems) {
      const bucket = problemsByContestId.get(problem.contestId) ?? [];
      bucket.push({
        id: problem.problemId,
        ordinal: problem.ordinal,
        title: problem.title,
        aliases: aggregateAliasesFromSources(problem.title, problem.aliases ?? [], problem.sources ?? []),
        sources: problem.sources ?? [],
      });
      problemsByContestId.set(problem.contestId, bucket);
    }

    return {
      generated_at: snapshot.exportedAt,
      source: "catalog/default-catalog.min.json",
      contest_count: snapshot.contests.length,
      contests: snapshot.contests.map((contest) => ({
        id: contest.contestId,
        title: contest.title,
        aliases: aggregateAliasesFromSources(contest.title, contest.aliases ?? [], contest.sources ?? []),
        tags: contest.tags ?? [],
        start_at: contest.startAt ?? null,
        curation_status: contest.curationStatus,
        sources: contest.sources ?? [],
        awardCutoffs: contest.awardCutoffs,
        problems: (problemsByContestId.get(contest.contestId) ?? []).sort((left, right) =>
          left.ordinal.localeCompare(right.ordinal),
        ),
        notes: contest.notes,
        generated_from: contest.generatedFrom ?? "catalog",
        problem_count: contest.problemIds?.length ?? 0,
      })),
    } satisfies GeneratedCatalogBundle;
  });
  return catalogBundlePromise;
}

export async function fetchCatalogContestIndex(): Promise<CatalogContestIndex> {
  contestIndexPromise ??= requestStaticJson<CatalogContestIndex>("generated/contest-index.json");
  return contestIndexPromise;
}

export async function fetchCatalogContestDetail(contestId: string): Promise<CatalogContestDetail> {
  const cacheKey = encodeURIComponent(contestId);
  const cached = contestDetailPromiseMap.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = requestStaticJson<CatalogContestDetail>(`generated/contests/${cacheKey}.json`);
  contestDetailPromiseMap.set(cacheKey, request);
  return request;
}

export async function fetchCatalogCoverageBasis(): Promise<CatalogCoverageBasis> {
  coverageBasisPromise ??= requestStaticJson<CatalogCoverageBasis>("generated/coverage-basis.json");
  return coverageBasisPromise;
}

export async function fetchCatalogProblemLookup(options?: { forceRefresh?: boolean }): Promise<CatalogProblemLookup> {
  if (options?.forceRefresh) {
    problemLookupPromise = requestStaticJson<CatalogProblemLookup>("generated/problem-lookup.json", {
      cacheMode: "reload",
    });
    return problemLookupPromise;
  }

  problemLookupPromise ??= requestStaticJson<CatalogProblemLookup>("generated/problem-lookup.json");
  return problemLookupPromise;
}
