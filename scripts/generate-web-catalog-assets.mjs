import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const INPUT_PATH = resolve(repoRoot, "catalog", "default-catalog.min.json");
const OUTPUT_DIR = resolve(repoRoot, "catalog", "generated");
const CONTESTS_DIR = resolve(OUTPUT_DIR, "contests");

function toJson(value) {
  return `${JSON.stringify(value)}\n`;
}

async function main() {
  const raw = await readFile(INPUT_PATH, "utf8");
  const snapshot = JSON.parse(raw);

  const problemsByContestId = new Map();
  for (const problem of snapshot.problems ?? []) {
    const bucket = problemsByContestId.get(problem.contestId) ?? [];
    bucket.push(problem);
    problemsByContestId.set(problem.contestId, bucket);
  }

  const contestIndex = {
    generated_at: snapshot.exportedAt,
    source: "catalog/default-catalog.min.json",
    contest_count: snapshot.contests?.length ?? 0,
    problem_count: snapshot.problems?.length ?? 0,
    contests: (snapshot.contests ?? []).map((contest) => ({
      id: contest.contestId,
      title: contest.title,
      aliases: contest.aliases ?? [],
      tags: contest.tags ?? [],
      start_at: contest.startAt ?? null,
      curation_status: contest.curationStatus,
      sources: contest.sources ?? [],
      awardCutoffs: contest.awardCutoffs ?? null,
      notes: contest.notes ?? null,
      generated_from: contest.generatedFrom ?? "catalog",
      problem_count: contest.problemIds?.length ?? problemsByContestId.get(contest.contestId)?.length ?? 0,
    })),
  };

  const coverageBasis = {
    generated_at: snapshot.exportedAt,
    contest_count: snapshot.contests?.length ?? 0,
    problem_count: snapshot.problems?.length ?? 0,
    contests: (snapshot.contests ?? []).map((contest) => ({
      contestId: contest.contestId,
      problems: (problemsByContestId.get(contest.contestId) ?? []).map((problem) => ({
        problemId: problem.problemId,
        ordinal: problem.ordinal,
        title: problem.title,
      })),
    })),
  };

  const problemLookup = {
    generated_at: snapshot.exportedAt,
    problem_count: snapshot.problems?.length ?? 0,
    problems: snapshot.problems ?? [],
  };

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(CONTESTS_DIR, { recursive: true });

  await writeFile(resolve(OUTPUT_DIR, "contest-index.json"), toJson(contestIndex), "utf8");
  await writeFile(resolve(OUTPUT_DIR, "coverage-basis.json"), toJson(coverageBasis), "utf8");
  await writeFile(resolve(OUTPUT_DIR, "problem-lookup.json"), toJson(problemLookup), "utf8");

  for (const contest of snapshot.contests ?? []) {
    const detail = {
      id: contest.contestId,
      title: contest.title,
      aliases: contest.aliases ?? [],
      tags: contest.tags ?? [],
      start_at: contest.startAt ?? null,
      curation_status: contest.curationStatus,
      sources: contest.sources ?? [],
      awardCutoffs: contest.awardCutoffs ?? null,
      problems: (problemsByContestId.get(contest.contestId) ?? []).map((problem) => ({
        id: problem.problemId,
        ordinal: problem.ordinal,
        title: problem.title,
        aliases: problem.aliases ?? [],
        sources: problem.sources ?? [],
      })),
      notes: contest.notes ?? undefined,
      generated_from: contest.generatedFrom ?? "catalog",
      problem_count: contest.problemIds?.length ?? problemsByContestId.get(contest.contestId)?.length ?? 0,
    };

    await writeFile(
      resolve(CONTESTS_DIR, `${encodeURIComponent(contest.contestId)}.json`),
      toJson(detail),
      "utf8",
    );
  }

  console.log(JSON.stringify({
    inputPath: INPUT_PATH,
    outputDir: OUTPUT_DIR,
    contestCount: contestIndex.contest_count,
    problemCount: problemLookup.problem_count,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
