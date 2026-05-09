import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_CATALOG_PATH = resolve(repoRoot, "catalog", "default-catalog.min.json");
const DEFAULT_TIMES_PATH = resolve(repoRoot, "fixtures", "imports", "codeforces", "undated-contest-times.json");
const DEFAULT_OUTPUT_PATH = DEFAULT_CATALOG_PATH;

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function compareByTitle(left, right) {
  return String(left?.title ?? "").localeCompare(String(right?.title ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareBySource(left, right) {
  const leftKey = [
    String(left?.provider ?? ""),
    String(left?.provider_contest_id ?? ""),
    String(left?.url ?? ""),
    String(left?.source_title ?? ""),
  ].join("@@");
  const rightKey = [
    String(right?.provider ?? ""),
    String(right?.provider_contest_id ?? ""),
    String(right?.url ?? ""),
    String(right?.source_title ?? ""),
  ].join("@@");
  return leftKey.localeCompare(rightKey, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function createTagKey(tags) {
  return dedupeStrings(tags)
    .map((tag) => String(tag))
    .sort((left, right) =>
      left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    )
    .join("||");
}

function normalizeProblemTitle(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function createProblemSignature(problem) {
  return `${String(problem?.ordinal ?? "").trim().toLowerCase()}::${normalizeProblemTitle(problem?.title)}`;
}

function createSourceKey(source) {
  return [
    String(source?.provider ?? "").trim().toLowerCase(),
    String(source?.kind ?? "").trim().toLowerCase(),
    String(source?.provider_problem_id ?? source?.provider_contest_id ?? source?.url ?? "")
      .trim()
      .toLowerCase(),
  ].join("::");
}

function mergeSources(existingSources, nextSources) {
  const merged = [...(existingSources ?? [])];
  const seen = new Set(merged.map(createSourceKey));
  for (const source of nextSources ?? []) {
    const key = createSourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(source);
  }
  return merged.sort(compareBySource);
}

function isProperTagSubset(leftTags, rightTags) {
  const left = new Set(dedupeStrings(leftTags ?? []));
  const right = new Set(dedupeStrings(rightTags ?? []));
  return left.size < right.size && [...left].every((tag) => right.has(tag));
}

function haveSameTagSet(leftTags, rightTags) {
  const left = dedupeStrings(leftTags ?? []);
  const right = dedupeStrings(rightTags ?? []);
  if (left.length !== right.length) {
    return false;
  }
  const leftKey = createTagKey(left);
  const rightKey = createTagKey(right);
  return leftKey === rightKey;
}

function buildProblemsByContestId(problems) {
  const problemsByContestId = new Map();
  for (const problem of problems ?? []) {
    const bucket = problemsByContestId.get(problem.contestId) ?? [];
    bucket.push(problem);
    problemsByContestId.set(problem.contestId, bucket);
  }
  return problemsByContestId;
}

function haveSameProblemSignature(leftProblems, rightProblems) {
  if (!leftProblems?.length || !rightProblems?.length || leftProblems.length !== rightProblems.length) {
    return false;
  }
  const left = leftProblems.map(createProblemSignature).sort();
  const right = rightProblems.map(createProblemSignature).sort();
  return left.every((signature, index) => signature === right[index]);
}

function haveCompatibleOrdinals(leftProblems, rightProblems) {
  if (!leftProblems?.length || !rightProblems?.length) {
    return false;
  }
  const left = new Set(leftProblems.map((problem) => String(problem?.ordinal ?? "").trim().toLowerCase()));
  const right = new Set(rightProblems.map((problem) => String(problem?.ordinal ?? "").trim().toLowerCase()));
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  return smaller.size > 0 && [...smaller].every((ordinal) => larger.has(ordinal));
}

function hasDifferentProviderEvidence(leftContest, rightContest) {
  const leftProviders = new Set((leftContest.sources ?? []).map((source) => source?.provider).filter(Boolean));
  const rightProviders = new Set((rightContest.sources ?? []).map((source) => source?.provider).filter(Boolean));
  if (leftProviders.size === 0 || rightProviders.size === 0) {
    return false;
  }
  for (const provider of leftProviders) {
    if (rightProviders.has(provider)) {
      return false;
    }
  }
  return true;
}

function hasContestSource(contest, provider, providerContestId) {
  return (contest.sources ?? []).some(
    (source) =>
      source?.provider === provider &&
      String(source?.provider_contest_id ?? "") === providerContestId,
  );
}

function isAllowedOrdinalSubsetMerge(leftContest, rightContest) {
  const allowedPairs = [
    [
      ["codeforces", "103117"],
      ["qoj", "1292"],
    ],
    [
      ["codeforces", "105222"],
      ["qoj", "1862"],
    ],
    [
      ["codeforces", "105487"],
      ["qoj", "1841"],
    ],
  ];
  return allowedPairs.some(([[leftProvider, leftId], [rightProvider, rightId]]) =>
    (hasContestSource(leftContest, leftProvider, leftId) &&
      hasContestSource(rightContest, rightProvider, rightId)) ||
    (hasContestSource(rightContest, leftProvider, leftId) &&
      hasContestSource(leftContest, rightProvider, rightId)),
  );
}

function findContestMergeGroups(contests, problemsByContestId) {
  const parent = contests.map((_, index) => index);
  const find = (index) => {
    if (parent[index] !== index) {
      parent[index] = find(parent[index]);
    }
    return parent[index];
  };
  const unite = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  for (let left = 0; left < contests.length; left += 1) {
    for (let right = left + 1; right < contests.length; right += 1) {
      const leftTags = contests[left].tags ?? [];
      const rightTags = contests[right].tags ?? [];
      const haveComparableTags =
        haveSameTagSet(leftTags, rightTags) ||
        isProperTagSubset(leftTags, rightTags) ||
        isProperTagSubset(rightTags, leftTags);
      if (!haveComparableTags) continue;
      if (!hasDifferentProviderEvidence(contests[left], contests[right])) continue;
      const leftProblems = problemsByContestId.get(contests[left].contestId) ?? [];
      const rightProblems = problemsByContestId.get(contests[right].contestId) ?? [];
      const canMergeByExactProblems = haveSameProblemSignature(leftProblems, rightProblems);
      const canMergeByOrdinal =
        isAllowedOrdinalSubsetMerge(contests[left], contests[right]) &&
        haveCompatibleOrdinals(leftProblems, rightProblems);
      if (!canMergeByExactProblems && !canMergeByOrdinal) {
        continue;
      }
      unite(left, right);
    }
  }

  const result = new Map();
  for (const [index] of contests.entries()) {
    const root = find(index);
    const bucket = result.get(root) ?? [];
    bucket.push(index);
    result.set(root, bucket);
  }
  return [...result.values()];
}

function compareByPrimaryContest(left, right) {
  const tagCountDelta = dedupeStrings(right.tags ?? []).length - dedupeStrings(left.tags ?? []).length;
  if (tagCountDelta !== 0) return tagCountDelta;
  return compareByTitle(left, right);
}

function shouldMergeGroupProblemsByOrdinal(contests) {
  for (let left = 0; left < contests.length; left += 1) {
    for (let right = left + 1; right < contests.length; right += 1) {
      if (isAllowedOrdinalSubsetMerge(contests[left], contests[right])) {
        return true;
      }
    }
  }
  return false;
}

function mergeContestsByTags(catalog) {
  const contests = catalog.contests ?? [];
  const problems = catalog.problems ?? [];
  const problemsByContestId = buildProblemsByContestId(problems);
  const groups = findContestMergeGroups(contests, problemsByContestId);

  const contestIdRedirects = new Map();
  const mergeProblemsByOrdinalContestIds = new Set();
  const problemTitlePriorityByContestId = new Map();
  const mergedContests = [];
  for (const group of groups) {
    const sortedBucket = group.map((index) => contests[index]).sort(compareByPrimaryContest);
    const primary = sortedBucket[0];
    const shouldMergeProblemsByOrdinal = shouldMergeGroupProblemsByOrdinal(sortedBucket);
    const problemCountByContestId = new Map(
      sortedBucket.map((contest) => [
        contest.contestId,
        (problemsByContestId.get(contest.contestId) ?? []).length,
      ]),
    );
    for (const contest of sortedBucket) {
      contestIdRedirects.set(contest.contestId, primary.contestId);
      problemTitlePriorityByContestId.set(
        contest.contestId,
        (problemCountByContestId.get(contest.contestId) ?? 0) + (contest.contestId === primary.contestId ? 0.5 : 0),
      );
      if (shouldMergeProblemsByOrdinal) {
        mergeProblemsByOrdinalContestIds.add(contest.contestId);
      }
    }
    const aliases = dedupeStrings([
      ...(primary.aliases ?? []),
      ...sortedBucket.flatMap((contest) => [contest.title, ...(contest.aliases ?? [])]),
    ]).filter((alias) => alias !== primary.title);
    const sources = mergeSources([], sortedBucket.flatMap((contest) => contest.sources ?? []));

    mergedContests.push({
      ...primary,
      aliases,
      tags: dedupeStrings(sortedBucket.flatMap((contest) => contest.tags ?? [])),
      sources,
      contestId: primary.contestId,
    });
  }

  const mergedProblemsByKey = new Map();
  const usedProblemIds = new Set();
  for (const problem of problems) {
    const contestId = contestIdRedirects.get(problem.contestId) ?? problem.contestId;
    const problemKey = mergeProblemsByOrdinalContestIds.has(problem.contestId)
      ? String(problem.ordinal ?? "").trim().toLowerCase()
      : createProblemSignature(problem);
    const key = `${contestId}::${problemKey}`;
    const existing = mergedProblemsByKey.get(key);
    if (!existing) {
      const baseProblemId = problem.contestId === contestId ? problem.problemId : `${contestId}:${problem.ordinal}`;
      let problemId = baseProblemId;
      let suffix = 2;
      while (usedProblemIds.has(problemId)) {
        problemId = `${baseProblemId}:${suffix}`;
        suffix += 1;
      }
      usedProblemIds.add(problemId);
      mergedProblemsByKey.set(key, {
        ...problem,
        contestId,
        problemId,
        titlePriority: problemTitlePriorityByContestId.get(problem.contestId) ?? 0,
      });
      continue;
    }
    const nextTitlePriority = problemTitlePriorityByContestId.get(problem.contestId) ?? 0;
    if (nextTitlePriority > (existing.titlePriority ?? 0)) {
      existing.title = problem.title;
      existing.titlePriority = nextTitlePriority;
    }
    existing.aliases = dedupeStrings([
      ...(existing.aliases ?? []),
      ...(problem.aliases ?? []),
      problem.title !== existing.title ? problem.title : null,
    ]);
    existing.sources = mergeSources(existing.sources ?? [], problem.sources ?? []);
  }

  const mergedProblems = [...mergedProblemsByKey.values()].map(({ titlePriority, ...problem }) => problem);
  mergedProblems.sort((left, right) => {
    const contestKey = String(left.contestId ?? "").localeCompare(String(right.contestId ?? ""));
    if (contestKey !== 0) return contestKey;
    return String(left.ordinal ?? "").localeCompare(String(right.ordinal ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const problemIdsByContestId = new Map();
  for (const problem of mergedProblems) {
    const bucket = problemIdsByContestId.get(problem.contestId) ?? [];
    bucket.push(problem.problemId);
    problemIdsByContestId.set(problem.contestId, bucket);
  }

  catalog.contests = mergedContests
    .map((contest) => ({
      ...contest,
      problemIds: problemIdsByContestId.get(contest.contestId) ?? contest.problemIds ?? [],
    }))
    .sort(compareByTitle);
  catalog.problems = mergedProblems;
  return catalog;
}

function extractYear(entry) {
  if (typeof entry?.startAt === "string") {
    const year = entry.startAt.slice(0, 4);
    if (/^(19|20)\d{2}$/.test(year)) {
      return year;
    }
  }
  if (typeof entry?.startTimeSeconds === "number") {
    const year = new Date(entry.startTimeSeconds * 1000).getUTCFullYear();
    if (year >= 1900 && year <= 2099) {
      return String(year);
    }
  }
  return null;
}

async function main() {
  const catalogPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_CATALOG_PATH;
  const timesPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_TIMES_PATH;
  const outputPath = process.argv[4] ? resolve(process.argv[4]) : DEFAULT_OUTPUT_PATH;

  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const times = JSON.parse(await readFile(timesPath, "utf8"));

  const yearByContestId = new Map();
  const yearByProviderContestId = new Map();
  for (const contest of times.contests ?? []) {
    const year = extractYear(contest);
    if (!year) continue;
    if (contest.localContestId) {
      yearByContestId.set(String(contest.localContestId), year);
    }
    if (contest.providerContestId) {
      yearByProviderContestId.set(String(contest.providerContestId), year);
    }
  }

  let updatedCount = 0;
  for (const contest of catalog.contests ?? []) {
    const existingTags = Array.isArray(contest.tags) ? contest.tags : [];
    const hasYearTag = existingTags.some((tag) => /^(19|20)\d{2}$/.test(String(tag)));
    if (hasYearTag) {
      continue;
    }

    let inferredYear = yearByContestId.get(String(contest.contestId)) ?? null;
    if (!inferredYear) {
      const codeforcesSource = (contest.sources ?? []).find(
        (source) => source?.provider === "codeforces" && source?.kind === "contest",
      );
      const providerContestId = codeforcesSource?.provider_contest_id;
      if (providerContestId) {
        inferredYear = yearByProviderContestId.get(String(providerContestId)) ?? null;
      }
    }

    if (!inferredYear) {
      continue;
    }

    contest.tags = dedupeStrings([...existingTags, inferredYear]);
    updatedCount += 1;
  }

  mergeContestsByTags(catalog);

  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    catalogPath,
    timesPath,
    outputPath,
    updatedCount,
    contestCount: catalog.contests.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
