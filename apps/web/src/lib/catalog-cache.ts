import type { CatalogContestDetail, CatalogContestIndex } from "./catalog";
import { fetchGeneratedCatalogBundle } from "./catalog";
import type {
  LocalCatalogContestRecord,
  LocalCatalogProblemRecord,
  LocalImportSourceRecord,
  LocalSyncRecord,
} from "./local-model";
import {
  mergeGeneratedCatalogSnapshot,
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
    aliases: detail.aliases,
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
  return detail.problems.map((problem) => ({
    problemId: problem.id,
    contestId: detail.id,
    ordinal: problem.ordinal,
    title: problem.title,
    aliases: problem.aliases,
    sources: problem.sources.map((source) => ({
      ...source,
      provider_problem_id:
        source.provider_problem_id ??
        (source.provider === "codeforces" && source.kind === "problem"
          ? `${detail.sources.find((contestSource) => contestSource.provider === "codeforces")?.provider_contest_id ?? ""}:${problem.ordinal}`
          : undefined),
    })),
  }));
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

export async function seedCatalogCache(): Promise<void> {
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
  const finishedAt = new Date().toISOString();
  const importSource: LocalImportSourceRecord = {
    sourceRecordId: `catalog-seed:${bundle.generated_at}`,
    kind: "catalog",
    label: "Generated catalog incremental seed",
    importedAt: finishedAt,
    rawMetaJson: {
      generated_at: bundle.generated_at,
      contest_count: bundle.contest_count,
    },
  };
  const syncRecord: LocalSyncRecord = {
    syncId: `catalog-seed-sync:${finishedAt}`,
    sourceRecordId: importSource.sourceRecordId,
    adapter: "catalog",
    startedAt,
    finishedAt,
    status: "succeeded",
    summaryJson: {
      contest_count: index.contest_count,
    },
  };
  await mergeGeneratedCatalogSnapshot({
    contests: bundle.contests.map(mapContest),
    problems: bundle.contests.flatMap(mapProblems),
    importSource,
    syncRecord,
  });
}
