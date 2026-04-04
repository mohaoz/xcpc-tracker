import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "a.json");
const DEFAULT_CATALOG_PATH = resolve(repoRoot, "catalog", "default-catalog.min.json");
const DEFAULT_OUTPUT_PATH = DEFAULT_CATALOG_PATH;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = cleanText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return `${url.origin}${url.pathname}`;
  } catch {
    return cleanText(value);
  }
}

function normalizeExactUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    url.hash = "";
    return url.toString();
  } catch {
    return cleanText(value);
  }
}

function normalizeInputContests(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.contests)) return raw.contests;
  throw new Error("input JSON must be an array or an object with contests");
}

function mergeSourceList(existingSources, nextSource) {
  const items = [...(existingSources ?? [])];
  const nextKey = [
    cleanText(nextSource.provider).toLowerCase(),
    cleanText(nextSource.kind).toLowerCase(),
    cleanText(nextSource.provider_problem_id ?? nextSource.provider_contest_id ?? nextSource.url).toLowerCase(),
  ].join("::");
  const index = items.findIndex((source) => {
    const key = [
      cleanText(source.provider).toLowerCase(),
      cleanText(source.kind).toLowerCase(),
      cleanText(source.provider_problem_id ?? source.provider_contest_id ?? source.url).toLowerCase(),
    ].join("::");
    return key === nextKey;
  });
  if (index < 0) {
    items.push(nextSource);
    return items;
  }
  items[index] = {
    ...items[index],
    ...nextSource,
    source_title: nextSource.source_title || items[index].source_title,
    label: nextSource.label || items[index].label,
  };
  return items;
}

function buildProblemId(contestId, ordinal, providerProblemId, usedProblemIds) {
  const candidates = [
    `${contestId}:${ordinal}`,
    `${contestId}:qoj:${ordinal}`,
    `${contestId}:qoj:${providerProblemId}`,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!usedProblemIds.has(candidate)) {
      usedProblemIds.add(candidate);
      return candidate;
    }
  }

  let suffix = 2;
  while (true) {
    const candidate = `${contestId}:qoj:${ordinal}:${suffix}`;
    if (!usedProblemIds.has(candidate)) {
      usedProblemIds.add(candidate);
      return candidate;
    }
    suffix += 1;
  }
}

async function main() {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT_PATH;
  const catalogPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_CATALOG_PATH;
  const outputPath = process.argv[4] ? resolve(process.argv[4]) : DEFAULT_OUTPUT_PATH;

  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

  const inputContests = normalizeInputContests(input)
    .filter((contest) => Array.isArray(contest?.problems) && contest.problems.length > 0)
    .map((contest) => ({
      title: cleanText(contest.title),
      url: cleanText(contest.url),
      normalizedUrl: normalizeUrl(contest.url),
      problems: contest.problems
        .map((problem) => {
          const url = cleanText(problem?.url);
          const providerProblemId = url.match(/\/problem\/(\d+)$/iu)?.[1] ?? "";
          return {
            ordinal: cleanText(problem?.ordinal),
            title: cleanText(problem?.title),
            url,
            provider_problem_id: providerProblemId,
          };
        })
        .filter((problem) => problem.ordinal && problem.title && problem.url && problem.provider_problem_id),
    }));

  const contestsByQojExactUrl = new Map();
  const contestsByQojPathUrl = new Map();
  for (const contest of catalog.contests ?? []) {
    for (const source of contest.sources ?? []) {
      if (source?.provider === "qoj" && source?.kind === "contest" && source?.url) {
        contestsByQojExactUrl.set(normalizeExactUrl(source.url), contest);
        contestsByQojPathUrl.set(normalizeUrl(source.url), contest);
      }
    }
  }

  const problems = Array.isArray(catalog.problems) ? [...catalog.problems] : [];
  const usedProblemIds = new Set(problems.map((problem) => problem.problemId));
  let matchedContestCount = 0;
  let insertedProblemCount = 0;
  let updatedProblemCount = 0;
  let skippedContestCount = 0;

  for (const importedContest of inputContests) {
    const targetContest =
      contestsByQojExactUrl.get(normalizeExactUrl(importedContest.url)) ??
      contestsByQojPathUrl.get(importedContest.normalizedUrl) ??
      null;
    if (!targetContest) {
      skippedContestCount += 1;
      continue;
    }

    matchedContestCount += 1;
    const existingProblems = problems.filter((problem) => problem.contestId === targetContest.contestId);
    const existingByOrdinal = new Map(existingProblems.map((problem) => [cleanText(problem.ordinal).toLowerCase(), problem]));
    const existingByProviderProblemId = new Map();
    for (const problem of existingProblems) {
      for (const source of problem.sources ?? []) {
        if (source?.provider === "qoj" && source?.kind === "problem" && source?.provider_problem_id) {
          existingByProviderProblemId.set(cleanText(source.provider_problem_id), problem);
        }
      }
    }

    for (const importedProblem of importedContest.problems) {
      const source = {
        provider: "qoj",
        kind: "problem",
        url: importedProblem.url,
        provider_problem_id: importedProblem.provider_problem_id,
        source_title: importedProblem.title,
        label: `QOJ ${importedProblem.ordinal}`,
      };
      const matched =
        existingByProviderProblemId.get(importedProblem.provider_problem_id) ??
        existingByOrdinal.get(importedProblem.ordinal.toLowerCase()) ??
        null;

      if (matched) {
        matched.ordinal = matched.ordinal || importedProblem.ordinal;
        matched.title = matched.title || importedProblem.title;
        matched.aliases = dedupeStrings([
          ...(matched.aliases ?? []),
          importedProblem.title !== matched.title ? importedProblem.title : null,
        ]);
        matched.sources = mergeSourceList(matched.sources ?? [], source);
        updatedProblemCount += 1;
        continue;
      }

      const problemId = buildProblemId(
        targetContest.contestId,
        importedProblem.ordinal,
        importedProblem.provider_problem_id,
        usedProblemIds,
      );
      problems.push({
        problemId,
        contestId: targetContest.contestId,
        ordinal: importedProblem.ordinal,
        title: importedProblem.title,
        aliases: [],
        sources: [source],
      });
      insertedProblemCount += 1;
    }
  }

  const problemIdsByContestId = new Map();
  for (const problem of problems) {
    const bucket = problemIdsByContestId.get(problem.contestId) ?? [];
    bucket.push(problem.problemId);
    problemIdsByContestId.set(problem.contestId, bucket);
  }

  for (const contest of catalog.contests ?? []) {
    const nextProblemIds = problemIdsByContestId.get(contest.contestId) ?? [];
    contest.problemIds = nextProblemIds;
    if (nextProblemIds.length > 0 && contest.curationStatus === "contest_stub") {
      contest.curationStatus = "problem_listed";
    }
  }

  catalog.problems = problems.sort((left, right) => {
    const contestKey = cleanText(left.contestId).localeCompare(cleanText(right.contestId));
    if (contestKey !== 0) return contestKey;
    return cleanText(left.ordinal).localeCompare(cleanText(right.ordinal), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        inputPath,
        catalogPath,
        outputPath,
        importedContestCount: inputContests.length,
        matchedContestCount,
        skippedContestCount,
        insertedProblemCount,
        updatedProblemCount,
        totalProblemCount: catalog.problems.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
