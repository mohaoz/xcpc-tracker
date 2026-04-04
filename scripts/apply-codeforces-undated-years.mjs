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

function mergeContestsByExactTags(contests) {
  const groups = new Map();
  for (const contest of contests) {
    const tagKey = createTagKey(contest.tags ?? []);
    const bucket = groups.get(tagKey) ?? [];
    bucket.push(contest);
    groups.set(tagKey, bucket);
  }

  const merged = [];
  for (const [tagKey, bucket] of groups) {
    if (bucket.length === 1) {
      merged.push(bucket[0]);
      continue;
    }

    const sortedBucket = [...bucket].sort(compareByTitle);
    const primary = sortedBucket[0];
    const aliases = dedupeStrings([
      ...(primary.aliases ?? []),
      ...sortedBucket.flatMap((contest) => [contest.title, ...(contest.aliases ?? [])]),
    ]).filter((alias) => alias !== primary.title);
    const sources = dedupeStrings(
      sortedBucket.flatMap((contest) =>
        (contest.sources ?? []).map((source) => JSON.stringify(source)),
      ),
    )
      .map((source) => JSON.parse(source))
      .sort(compareBySource);

    merged.push({
      ...primary,
      aliases,
      sources,
      contestId: primary.contestId,
    });
  }

  merged.sort(compareByTitle);
  return merged;
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

  catalog.contests = mergeContestsByExactTags(catalog.contests ?? []);

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
