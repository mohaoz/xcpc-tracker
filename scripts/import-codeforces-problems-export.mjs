import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "data", "codeforces-problems.json");
const DEFAULT_CATALOG_PATH = resolve(repoRoot, "catalog", "default-catalog.min.json");
const DEFAULT_OUTPUT_PATH = DEFAULT_CATALOG_PATH;
// Original SUA/QOJ J is CF C; original C has no current CF mirror.
// Evidence: fixtures/imports/codeforces/2026-10-02-mapping-review.json.
const REVIEWED_PROBLEM_REMAPS = new Map([
  ["103117:C", { problemId: "8bd18c44-77b5-5f30-938a-83d2fe690a46:J", title: "Ants" }],
]);
const REVIEWED_UNMIRRORED_PROBLEMS = new Map([
  ["103117", [{ problemId: "8bd18c44-77b5-5f30-938a-83d2fe690a46:C", title: "Triangle Pendant" }]],
]);
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
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("input JSON must be a non-empty array");
  }
  const contestIds = new Set();
  return raw
    .map((contest, contestIndex) => {
      const label = `contests[${contestIndex}]`;
      if (!Array.isArray(contest?.problems) || contest.problems.length === 0) {
        throw new Error(`${label}.problems must be a complete, non-empty problem list`);
      }
      const title = cleanText(contest.title);
      const url = cleanText(contest.url);
      const normalizedUrl = normalizeUrl(url);
      const providerContestId = getCodeforcesContestId(normalizedUrl);
      if (!title || !url || !providerContestId) {
        throw new Error(`${label} requires a title and a Codeforces gym/contest URL`);
      }
      if (contestIds.has(providerContestId)) {
        throw new Error(`${label} duplicates Codeforces contest ${providerContestId}`);
      }
      contestIds.add(providerContestId);

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

function addOwner(index, key, owner) {
  const owners = index.get(key) ?? new Set();
  owners.add(owner);
  index.set(key, owners);
}

function hasTitle(problem, title) {
  const key = normalizeTitleKey(title);
  return [problem.title, ...(problem.aliases ?? [])].some((candidate) => normalizeTitleKey(candidate) === key);
}

// Validate the whole incoming source graph before merging any of its rows.
// In particular, neither catalog order nor a previous row may establish identity.
function planProblemMappings(importedContest, targetContests, problems, remap) {
  const targetIds = new Set(targetContests.map((contest) => contest.contestId));
  const explicitIds = new Set(importedContest.targetContestIds);
  const incomingIds = new Set(importedContest.problems.map((problem) => problem.provider_problem_id));
  const ownersById = new Map();
  for (const problem of problems) {
    for (const source of problem.sources ?? []) {
      if (source?.provider !== "codeforces" || source?.kind !== "problem") continue;
      const providerId = cleanText(source.provider_problem_id);
      const urlContestId = getCodeforcesContestId(source.url);
      if (providerId.split(":")[0] !== importedContest.providerContestId
        && urlContestId !== importedContest.providerContestId) continue;
      const urlId = `${urlContestId}:${getCodeforcesProblemOrdinal(source.url)}`;
      if (providerId !== urlId || !incomingIds.has(providerId)) {
        throw new Error(`Incomplete or conflicting CF source list: ${providerId || source.url}`);
      }
      addOwner(ownersById, providerId, problem);
    }
  }

  if (targetIds.size > 1 && [...targetIds].some((id) => !explicitIds.has(id))) {
    throw new Error(`Shared Codeforces contest ${importedContest.providerContestId} requires explicit targets`);
  }
  for (const [providerId, owners] of ownersById) {
    const ownerContestIds = new Set();
    for (const owner of owners) {
      if (ownerContestIds.has(owner.contestId) || !targetIds.has(owner.contestId)) {
        throw new Error(`Ambiguous CF problem ownership: ${providerId}`);
      }
      ownerContestIds.add(owner.contestId);
    }
    if (owners.size > 1 && [...ownerContestIds].some((id) => !explicitIds.has(id))) {
      throw new Error(`Shared CF problem ${providerId} requires explicit targets`);
    }
  }

  return targetContests.map((targetContest) => {
    const existing = problems.filter((problem) => problem.contestId === targetContest.contestId);
    const matchedIds = new Set();
    const rows = importedContest.problems.map((importedProblem) => {
      const providerId = importedProblem.provider_problem_id;
      const owners = [...(ownersById.get(providerId) ?? [])];
      const previousOwner = owners.find((problem) => problem.contestId === targetContest.contestId);
      const reviewedRemap = REVIEWED_PROBLEM_REMAPS.get(providerId);
      const remappedProblem = reviewedRemap
        ? existing.find((problem) => problem.problemId === reviewedRemap.problemId)
        : null;
      if (reviewedRemap && (!remappedProblem
        || remappedProblem.title !== reviewedRemap.title
        || importedProblem.title !== reviewedRemap.title)) {
        throw new Error(`Reviewed CF problem identity changed: ${providerId}`);
      }
      if (reviewedRemap && previousOwner && previousOwner !== remappedProblem) {
        throw new Error(`Apply the reviewed source correction before importing ${providerId}`);
      }
      const titleMatches = existing.filter((problem) => hasTitle(problem, importedProblem.title));
      const ordinalMatches = existing.filter((problem) =>
        cleanText(problem.ordinal).toLowerCase() === importedProblem.ordinal.toLowerCase());
      if (titleMatches.length > 1 || (!previousOwner && !remappedProblem && !remap && ordinalMatches.length > 1)) {
        throw new Error(`Ambiguous CF problem identity: ${providerId}`);
      }
      const matched = remappedProblem ?? previousOwner
        ?? (remap ? titleMatches[0] : ordinalMatches[0]) ?? null;
      if (existing.length > 0 && (!matched || !hasTitle(matched, importedProblem.title))) {
        throw new Error(`CF problem title/identity mismatch: ${providerId}`);
      }
      if (matched && matchedIds.has(matched.problemId)) {
        throw new Error(`Multiple CF problems claim ${matched.problemId}`);
      }
      if (matched) matchedIds.add(matched.problemId);
      return { importedProblem, matched };
    });

    const reviewedOmissions = REVIEWED_UNMIRRORED_PROBLEMS.get(importedContest.providerContestId) ?? [];
    for (const omission of reviewedOmissions) {
      const problem = existing.find((candidate) => candidate.problemId === omission.problemId);
      if (!problem || problem.title !== omission.title || matchedIds.has(problem.problemId)) {
        throw new Error(`Reviewed unmirrored problem identity changed: ${omission.problemId}`);
      }
    }
    const omittedIds = new Set(reviewedOmissions.map((problem) => problem.problemId));
    if (existing.some((problem) => !matchedIds.has(problem.problemId) && !omittedIds.has(problem.problemId))) {
      throw new Error(`Incomplete CF problem list for contest ${targetContest.contestId}`);
    }

    const conflictingSource = (targetContest.sources ?? []).find((source) =>
      source?.provider === "codeforces" && source?.kind === "contest"
      && normalizeUrl(source.url) !== importedContest.normalizedUrl);
    if (conflictingSource && (!explicitIds.has(targetContest.contestId) || existing.length === 0)) {
      throw new Error(
        `contest ${targetContest.contestId} already points to a different Codeforces contest; an explicit target and matching complete problem list are required: ${conflictingSource.url}`,
      );
    }
    return { targetContest, rows };
  });
}

async function writeCatalogAtomically(path, catalog) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
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
    if (contestsById.has(contest.contestId)) {
      throw new Error(`Duplicate catalog contest ID: ${contest.contestId}`);
    }
    contestsById.set(contest.contestId, contest);
    for (const source of contest.sources ?? []) {
      const providerContestId = cleanText(source?.provider_contest_id);
      if (source?.provider && source?.kind === "contest" && providerContestId) {
        addOwner(contestsBySourceKey, `${source.provider}:${providerContestId}`, contest);
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
  if (usedProblemIds.size !== problems.length) {
    throw new Error("Duplicate catalog problem ID");
  }
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
            addOwner(contestsBySourceKey, `${source.provider}:${providerContestId}`, targetContest);
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
      targetContests = [...(contestsBySourceKey.get(`${remap.provider}:${remap.provider_contest_id}`) ?? [])];
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
    const plans = planProblemMappings(importedContest, targetContests, problems, remap);
    for (const { targetContest, rows } of plans) {
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

      for (const { importedProblem, matched } of rows) {
        const source = {
          provider: "codeforces",
          kind: "problem",
          url: importedProblem.url,
          provider_problem_id: importedProblem.provider_problem_id,
          source_title: importedProblem.title,
          label: `Codeforces ${importedProblem.ordinal}`,
        };
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
    await writeCatalogAtomically(outputPath, catalog);
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
