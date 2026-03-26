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
  url: string;
  provider_contest_id?: string;
  provider_problem_id?: string;
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

async function requestStaticJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

let catalogBundlePromise: Promise<GeneratedCatalogBundle> | null = null;

export async function fetchGeneratedCatalogBundle(): Promise<GeneratedCatalogBundle> {
  catalogBundlePromise ??= requestStaticJson<GeneratedCatalogBundle>("/catalog.json");
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
