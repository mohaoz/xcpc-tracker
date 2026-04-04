import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "data", "final.json");
const DEFAULT_CATALOG_PATH = resolve(repoRoot, "catalog", "default-catalog.min.json");
const DEFAULT_TIMES_PATH = resolve(repoRoot, "fixtures", "imports", "codeforces", "undated-contest-times.json");

async function runNodeScript(scriptPath, args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 16,
  });

  if (stdout.trim()) {
    process.stdout.write(stdout);
    if (!stdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  if (stderr.trim()) {
    process.stderr.write(stderr);
    if (!stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
}

async function main() {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT_PATH;
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_CATALOG_PATH;
  const timesPath = process.argv[4] ? resolve(process.argv[4]) : DEFAULT_TIMES_PATH;
  const skipCodeforces = process.argv.includes("--skip-codeforces");

  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(timesPath), { recursive: true });

  await runNodeScript(resolve(__dirname, "rebuild-catalog-from-result.mjs"), [
    inputPath,
    outputPath,
  ]);

  if (!skipCodeforces) {
    await runNodeScript(resolve(__dirname, "fetch-codeforces-undated-contest-times.mjs"), [
      outputPath,
      timesPath,
    ]);

    await runNodeScript(resolve(__dirname, "apply-codeforces-undated-years.mjs"), [
      outputPath,
      timesPath,
      outputPath,
    ]);
  }

  console.log(JSON.stringify({
    inputPath,
    outputPath,
    timesPath: skipCodeforces ? null : timesPath,
    skippedCodeforces: skipCodeforces,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
