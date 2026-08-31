import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "data", "qoj-problems-a.json");
const DEFAULT_CATALOG_PATH = resolve(repoRoot, "catalog", "default-catalog.min.json");
const DEFAULT_OUTPUT_PATH = DEFAULT_CATALOG_PATH;
const DEFAULT_REVIEW_PATH = resolve(
  repoRoot,
  "fixtures",
  "imports",
  "qoj",
  "qoj-problem-import-exclusions.json",
);

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

function getQojContestId(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
    if (hostname !== "qoj.ac") return "";
    return url.pathname.match(/^\/contest\/(\d+)(?:\/|$)/u)?.[1] ?? "";
  } catch {
    return "";
  }
}

function getQojProblemId(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
    if (hostname !== "qoj.ac") return "";
    return url.pathname.match(/^\/contest\/\d+\/problem\/(\d+)\/?$/u)?.[1] ?? "";
  } catch {
    return "";
  }
}

function normalizeInputContests(raw) {
  const rawContests = Array.isArray(raw) ? raw : raw?.contests;
  if (!Array.isArray(rawContests)) {
    throw new Error("input JSON must be an array or an object with contests");
  }

  return rawContests
    .filter((contest) => Array.isArray(contest?.problems) && contest.problems.length > 0)
    .map((contest, contestIndex) => {
      const label = `contests[${contestIndex}]`;
      const title = cleanText(contest?.title);
      const url = cleanText(contest?.url);
      const providerContestId = getQojContestId(url);
      if (!title || !url || !providerContestId) {
        throw new Error(`${label} requires a title and a QOJ contest URL`);
      }

      const ordinals = new Set();
      const providerProblemIds = new Set();
      const problems = contest.problems.map((problem, problemIndex) => {
        const problemLabel = `${label}.problems[${problemIndex}]`;
        const ordinal = cleanText(problem?.ordinal);
        const problemTitle = cleanText(problem?.title);
        const problemUrl = cleanText(problem?.url);
        const urlProblemId = getQojProblemId(problemUrl);
        const providerProblemId = cleanText(problem?.provider_problem_id) || urlProblemId;
        if (!ordinal || !problemTitle || !problemUrl || !providerProblemId) {
          throw new Error(`${problemLabel} requires ordinal, title, url, and provider_problem_id`);
        }
        if (getQojContestId(problemUrl) !== providerContestId) {
          throw new Error(`${problemLabel}.url does not belong to QOJ contest ${providerContestId}`);
        }
        if (urlProblemId !== providerProblemId) {
          throw new Error(`${problemLabel}.provider_problem_id does not match its URL`);
        }

        const ordinalKey = ordinal.toLowerCase();
        if (ordinals.has(ordinalKey)) {
          throw new Error(`${problemLabel}.ordinal duplicates ${ordinal}`);
        }
        if (providerProblemIds.has(providerProblemId)) {
          throw new Error(`${problemLabel}.provider_problem_id duplicates ${providerProblemId}`);
        }
        ordinals.add(ordinalKey);
        providerProblemIds.add(providerProblemId);

        return {
          ordinal,
          title: problemTitle,
          url: problemUrl,
          provider_problem_id: providerProblemId,
        };
      });

      return {
        title,
        url,
        exactUrl: normalizeExactUrl(url),
        pathUrl: normalizeUrl(url),
        providerContestId,
        problems,
      };
    });
}

function normalizeReviewExclusions(raw) {
  if (raw?.schema_version !== 1 || !Array.isArray(raw?.excluded_contest_urls)) {
    throw new Error("QOJ import review must have schema_version = 1 and excluded_contest_urls");
  }

  const exclusions = new Map();
  for (const [index, entry] of raw.excluded_contest_urls.entries()) {
    const url = cleanText(entry?.url);
    const reason = cleanText(entry?.reason);
    if (!url || !reason || !getQojContestId(url)) {
      throw new Error(`excluded_contest_urls[${index}] requires a QOJ contest URL and reason`);
    }
    const key = normalizeExactUrl(url);
    if (exclusions.has(key)) {
      throw new Error(`excluded_contest_urls[${index}].url duplicates ${url}`);
    }
    exclusions.set(key, { url, reason });
  }
  return exclusions;
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

function addContestToLookup(lookup, key, contest) {
  const bucket = lookup.get(key) ?? [];
  if (!bucket.some((candidate) => candidate.contestId === contest.contestId)) {
    bucket.push(contest);
  }
  lookup.set(key, bucket);
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
  const checkOnly = process.argv.includes("--check");
  const reviewArgument = process.argv.find((argument) => argument.startsWith("--review="));
  const positionalArgs = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (positionalArgs.length > 3) {
    throw new Error(
      "usage: import-qoj-problems-export.mjs [input] [catalog] [output] [--check] [--review=path]",
    );
  }
  const inputPath = positionalArgs[0] ? resolve(positionalArgs[0]) : DEFAULT_INPUT_PATH;
  const catalogPath = positionalArgs[1] ? resolve(positionalArgs[1]) : DEFAULT_CATALOG_PATH;
  const outputPath = positionalArgs[2] ? resolve(positionalArgs[2]) : DEFAULT_OUTPUT_PATH;
  const reviewPath = reviewArgument
    ? resolve(reviewArgument.slice("--review=".length))
    : DEFAULT_REVIEW_PATH;

  const [input, catalog, review] = await Promise.all([
    readFile(inputPath, "utf8").then(JSON.parse),
    readFile(catalogPath, "utf8").then(JSON.parse),
    readFile(reviewPath, "utf8").then(JSON.parse),
  ]);
  if (!Array.isArray(catalog?.contests) || !Array.isArray(catalog?.problems)) {
    throw new Error("catalog must be a local catalog snapshot with contests and problems arrays");
  }
  const originalCatalog = JSON.stringify(catalog);
  const inputContests = normalizeInputContests(input);
  const exclusions = normalizeReviewExclusions(review);

  const contestsByQojExactUrl = new Map();
  const contestsByQojPathUrl = new Map();
  for (const contest of catalog.contests) {
    for (const source of contest.sources ?? []) {
      if (source?.provider === "qoj" && source?.kind === "contest" && source?.url) {
        addContestToLookup(contestsByQojExactUrl, normalizeExactUrl(source.url), contest);
        addContestToLookup(contestsByQojPathUrl, normalizeUrl(source.url), contest);
      }
    }
  }

  const problems = [...catalog.problems];
  const usedProblemIds = new Set(problems.map((problem) => problem.problemId));
  let matchedContestCount = 0;
  let exactMatchedContestCount = 0;
  let pathMatchedContestCount = 0;
  let insertedProblemCount = 0;
  let updatedProblemCount = 0;
  let unchangedProblemCount = 0;
  let excludedProblemCount = 0;
  const excludedContests = [];
  const skippedContests = [];
  const ambiguousContests = [];

  for (const importedContest of inputContests) {
    const exclusion = exclusions.get(importedContest.exactUrl);
    if (exclusion) {
      excludedProblemCount += importedContest.problems.length;
      excludedContests.push({
        title: importedContest.title,
        url: importedContest.url,
        problem_count: importedContest.problems.length,
        reason: exclusion.reason,
      });
      continue;
    }

    const exactTargets = contestsByQojExactUrl.get(importedContest.exactUrl) ?? [];
    const pathTargets = contestsByQojPathUrl.get(importedContest.pathUrl) ?? [];
    let targetContest = null;
    if (exactTargets.length === 1) {
      targetContest = exactTargets[0];
      exactMatchedContestCount += 1;
    } else if (exactTargets.length > 1) {
      ambiguousContests.push({
        title: importedContest.title,
        url: importedContest.url,
        candidate_contest_ids: exactTargets.map((contest) => contest.contestId),
        match_method: "exact_url",
      });
      continue;
    } else if (pathTargets.length === 1) {
      targetContest = pathTargets[0];
      pathMatchedContestCount += 1;
    } else if (pathTargets.length > 1) {
      ambiguousContests.push({
        title: importedContest.title,
        url: importedContest.url,
        candidate_contest_ids: pathTargets.map((contest) => contest.contestId),
        match_method: "path_url",
      });
      continue;
    } else {
      skippedContests.push({
        title: importedContest.title,
        url: importedContest.url,
        problem_count: importedContest.problems.length,
      });
      continue;
    }

    matchedContestCount += 1;
    const existingProblems = problems.filter((problem) => problem.contestId === targetContest.contestId);
    const existingByOrdinal = new Map(
      existingProblems.map((problem) => [cleanText(problem.ordinal).toLowerCase(), problem]),
    );
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
        const previousProblem = JSON.stringify(matched);
        matched.ordinal = matched.ordinal || importedProblem.ordinal;
        matched.title = matched.title || importedProblem.title;
        matched.aliases = dedupeStrings([
          ...(matched.aliases ?? []),
          importedProblem.title !== matched.title ? importedProblem.title : null,
        ]);
        matched.sources = mergeSourceList(matched.sources ?? [], source);
        existingByProviderProblemId.set(importedProblem.provider_problem_id, matched);
        if (JSON.stringify(matched) === previousProblem) {
          unchangedProblemCount += 1;
        } else {
          updatedProblemCount += 1;
        }
        continue;
      }

      const problemId = buildProblemId(
        targetContest.contestId,
        importedProblem.ordinal,
        importedProblem.provider_problem_id,
        usedProblemIds,
      );
      const problem = {
        problemId,
        contestId: targetContest.contestId,
        ordinal: importedProblem.ordinal,
        title: importedProblem.title,
        aliases: [],
        sources: [source],
      };
      problems.push(problem);
      existingByOrdinal.set(importedProblem.ordinal.toLowerCase(), problem);
      existingByProviderProblemId.set(importedProblem.provider_problem_id, problem);
      insertedProblemCount += 1;
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

  const problemIdsByContestId = new Map();
  for (const problem of catalog.problems) {
    const bucket = problemIdsByContestId.get(problem.contestId) ?? [];
    bucket.push(problem.problemId);
    problemIdsByContestId.set(problem.contestId, bucket);
  }

  for (const contest of catalog.contests) {
    const nextProblemIds = problemIdsByContestId.get(contest.contestId) ?? [];
    contest.problemIds = nextProblemIds;
    if (nextProblemIds.length > 0 && contest.curationStatus === "contest_stub") {
      contest.curationStatus = "problem_listed";
    }
  }

  const incompleteCatalogContests = [];
  const excludedCatalogContests = [];
  for (const contest of catalog.contests) {
    const qojContestSources = (contest.sources ?? []).filter(
      (source) => source?.provider === "qoj" && source?.kind === "contest" && source?.url,
    );
    if (!qojContestSources.length) continue;

    const activeQojContestSources = qojContestSources.filter(
      (source) => !exclusions.has(normalizeExactUrl(source.url)),
    );
    if (!activeQojContestSources.length) {
      excludedCatalogContests.push({
        contest_id: contest.contestId,
        title: contest.title,
        qoj_urls: qojContestSources.map((source) => source.url),
      });
      continue;
    }

    const contestProblems = catalog.problems.filter(
      (problem) => problem.contestId === contest.contestId,
    );
    const missingProblems = contestProblems.filter(
      (problem) => !(problem.sources ?? []).some(
        (source) =>
          source?.provider === "qoj" &&
          source?.kind === "problem" &&
          source?.provider_problem_id,
      ),
    );
    if (missingProblems.length > 0) {
      incompleteCatalogContests.push({
        contest_id: contest.contestId,
        title: contest.title,
        qoj_urls: activeQojContestSources.map((source) => source.url),
        missing_problem_count: missingProblems.length,
        missing_ordinals: missingProblems.map((problem) => problem.ordinal),
      });
    }
  }

  const changed = JSON.stringify(catalog) !== originalCatalog;
  if (changed) {
    catalog.exportedAt = new Date().toISOString();
  }
  if (!checkOnly && (changed || outputPath !== catalogPath)) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        inputPath,
        catalogPath,
        outputPath,
        reviewPath,
        checkOnly,
        changed,
        importedContestCount: inputContests.length,
        matchedContestCount,
        exactMatchedContestCount,
        pathMatchedContestCount,
        excludedContestCount: excludedContests.length,
        excludedProblemCount,
        excludedContests,
        skippedContestCount: skippedContests.length,
        skippedContests,
        ambiguousContestCount: ambiguousContests.length,
        ambiguousContests,
        incompleteCatalogContestCount: incompleteCatalogContests.length,
        incompleteCatalogContests,
        excludedCatalogContestCount: excludedCatalogContests.length,
        excludedCatalogContests,
        insertedProblemCount,
        updatedProblemCount,
        unchangedProblemCount,
        totalProblemCount: catalog.problems.length,
      },
      null,
      2,
    ),
  );

  if (
    checkOnly &&
    (changed || ambiguousContests.length > 0 || incompleteCatalogContests.length > 0)
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
