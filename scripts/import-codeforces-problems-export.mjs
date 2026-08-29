import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "data", "codeforces-problems.json");
const DEFAULT_CATALOG_PATH = resolve(repoRoot, "catalog", "default-catalog.min.json");
const DEFAULT_OUTPUT_PATH = DEFAULT_CATALOG_PATH;
const CONTEST_URL_REMAPS = new Map([
  [
    "https://codeforces.com/gym/104459",
    {
      provider: "qoj",
      provider_contest_id: "1281",
      reason: "Codeforces problem order differs from the official PDF/QOJ order.",
    },
  ],
  [
    "https://codeforces.com/gym/104172",
    {
      provider: "qoj",
      provider_contest_id: "1099",
      reason: "Codeforces/Universal Cup title uses 2023 for the same 47th ICPC Asia Hong Kong Regional contest.",
    },
  ],
]);

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

function normalizeTitleKey(value) {
  return cleanText(value).toLowerCase();
}

function getCodeforcesContestId(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
    if (hostname !== "codeforces.com") return "";
    return url.pathname.match(/^\/(?:gym|contest)\/(\d+)(?:\/|$)/u)?.[1] ?? "";
  } catch {
    return "";
  }
}

function getCodeforcesProblemOrdinal(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return decodeURIComponent(url.pathname.match(/\/problem\/([^/]+)\/?$/u)?.[1] ?? "");
  } catch {
    return "";
  }
}

function getSourcePriority(source) {
  if (source?.provider === "qoj") return 0;
  if (source?.provider === "codeforces") return 1;
  return 2;
}

function orderSources(sources) {
  return [...(sources ?? [])].sort((left, right) => getSourcePriority(left) - getSourcePriority(right));
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
    return orderSources(items);
  }
  items[index] = {
    ...items[index],
    ...nextSource,
    source_title: nextSource.source_title || items[index].source_title,
    label: nextSource.label || items[index].label,
  };
  return orderSources(items);
}

function normalizeTargetContest(raw, label) {
  const contestId = cleanText(raw?.contest_id);
  const title = cleanText(raw?.title);
  if (!contestId || !title) {
    throw new Error(`${label} requires contest_id and title`);
  }
  if (!Array.isArray(raw.aliases) || !Array.isArray(raw.tags) || !Array.isArray(raw.sources)) {
    throw new Error(`${label}.aliases, tags, and sources must be arrays`);
  }

  const sources = raw.sources.map((source, sourceIndex) => {
    const provider = cleanText(source?.provider);
    const kind = cleanText(source?.kind);
    const url = cleanText(source?.url);
    if (!provider || !kind || !url) {
      throw new Error(`${label}.sources[${sourceIndex}] requires provider, kind, and url`);
    }
    new URL(url);
    return { ...source, provider, kind, url };
  });
  const startAt = raw.start_at == null ? null : cleanText(raw.start_at);
  if (startAt && Number.isNaN(Date.parse(startAt))) {
    throw new Error(`${label}.start_at must be an ISO date or date-time`);
  }

  return {
    contestId,
    title,
    aliases: dedupeStrings(raw.aliases),
    tags: dedupeStrings(raw.tags),
    startAt,
    sources,
    notes: raw.notes == null ? null : cleanText(raw.notes),
  };
}

function normalizeInputContests(raw) {
  if (!Array.isArray(raw)) {
    throw new Error("input JSON must be an array");
  }
  return raw
    .filter((contest) => Array.isArray(contest?.problems) && contest.problems.length > 0)
    .map((contest, contestIndex) => {
      const label = `contests[${contestIndex}]`;
      const title = cleanText(contest.title);
      const url = cleanText(contest.url);
      const normalizedUrl = normalizeUrl(url);
      const providerContestId = getCodeforcesContestId(normalizedUrl);
      if (!title || !url || !providerContestId) {
        throw new Error(`${label} requires a title and a Codeforces gym/contest URL`);
      }

      const rawTargetContestIds = contest.target_contest_ids ?? [];
      if (!Array.isArray(rawTargetContestIds)) {
        throw new Error(`${label}.target_contest_ids must be an array when present`);
      }
      const normalizedTargetContestIds = dedupeStrings(rawTargetContestIds);
      if (normalizedTargetContestIds.length !== rawTargetContestIds.length) {
        throw new Error(`${label}.target_contest_ids must contain unique, non-empty strings`);
      }
      const rawTargetContests = contest.target_contests ?? [];
      if (!Array.isArray(rawTargetContests)) {
        throw new Error(`${label}.target_contests must be an array when present`);
      }
      const targetContests = rawTargetContests.map((target, targetIndex) =>
        normalizeTargetContest(target, `${label}.target_contests[${targetIndex}]`),
      );
      if (new Set(targetContests.map((target) => target.contestId)).size !== targetContests.length) {
        throw new Error(`${label}.target_contests must contain unique contest_id values`);
      }
      const targetContestIds = dedupeStrings([
        ...normalizedTargetContestIds,
        ...targetContests.map((target) => target.contestId),
      ]);

      const problems = contest.problems
        .map((problem) => ({
          ordinal: cleanText(problem?.ordinal),
          title: cleanText(problem?.title),
          url: cleanText(problem?.url),
          provider_problem_id: cleanText(problem?.provider_problem_id),
        }))
        .filter((problem) => problem.ordinal && problem.title && problem.url && problem.provider_problem_id);
      if (problems.length !== contest.problems.length) {
        throw new Error(`${label}.problems contains an incomplete problem record`);
      }

      const ordinals = new Set();
      const providerProblemIds = new Set();
      for (const [problemIndex, problem] of problems.entries()) {
        const problemLabel = `${label}.problems[${problemIndex}]`;
        const ordinalKey = problem.ordinal.toLowerCase();
        if (ordinals.has(ordinalKey)) {
          throw new Error(`${problemLabel}.ordinal duplicates ${problem.ordinal}`);
        }
        if (providerProblemIds.has(problem.provider_problem_id)) {
          throw new Error(`${problemLabel}.provider_problem_id duplicates ${problem.provider_problem_id}`);
        }
        if (getCodeforcesContestId(problem.url) !== providerContestId) {
          throw new Error(`${problemLabel}.url does not belong to Codeforces contest ${providerContestId}`);
        }
        if (getCodeforcesProblemOrdinal(problem.url).toLowerCase() !== ordinalKey) {
          throw new Error(`${problemLabel}.url does not match ordinal ${problem.ordinal}`);
        }
        if (problem.provider_problem_id !== `${providerContestId}:${problem.ordinal}`) {
          throw new Error(
            `${problemLabel}.provider_problem_id must be ${providerContestId}:${problem.ordinal}`,
          );
        }
        ordinals.add(ordinalKey);
        providerProblemIds.add(problem.provider_problem_id);
      }

      return {
        title,
        url,
        normalizedUrl,
        providerContestId,
        sourceLabel: cleanText(contest.source_label) || "Codeforces Gym",
        targetContestIds,
        targetContests,
        problems,
      };
    });
}

function buildProblemId(contestId, ordinal, providerProblemId, usedProblemIds) {
  const candidates = [
    `${contestId}:${ordinal}`,
    `${contestId}:codeforces:${ordinal}`,
    `${contestId}:${providerProblemId}`,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!usedProblemIds.has(candidate)) {
      usedProblemIds.add(candidate);
      return candidate;
    }
  }

  let suffix = 2;
  while (true) {
    const candidate = `${contestId}:codeforces:${ordinal}:${suffix}`;
    if (!usedProblemIds.has(candidate)) {
      usedProblemIds.add(candidate);
      return candidate;
    }
    suffix += 1;
  }
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const positionalArgs = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (positionalArgs.length > 3) {
    throw new Error("usage: import-codeforces-problems-export.mjs [input] [catalog] [output] [--check]");
  }
  const inputPath = positionalArgs[0] ? resolve(positionalArgs[0]) : DEFAULT_INPUT_PATH;
  const catalogPath = positionalArgs[1] ? resolve(positionalArgs[1]) : DEFAULT_CATALOG_PATH;
  const outputPath = positionalArgs[2] ? resolve(positionalArgs[2]) : DEFAULT_OUTPUT_PATH;

  const [input, catalog] = await Promise.all([
    readFile(inputPath, "utf8").then(JSON.parse),
    readFile(catalogPath, "utf8").then(JSON.parse),
  ]);
  if (!Array.isArray(catalog?.contests) || !Array.isArray(catalog?.problems)) {
    throw new Error("catalog must be a local catalog snapshot with contests and problems arrays");
  }
  const originalCatalog = JSON.stringify(catalog);

  const inputContests = normalizeInputContests(input);
  const contestsByCodeforcesUrl = new Map();
  const contestsBySourceKey = new Map();
  const contestsById = new Map();
  for (const contest of catalog.contests ?? []) {
    contestsById.set(contest.contestId, contest);
    for (const source of contest.sources ?? []) {
      const providerContestId = cleanText(source?.provider_contest_id);
      if (source?.provider && source?.kind === "contest" && providerContestId) {
        contestsBySourceKey.set(`${source.provider}:${providerContestId}`, contest);
      }
      if (source?.provider === "codeforces" && source?.kind === "contest" && source?.url) {
        const normalizedUrl = normalizeUrl(source.url);
        const bucket = contestsByCodeforcesUrl.get(normalizedUrl) ?? [];
        bucket.push(contest);
        contestsByCodeforcesUrl.set(normalizedUrl, bucket);
      }
    }
  }

  const problems = Array.isArray(catalog.problems) ? [...catalog.problems] : [];
  const usedProblemIds = new Set(problems.map((problem) => problem.problemId));
  const insertedContestIds = new Set();
  const updatedContestIds = new Set();
  let matchedContestCount = 0;
  let matchedInputContestCount = 0;
  let insertedProblemCount = 0;
  let updatedProblemCount = 0;
  let unchangedProblemCount = 0;
  let skippedContestCount = 0;

  for (const importedContest of inputContests) {
    for (const targetDefinition of importedContest.targetContests) {
      const existing = contestsById.get(targetDefinition.contestId);
      if (!existing) {
        const targetContest = {
          contestId: targetDefinition.contestId,
          title: targetDefinition.title,
          aliases: targetDefinition.aliases,
          tags: targetDefinition.tags,
          startAt: targetDefinition.startAt,
          curationStatus: "problem_listed",
          problemIds: [],
          sources: targetDefinition.sources,
          notes: targetDefinition.notes,
          generatedFrom: "catalog",
          deletedAt: null,
        };
        catalog.contests.push(targetContest);
        contestsById.set(targetContest.contestId, targetContest);
        insertedContestIds.add(targetContest.contestId);
        for (const source of targetContest.sources) {
          const providerContestId = cleanText(source?.provider_contest_id);
          if (source?.provider && source?.kind === "contest" && providerContestId) {
            contestsBySourceKey.set(`${source.provider}:${providerContestId}`, targetContest);
          }
        }
        continue;
      }

      const previousContest = JSON.stringify(existing);
      const previousTitle = existing.title;
      existing.title = targetDefinition.title;
      existing.aliases = dedupeStrings([
        ...(existing.aliases ?? []),
        ...targetDefinition.aliases,
        previousTitle !== targetDefinition.title ? previousTitle : null,
      ]);
      existing.tags = dedupeStrings([...(existing.tags ?? []), ...targetDefinition.tags]);
      existing.startAt = targetDefinition.startAt ?? existing.startAt ?? null;
      existing.sources = targetDefinition.sources.reduce(
        (sources, source) => mergeSourceList(sources, source),
        existing.sources ?? [],
      );
      existing.notes = targetDefinition.notes ?? existing.notes ?? null;
      if (JSON.stringify(existing) !== previousContest) {
        updatedContestIds.add(existing.contestId);
      }
    }

    const remap = CONTEST_URL_REMAPS.get(importedContest.normalizedUrl);
    let targetContests;
    if (importedContest.targetContestIds.length > 0) {
      targetContests = importedContest.targetContestIds.map((contestId) => {
        const target = contestsById.get(contestId);
        if (!target) {
          throw new Error(`explicit target contest not found: ${contestId}`);
        }
        return target;
      });
    } else if (remap) {
      const target = contestsBySourceKey.get(`${remap.provider}:${remap.provider_contest_id}`);
      targetContests = target ? [target] : [];
    } else {
      targetContests = contestsByCodeforcesUrl.get(importedContest.normalizedUrl) ?? [];
    }
    targetContests = [...new Map(targetContests.map((contest) => [contest.contestId, contest])).values()];

    if (targetContests.length === 0) {
      skippedContestCount += 1;
      continue;
    }

    matchedInputContestCount += 1;
    matchedContestCount += targetContests.length;
    for (const targetContest of targetContests) {
      const conflictingCodeforcesSource = (targetContest.sources ?? []).find(
        (source) =>
          source?.provider === "codeforces" &&
          source?.kind === "contest" &&
          normalizeUrl(source.url) !== importedContest.normalizedUrl,
      );
      if (conflictingCodeforcesSource) {
        throw new Error(
          `contest ${targetContest.contestId} already points to a different Codeforces contest: ${conflictingCodeforcesSource.url}`,
        );
      }

      const previousContest = JSON.stringify(targetContest);
      targetContest.aliases = dedupeStrings([
        ...(targetContest.aliases ?? []),
        importedContest.title !== targetContest.title ? importedContest.title : null,
      ]);
      targetContest.sources = mergeSourceList(targetContest.sources ?? [], {
        provider: "codeforces",
        kind: "contest",
        url: importedContest.url,
        provider_contest_id: importedContest.providerContestId,
        source_title: importedContest.title,
        label: importedContest.sourceLabel,
      });
      if (JSON.stringify(targetContest) !== previousContest) {
        if (!insertedContestIds.has(targetContest.contestId)) {
          updatedContestIds.add(targetContest.contestId);
        }
      }

      const existingProblems = problems.filter((problem) => problem.contestId === targetContest.contestId);
      const existingByOrdinal = new Map(
        existingProblems.map((problem) => [cleanText(problem.ordinal).toLowerCase(), problem]),
      );
      const existingByTitle = new Map(
        existingProblems.map((problem) => [normalizeTitleKey(problem.title), problem]),
      );
      const existingByProviderProblemId = new Map();
      for (const problem of existingProblems) {
        for (const source of problem.sources ?? []) {
          if (source?.provider === "codeforces" && source?.kind === "problem" && source?.provider_problem_id) {
            existingByProviderProblemId.set(cleanText(source.provider_problem_id), problem);
          }
        }
      }

      for (const importedProblem of importedContest.problems) {
        const source = {
          provider: "codeforces",
          kind: "problem",
          url: importedProblem.url,
          provider_problem_id: importedProblem.provider_problem_id,
          source_title: importedProblem.title,
          label: `Codeforces ${importedProblem.ordinal}`,
        };
        const matched =
          existingByProviderProblemId.get(importedProblem.provider_problem_id) ??
          (remap ? existingByTitle.get(normalizeTitleKey(importedProblem.title)) : null) ??
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
          if (JSON.stringify(matched) !== previousProblem) {
            updatedProblemCount += 1;
          } else {
            unchangedProblemCount += 1;
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
        existingByTitle.set(normalizeTitleKey(importedProblem.title), problem);
        existingByProviderProblemId.set(importedProblem.provider_problem_id, problem);
        insertedProblemCount += 1;
      }
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

  for (const contest of catalog.contests ?? []) {
    const nextProblemIds = problemIdsByContestId.get(contest.contestId) ?? [];
    contest.problemIds = nextProblemIds;
    if (nextProblemIds.length > 0 && contest.curationStatus === "contest_stub") {
      contest.curationStatus = "problem_listed";
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
        checkOnly,
        changed,
        importedContestCount: inputContests.length,
        matchedInputContestCount,
        matchedContestCount,
        skippedContestCount,
        insertedContestCount: insertedContestIds.size,
        updatedContestCount: updatedContestIds.size,
        insertedProblemCount,
        updatedProblemCount,
        unchangedProblemCount,
        totalProblemCount: catalog.problems.length,
      },
      null,
      2,
    ),
  );

  if (checkOnly && changed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
