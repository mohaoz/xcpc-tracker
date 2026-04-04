import { execFile } from "node:child_process";
import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "data", "contests.json");
const DEFAULT_OUTPUT_PATH = resolve(repoRoot, "data", "final.json");
const DEFAULT_RULES_PATH = resolve(__dirname, "filter-rules.cjs");
const DEFAULT_FILTER_PATH = resolve(__dirname, "filter-contests.cjs");

async function main() {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT_PATH;
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT_PATH;
  const rulesPath = process.argv[4] ? resolve(process.argv[4]) : DEFAULT_RULES_PATH;

  await mkdir(dirname(outputPath), { recursive: true });

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [DEFAULT_FILTER_PATH, inputPath, rulesPath, outputPath],
    {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 16,
    },
  );

  if (stdout.trim()) {
    process.stdout.write(stdout);
    if (!stdout.endsWith("\n")) process.stdout.write("\n");
  }
  if (stderr.trim()) {
    process.stderr.write(stderr);
    if (!stderr.endsWith("\n")) process.stderr.write("\n");
  }

  console.log(
    JSON.stringify(
      {
        inputPath,
        outputPath,
        rulesPath,
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
