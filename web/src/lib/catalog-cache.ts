import type { CatalogContestDetail, CatalogContestIndex } from "./catalog";
import { aggregateAliasesFromSources } from "./catalog-sources";
import { fetchBundledCatalogSnapshot, fetchGeneratedCatalogBundle } from "./catalog";
import type {
  LocalCatalogContestRecord,
  LocalCatalogSnapshot,
  LocalCatalogProblemRecord,
  LocalImportSourceRecord,
  LocalSyncRecord,
} from "./local-model";
import {
  applyLocalCatalogSnapshot,
  refreshGeneratedCatalogSnapshot,
} from "./local-db";

function buildCatalogImportSource(index: CatalogContestIndex): LocalImportSourceRecord {
  return {
    sourceRecordId: `catalog:${index.generated_at}`,
    kind: "catalog",
    label: "Generated catalog snapshot",
    importedAt: index.generated_at,
    rawMetaJson: {
      generated_at: index.generated_at,
      source: index.source,
      contest_count: index.contest_count,
    },
  };
}

function buildCatalogSyncRecord(sourceRecordId: string, startedAt: string, finishedAt: string, contestCount: number): LocalSyncRecord {
  return {
    syncId: `catalog-sync:${finishedAt}`,
    sourceRecordId,
    adapter: "catalog",
    startedAt,
    finishedAt,
    status: "succeeded",
    summaryJson: {
      contest_count: contestCount,
    },
  };
}

function mapContest(detail: CatalogContestDetail): LocalCatalogContestRecord {
  return {
    contestId: detail.id,
    title: detail.title,
    aliases: aggregateAliasesFromSources(detail.title, detail.aliases, detail.sources),
    tags: detail.tags,
    startAt: detail.start_at ?? null,
    curationStatus: detail.curation_status,
    problemIds: detail.problems.map((problem) => problem.id),
    sources: detail.sources,
    notes: detail.notes ?? null,
    generatedFrom: detail.generated_from ?? null,
  };
}

function mapProblems(detail: CatalogContestDetail): LocalCatalogProblemRecord[] {
  const primaryCodeforcesContestSource = detail.sources.find(
    (contestSource) => contestSource.provider === "codeforces" && contestSource.kind === "contest" && contestSource.provider_contest_id,
  );

  return detail.problems.map((problem) => ({
    problemId: problem.id,
    contestId: detail.id,
    ordinal: problem.ordinal,
    title: problem.title,
    aliases: aggregateAliasesFromSources(problem.title, problem.aliases, problem.sources),
    sources: [
      ...problem.sources.map((source) => ({
        ...source,
      })),
      ...(!problem.sources.some((source) => source.provider === "codeforces" && source.kind === "problem") && primaryCodeforcesContestSource?.provider_contest_id
        ? [
            {
              provider: "codeforces",
              kind: "problem",
              url: `https://codeforces.com/gym/${primaryCodeforcesContestSource.provider_contest_id}/problem/${problem.ordinal}`,
              provider_problem_id: `${primaryCodeforcesContestSource.provider_contest_id}:${problem.ordinal}`,
              label: `Codeforces ${problem.ordinal}`,
            },
          ]
        : []),
    ],
  }));
}

export async function loadBundledCatalogSnapshot(): Promise<LocalCatalogSnapshot> {
  const snapshot = await fetchBundledCatalogSnapshot();
  return {
    schemaVersion: 1,
    exportKind: "local_catalog_snapshot",
    exportedAt: snapshot.exportedAt,
    contests: snapshot.contests.map((contest) => ({
      contestId: contest.contestId,
      title: contest.title,
      aliases: aggregateAliasesFromSources(contest.title, contest.aliases ?? [], contest.sources ?? []),
      tags: contest.tags ?? [],
      startAt: contest.startAt ?? null,
      curationStatus: contest.curationStatus,
      problemIds: contest.problemIds ?? [],
      sources: contest.sources ?? [],
      notes: contest.notes ?? null,
      generatedFrom: contest.generatedFrom ?? "catalog",
      deletedAt: null,
    })),
    problems: snapshot.problems.map((problem) => ({
      problemId: problem.problemId,
      contestId: problem.contestId,
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: aggregateAliasesFromSources(problem.title, problem.aliases ?? [], problem.sources ?? []),
      sources: problem.sources ?? [],
    })),
  };
}

export async function importBundledCatalogSnapshot(options?: {
  mode?: "merge" | "replace";
  includeProblems?: boolean;
}): Promise<LocalCatalogSnapshot> {
  const snapshot = await loadBundledCatalogSnapshot();
  await applyLocalCatalogSnapshot(snapshot, options);
  return snapshot;
}

export async function refreshCatalogCache(): Promise<void> {
  const startedAt = new Date().toISOString();
  const bundle = await fetchGeneratedCatalogBundle();
  const index: CatalogContestIndex = {
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
  const details: CatalogContestDetail[] = bundle.contests;
  const finishedAt = new Date().toISOString();

  const importSource = buildCatalogImportSource(index);
  const syncRecord = buildCatalogSyncRecord(
    importSource.sourceRecordId,
    startedAt,
    finishedAt,
    details.length,
  );

  await refreshGeneratedCatalogSnapshot({
    contests: details.map(mapContest),
    problems: details.flatMap(mapProblems),
    importSource,
    syncRecord,
  });
}
