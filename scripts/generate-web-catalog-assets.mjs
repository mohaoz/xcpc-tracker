import { mkdir, readFile, readdir, unlink, rename, writeFile } from "node:fs/promises";
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

async function writeAsset(path,content) {
  const temporary=`${path}.tmp-${process.pid}`;
  await writeFile(temporary,content,'utf8');
  await rename(temporary,path);
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

  const unpublishedContests = (snapshot.contests ?? []).filter(
    (contest) =>
      contest.curationStatus === "contest_stub" ||
      (problemsByContestId.get(contest.contestId) ?? []).length === 0,
  );
  if (unpublishedContests.length > 0) {
    const preview = unpublishedContests
      .slice(0, 5)
      .map((contest) => `${contest.contestId} (${contest.title})`)
      .join(", ");
    throw new Error(
      `refusing to generate public assets for ${unpublishedContests.length} contests without curated problems: ${preview}`,
    );
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
      estimatedAwardCutoffs: contest.estimatedAwardCutoffs ?? null,
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

  await mkdir(CONTESTS_DIR, { recursive: true });

  await writeAsset(resolve(OUTPUT_DIR, "coverage-basis.json"), toJson(coverageBasis));
  await writeAsset(resolve(OUTPUT_DIR, "problem-lookup.json"), toJson(problemLookup));

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
      estimatedAwardCutoffs: contest.estimatedAwardCutoffs ?? null,
      problems: (problemsByContestId.get(contest.contestId) ?? []).map((problem) => ({
        id: problem.problemId,
        tags: problem.tags ?? [],
        rating: problem.rating,
        ordinal: problem.ordinal,
        title: problem.title,
        aliases: problem.aliases ?? [],
        sources: problem.sources ?? [],
      })),
      notes: contest.notes ?? undefined,
      generated_from: contest.generatedFrom ?? "catalog",
      problem_count: contest.problemIds?.length ?? problemsByContestId.get(contest.contestId)?.length ?? 0,
    };

    await writeAsset(
      resolve(CONTESTS_DIR, `${encodeURIComponent(contest.contestId)}.json`),
      toJson(detail),
    );
  }

  // Publish the index after every referenced detail exists. Keep the directory watched by Vite.
  await writeAsset(resolve(OUTPUT_DIR, 'contest-index.json'),toJson(contestIndex));
  const current=new Set(snapshot.contests.map(c=>`${encodeURIComponent(c.contestId)}.json`));
  for(const entry of await readdir(CONTESTS_DIR,{withFileTypes:true})) {
    if(entry.isFile() && entry.name.endsWith('.json') && !current.has(entry.name))await unlink(resolve(CONTESTS_DIR,entry.name));
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
