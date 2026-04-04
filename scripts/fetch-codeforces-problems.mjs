import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "data", "final.json");
const DEFAULT_OUTPUT_PATH = resolve(repoRoot, "data", "codeforces-problems.json");
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_RETRIES = 4;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function dedupeBy(items, getKey) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeInputEntries(raw) {
  if (Array.isArray(raw)) {
    return raw
      .filter((item) => item && typeof item.url === "string" && /codeforces\.com\/(?:gym|contest)\//iu.test(item.url))
      .map((item) => ({
        title: cleanText(item.title),
        url: cleanText(item.url),
      }));
  }

  if (raw?.exportKind === "local_catalog_snapshot" && Array.isArray(raw.contests)) {
    return raw.contests.flatMap((contest) =>
      (contest.sources ?? [])
        .filter((source) => source?.kind === "contest" && typeof source?.url === "string" && /codeforces\.com\/(?:gym|contest)\//iu.test(source.url))
        .map((source) => ({
          title: cleanText(contest.title || source.source_title),
          url: cleanText(source.url),
        })),
    );
  }

  if (Array.isArray(raw?.contests)) {
    return raw.contests
      .filter((item) => item && typeof item.url === "string" && /codeforces\.com\/(?:gym|contest)\//iu.test(item.url))
      .map((item) => ({
        title: cleanText(item.title),
        url: cleanText(item.url),
      }));
  }

  throw new Error("input JSON must be an array or an object with contests");
}

async function requestCodeforcesContestStandings(contestId) {
  const apiUrl = new URL("https://codeforces.com/api/contest.standings");
  apiUrl.searchParams.set("contestId", contestId);
  apiUrl.searchParams.set("from", "1");
  apiUrl.searchParams.set("count", "1");

  const response = await fetch(apiUrl.toString());
  if (!response.ok) {
    throw new Error(`Codeforces API HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.status !== "OK" || !payload?.result?.problems) {
    throw new Error("Unexpected Codeforces API response");
  }

  return payload.result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestCodeforcesContestStandingsWithRetry(contestId, options = {}) {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await requestCodeforcesContestStandings(contestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimited = /HTTP 429/.test(message);
      if (!isRateLimited || attempt === maxRetries) {
        throw error;
      }
      const delayMs = 1500 * (attempt + 1);
      await sleep(delayMs);
    }
  }

  throw new Error(`unreachable retry flow for contest ${contestId}`);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );
  return results;
}

async function main() {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT_PATH;
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT_PATH;
  const concurrency = Number(process.argv[4] ?? DEFAULT_CONCURRENCY);
  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  const entries = dedupeBy(normalizeInputEntries(raw), (entry) => entry.url);

  const total = entries.length;
  let finished = 0;

  const results = await mapWithConcurrency(entries, concurrency, async (entry) => {
    const contestId = entry.url.match(/\/(?:gym|contest)\/(\d+)/iu)?.[1];
    if (!contestId) {
      finished += 1;
      return {
        title: entry.title,
        url: entry.url,
        problems: [],
        error: "cannot infer contest id",
      };
    }

    try {
      const standings = await requestCodeforcesContestStandingsWithRetry(contestId);
      const contestUrl = entry.url.replace(/[#?].*$/u, "");
      const problems = dedupeBy(
        standings.problems
          .filter((problem) => cleanText(problem?.index))
          .map((problem) => {
            const ordinal = cleanText(problem.index);
            return {
              ordinal,
              title: cleanText(problem.name),
              url: `${contestUrl}/problem/${ordinal}`,
              provider_problem_id: `${contestId}:${ordinal}`,
            };
          }),
        (problem) => `${cleanText(problem.ordinal).toLowerCase()}@@${problem.provider_problem_id}`,
      );
      finished += 1;
      console.log(`[${finished}/${total}] OK ${entry.url} ${problems.length} problems`);
      return {
        title: entry.title,
        url: entry.url,
        problems,
      };
    } catch (error) {
      finished += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${finished}/${total}] FAIL ${entry.url} ${message}`);
      return {
        title: entry.title,
        url: entry.url,
        problems: [],
        error: message,
      };
    }
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        inputPath,
        outputPath,
        concurrency,
        totalContestCount: results.length,
        successCount: results.filter((item) => !item.error).length,
        failedCount: results.filter((item) => !!item.error).length,
        totalProblemCount: results.reduce((sum, item) => sum + item.problems.length, 0),
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
