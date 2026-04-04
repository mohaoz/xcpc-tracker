import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "catalog", "default-catalog.min.json");
const DEFAULT_OUTPUT_PATH = resolve(repoRoot, "fixtures", "imports", "codeforces", "undated-contest-times.json");

function hasYear(title) {
  return /\b(19|20)\d{2}\b/u.test(String(title ?? ""));
}

function parseProviderContestId(source) {
  if (typeof source?.provider_contest_id === "string" && source.provider_contest_id.trim()) {
    return source.provider_contest_id.trim();
  }
  const url = String(source?.url ?? "");
  const matched = url.match(/codeforces\.com\/gym\/(\d+)/iu) ?? url.match(/codeforces\.com\/contest\/(\d+)/iu);
  return matched?.[1] ?? null;
}

function normalizeInput(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.contests)) {
    throw new Error("catalog snapshot must contain a contests array");
  }
  return raw.contests;
}

async function requestCodeforcesContestList(gym) {
  const url = new URL("https://codeforces.com/api/contest.list");
  url.searchParams.set("gym", gym ? "true" : "false");

  const response = await fetch(url.toString(), {
    headers: {
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Codeforces API HTTP ${response.status} for gym=${gym}`);
  }

  const payload = await response.json();
  if (payload?.status !== "OK" || !Array.isArray(payload?.result)) {
    throw new Error(`Unexpected Codeforces API response for gym=${gym}`);
  }

  return payload.result;
}

function toIso(startTimeSeconds) {
  if (typeof startTimeSeconds !== "number") {
    return null;
  }
  return new Date(startTimeSeconds * 1000).toISOString();
}

async function main() {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT_PATH;
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT_PATH;

  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  const contests = normalizeInput(raw);

  const targetEntries = contests
    .filter((contest) => !hasYear(contest.title))
    .flatMap((contest) =>
      (contest.sources ?? [])
        .filter((source) => source?.provider === "codeforces" && source?.kind === "contest")
        .map((source) => {
          const providerContestId = parseProviderContestId(source);
          return providerContestId
            ? {
                localContestId: contest.contestId,
                title: contest.title,
                providerContestId,
                url: source.url ?? null,
              }
            : null;
        })
        .filter(Boolean),
    );

  const dedupedTargets = [...new Map(
    targetEntries.map((entry) => [`${entry.providerContestId}::${entry.title}`, entry]),
  ).values()];

  const [regularContests, gymContests] = await Promise.all([
    requestCodeforcesContestList(false),
    requestCodeforcesContestList(true),
  ]);
  const contestsById = new Map(
    [...regularContests, ...gymContests].map((contest) => [String(contest.id), contest]),
  );

  const resolved = dedupedTargets.map((entry) => {
    const matched = contestsById.get(entry.providerContestId) ?? null;
    return {
      ...entry,
      found: !!matched,
      name: matched?.name ?? null,
      phase: matched?.phase ?? null,
      type: matched?.type ?? null,
      startTimeSeconds: matched?.startTimeSeconds ?? null,
      startAt: toIso(matched?.startTimeSeconds),
      durationSeconds: matched?.durationSeconds ?? null,
      relativeTimeSeconds: matched?.relativeTimeSeconds ?? null,
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    sourceCatalog: inputPath,
    targetCount: dedupedTargets.length,
    matchedCount: resolved.filter((entry) => entry.found).length,
    unmatchedCount: resolved.filter((entry) => !entry.found).length,
    contests: resolved.sort((left, right) => {
      const leftTime = left.startTimeSeconds ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.startTimeSeconds ?? Number.MAX_SAFE_INTEGER;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.title.localeCompare(right.title);
    }),
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    inputPath,
    outputPath,
    targetCount: output.targetCount,
    matchedCount: output.matchedCount,
    unmatchedCount: output.unmatchedCount,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
