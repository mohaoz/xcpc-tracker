import {
  fetchCatalogContestDetail,
  fetchCatalogContestIndex,
  fetchCatalogCoverageBasis,
  type CatalogContestDetail,
  type CatalogContestIndexItem,
} from "./catalog";
import type { LocalCatalogContestRecord, LocalCatalogProblemRecord } from "./local-model";
import {
  getCatalogContestFromDb,
  getCatalogContestDetailFromDb,
  hasDeletedCatalogContestId,
  listCatalogContestsFromDb,
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
  const localDetail = await getCatalogContestDetailFromDb(contestId);
  if (localDetail) {
    return localDetail;
  }

  if (await hasDeletedCatalogContestId(contestId)) {
    throw new Error("contest deleted");
  }

  const detail = await fetchCatalogContestDetail(contestId);
  return mapBundledContestDetailToLocal(detail);
}

export async function getRuntimeCatalogContestRecord(contestId: string): Promise<RuntimeCatalogContestListRecord | null> {
  const localContest = await getCatalogContestFromDb(contestId);
  if (localContest) {
    return {
      ...localContest,
      problemCount: localContest.problemIds.length,
    };
  }

  if (await hasDeletedCatalogContestId(contestId)) {
    return null;
  }

  const bundledIndex = await fetchCatalogContestIndex();
  const contest = bundledIndex.contests.find((item) => item.id === contestId);
  if (!contest) {
    return null;
  }

  return mapBundledIndexItemToContestRecord(contest);
}
