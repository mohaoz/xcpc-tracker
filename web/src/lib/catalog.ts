import { aggregateAliasesFromSources } from "./catalog-sources";

export type CatalogContestIndexItem = {
  id: string;
  title: string;
  aliases: string[];
  tags: string[];
  curation_status: "contest_stub" | "problem_listed" | "reviewed";
  problem_count: number;
};

export type CatalogContestIndex = {
  generated_at: string;
  source: string;
  contest_count: number;
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

async function requestStaticJson<T>(path: string, options?: { cacheMode?: RequestCache }): Promise<T> {
  const response = await fetch(path, {
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

export function resetCatalogFetchCache(): void {
  catalogBundlePromise = null;
  catalogSnapshotPromise = null;
}

export async function fetchBundledCatalogSnapshot(options?: { forceRefresh?: boolean }): Promise<CatalogSnapshotBundle> {
  if (options?.forceRefresh) {
    resetCatalogFetchCache();
    catalogSnapshotPromise = requestStaticJson<CatalogSnapshotBundle>("/default-catalog.min.json", {
      cacheMode: "reload",
    });
    return catalogSnapshotPromise;
  }

  catalogSnapshotPromise ??= requestStaticJson<CatalogSnapshotBundle>("/default-catalog.min.json");
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
  const bundle = await fetchGeneratedCatalogBundle();
  return {
    generated_at: bundle.generated_at,
    source: bundle.source,
    contest_count: bundle.contest_count,
    contests: bundle.contests.map((contest) => ({
      id: contest.id,
      title: contest.title,
      aliases: contest.aliases,
      tags: contest.tags,
      curation_status: contest.curation_status,
      problem_count: contest.problem_count ?? contest.problems.length,
    })),
  };
}

export async function fetchCatalogContestDetail(contestId: string): Promise<CatalogContestDetail> {
  const bundle = await fetchGeneratedCatalogBundle();
  const contest = bundle.contests.find((item) => item.id === contestId);
  if (!contest) {
    throw new Error(`Unknown contest: ${contestId}`);
  }
  return contest;
}
