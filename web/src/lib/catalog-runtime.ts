import {
  fetchCatalogContestDetail,
  fetchCatalogContestIndex,
  fetchCatalogCoverageBasis,
  fetchCatalogProblemLookup,
  type CatalogContestDetail,
  type CatalogContestIndexItem,
} from "./catalog";
import type { LocalCatalogContestRecord, LocalCatalogProblemRecord } from "./local-model";
import {
  getCatalogContestFromDb,
  getCatalogContestDetailFromDb,
  hasDeletedCatalogContestId,
  listCatalogContestsFromDb,
  listCatalogProblemsFromDb,
  listContestProblemsByContestIdsFromDb,
} from "./local-db";

export type RuntimeCatalogContestListRecord = LocalCatalogContestRecord & {
  problemCount: number;
};

function mapBundledIndexItemToContestRecord(item: CatalogContestIndexItem): RuntimeCatalogContestListRecord {
  return {
    contestId: item.id,
    title: item.title,
    aliases: item.aliases ?? [],
    tags: item.tags ?? [],
    startAt: item.start_at ?? null,
    curationStatus: item.curation_status,
    problemIds: [],
    sources: item.sources ?? [],
    awardCutoffs: item.awardCutoffs ?? undefined,
    notes: item.notes ?? null,
    generatedFrom: item.generated_from ?? "catalog",
    deletedAt: null,
    problemCount: item.problem_count ?? 0,
  };
}

function mapBundledContestDetailToLocal(
  detail: CatalogContestDetail,
): { contest: LocalCatalogContestRecord; problems: LocalCatalogProblemRecord[] } {
  return {
    contest: {
      contestId: detail.id,
      title: detail.title,
      aliases: detail.aliases ?? [],
      tags: detail.tags ?? [],
      startAt: detail.start_at ?? null,
      curationStatus: detail.curation_status,
      problemIds: detail.problems.map((problem) => problem.id),
      sources: detail.sources ?? [],
      awardCutoffs: detail.awardCutoffs,
      notes: detail.notes ?? null,
      generatedFrom: detail.generated_from ?? "catalog",
      deletedAt: null,
    },
    problems: detail.problems.map((problem) => ({
      problemId: problem.id,
      contestId: detail.id,
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: problem.aliases ?? [],
      sources: problem.sources ?? [],
    })),
  };
}

function shouldUseLocalCatalogContest(contest: LocalCatalogContestRecord, hasBundledContest: boolean): boolean {
  return !hasBundledContest || contest.generatedFrom === "manual";
}

export async function listRuntimeCatalogProblemsForImport(): Promise<LocalCatalogProblemRecord[]> {
  const [problemLookup, localProblems, localContests] = await Promise.all([
    fetchCatalogProblemLookup(),
    listCatalogProblemsFromDb(),
    listCatalogContestsFromDb({ includeDeleted: true }),
  ]);
  const bundledContestIds = new Set(problemLookup.problems.map((problem) => problem.contestId));
  const localContestById = new Map(localContests.map((contest) => [contest.contestId, contest]));
  const mergedByProblemId = new Map<string, LocalCatalogProblemRecord>();

  for (const problem of problemLookup.problems) {
    const localContest = localContestById.get(problem.contestId);
    if (localContest?.deletedAt || localContest?.generatedFrom === "manual") {
      continue;
    }

    mergedByProblemId.set(problem.problemId, {
      problemId: problem.problemId,
      contestId: problem.contestId,
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: problem.aliases ?? [],
      sources: problem.sources ?? [],
      sourceKind: "catalog",
    });
  }

  for (const problem of localProblems) {
    const localContest = localContestById.get(problem.contestId);
    if (localContest?.deletedAt) {
      continue;
    }
    if (bundledContestIds.has(problem.contestId) && localContest?.generatedFrom !== "manual") {
      continue;
    }

    mergedByProblemId.set(problem.problemId, problem);
  }

  return [...mergedByProblemId.values()];
}

export async function listRuntimeCatalogContests(): Promise<{
  generatedAt: string;
  contests: RuntimeCatalogContestListRecord[];
}> {
  const [bundledIndex, localContests] = await Promise.all([
    fetchCatalogContestIndex(),
    listCatalogContestsFromDb({ includeDeleted: true }),
  ]);

  const contestMap = new Map<string, RuntimeCatalogContestListRecord>(
    bundledIndex.contests.map((item) => [item.id, mapBundledIndexItemToContestRecord(item)]),
  );

  for (const contest of localContests) {
    if (contest.deletedAt) {
      contestMap.delete(contest.contestId);
      continue;
    }

    if (!shouldUseLocalCatalogContest(contest, contestMap.has(contest.contestId))) {
      continue;
    }

    contestMap.set(contest.contestId, {
      ...contest,
      problemCount: contest.problemIds.length,
    });
  }

  return {
    generatedAt: bundledIndex.generated_at,
    contests: [...contestMap.values()],
  };
}

export async function listRuntimeContestCoveragePayload(): Promise<Array<{
  contest: LocalCatalogContestRecord;
  problems: LocalCatalogProblemRecord[];
}>> {
  const [bundledIndex, bundledCoverageBasis, localContests] = await Promise.all([
    fetchCatalogContestIndex(),
    fetchCatalogCoverageBasis(),
    listCatalogContestsFromDb({ includeDeleted: true }),
  ]);

  const localProblemMap = await listContestProblemsByContestIdsFromDb(localContests.map((contest) => contest.contestId));
  const bundledContestMap = new Map<string, LocalCatalogContestRecord>(
    bundledIndex.contests.map((item) => {
      const mapped = mapBundledIndexItemToContestRecord(item);
      return [mapped.contestId, mapped];
    }),
  );
  const bundledProblemMap = new Map<string, LocalCatalogProblemRecord[]>(
    bundledCoverageBasis.contests.map((contest) => [
      contest.contestId,
      contest.problems.map((problem) => ({
        problemId: problem.problemId,
        contestId: contest.contestId,
        ordinal: problem.ordinal,
        title: problem.title,
        aliases: [],
        sources: [],
      })),
    ]),
  );

  for (const localContest of localContests) {
    if (localContest.deletedAt) {
      bundledContestMap.delete(localContest.contestId);
      bundledProblemMap.delete(localContest.contestId);
      continue;
    }

    if (!shouldUseLocalCatalogContest(localContest, bundledContestMap.has(localContest.contestId))) {
      continue;
    }

    bundledContestMap.set(localContest.contestId, localContest);
    if (localProblemMap.has(localContest.contestId)) {
      bundledProblemMap.set(localContest.contestId, localProblemMap.get(localContest.contestId) ?? []);
    }
  }

  return [...bundledContestMap.values()].map((contest) => ({
    contest,
    problems: bundledProblemMap.get(contest.contestId) ?? [],
  }));
}

export async function getRuntimeCatalogContestDetail(contestId: string): Promise<{
  contest: LocalCatalogContestRecord;
  problems: LocalCatalogProblemRecord[];
}> {
  const [localDetail, deleted, bundledIndex] = await Promise.all([
    getCatalogContestDetailFromDb(contestId),
    hasDeletedCatalogContestId(contestId),
    fetchCatalogContestIndex(),
  ]);
  const hasBundledContest = bundledIndex.contests.some((contest) => contest.id === contestId);

  if (deleted) {
    throw new Error("contest deleted");
  }

  if (localDetail && shouldUseLocalCatalogContest(localDetail.contest, hasBundledContest)) {
    return localDetail;
  }

  if (!hasBundledContest) {
    if (localDetail) {
      return localDetail;
    }
    throw new Error("contest not found");
  }

  const detail = await fetchCatalogContestDetail(contestId);
  return mapBundledContestDetailToLocal(detail);
}

export async function getRuntimeCatalogContestRecord(contestId: string): Promise<RuntimeCatalogContestListRecord | null> {
  const [localContest, deleted, bundledIndex] = await Promise.all([
    getCatalogContestFromDb(contestId),
    hasDeletedCatalogContestId(contestId),
    fetchCatalogContestIndex(),
  ]);
  const bundledContest = bundledIndex.contests.find((item) => item.id === contestId);
  const hasBundledContest = !!bundledContest;

  if (deleted) {
    return null;
  }

  if (localContest && shouldUseLocalCatalogContest(localContest, hasBundledContest)) {
    return {
      ...localContest,
      problemCount: localContest.problemIds.length,
    };
  }

  if (!bundledContest) {
    return null;
  }

  return mapBundledIndexItemToContestRecord(bundledContest);
}
