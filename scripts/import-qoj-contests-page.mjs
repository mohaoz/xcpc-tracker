import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = "/tmp/qoj-import/qoj-contests.md";
const DEFAULT_OUTPUT_PATH = resolve(repoRoot, "fixtures/imports/qoj/qoj-contests-page-catalog-draft.json");
const QOJ_CONTESTS_PAGE_URL = "https://qoj.ac/contests?tab=all";

const IGNORE_LINES = new Set([
  "Login",
  "Register",
  "QOJ.ac",
  "QOJ",
  "Contests",
  "Category",
  "Problems",
  "Submissions",
  "Hack!",
  "Blogs",
  "Current or upcoming contests",
  "Ended contests",
  "Looking for a specific contest? Visit the categories page to browse contests organized by source.",
  "Filter by Ruleset: All Contests",
  "Name\tStart time\tDuration\tDifficulty",
  "English",
  "QOJ.ac | QOJ 4.5.42.0.dev | Based on UOJ - OpenSource Project",
  "Made with ❤️ by Qingyu✨",
]);

function createDeterministicUuid(seed) {
  const hash = createHash("sha1").update(`xcpc-tracker:qoj-contests:${seed}`).digest("hex");
  const part1 = hash.slice(0, 8);
  const part2 = hash.slice(8, 12);
  const part3 = `5${hash.slice(13, 16)}`;
  const variantNibble = (parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8;
  const part4 = `${variantNibble.toString(16)}${hash.slice(17, 20)}`;
  const part5 = hash.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

function cleanTitle(title) {
  return title
    .replace(/^\\s+|\\s+$/g, "")
    .replace(/pending final test$/u, "")
    .replace(/register$/u, "")
    .trim();
}

function normalizeStartAt(value) {
  if (!value || value === "-" || value === "Not set") {
    return null;
  }
  return value;
}

function normalizeDuration(value) {
  if (!value || value === "-") {
    return null;
  }
  return value;
}

function parseContestLines(markdown) {
  const records = [];
  const lines = markdown.split(/\r?\n/u);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }
    if (IGNORE_LINES.has(trimmed)) {
      continue;
    }
    if (
      trimmed.startsWith("Title:") ||
      trimmed.startsWith("URL Source:") ||
      trimmed.startsWith("Markdown Content:") ||
      trimmed.startsWith("Server Time:")
    ) {
      continue;
    }
    if (/ Countdown$/u.test(trimmed) || /^[0-9]+ days /u.test(trimmed)) {
      continue;
    }

    const columns = trimmed.split("\t");
    const hasMetadata = columns.length >= 4;
    const rawTitle = columns[0] ?? "";
    const title = cleanTitle(rawTitle);

    if (!title) {
      continue;
    }

    records.push({
      title,
      rawTitle,
      startAt: hasMetadata ? normalizeStartAt(columns.at(-3)) : null,
      duration: hasMetadata ? normalizeDuration(columns.at(-2)) : null,
    });
  }

  return records;
}

function buildDraftBundle(records, exportedAt) {
  return {
    schemaVersion: 1,
    exportKind: "local_catalog_snapshot",
    exportedAt,
    contests: records.map((record) => {
      const contestId = createDeterministicUuid(record.title);
      const notes = [
        "Imported from the QOJ contests index page via a text mirror.",
        "This is a draft catalog candidate, not canonical curated data.",
        record.duration ? `Visible duration on index page: ${record.duration}.` : null,
        record.rawTitle !== record.title ? `Raw index title: ${record.rawTitle}.` : null,
        "Contest-specific URL and problem list were not resolved in this draft import.",
      ]
        .filter(Boolean)
        .join(" ");

      return {
        contestId,
        title: record.title,
        aliases: [],
        tags: ["qoj", "draft_import"],
        startAt: record.startAt,
        curationStatus: "contest_stub",
        problemIds: [],
        sources: [
          {
            provider: "qoj",
            kind: "contest_list_entry",
            url: QOJ_CONTESTS_PAGE_URL,
            source_title: record.title,
            label: "QOJ contests page",
          },
        ],
        notes,
        generatedFrom: "qoj_contests_page_import",
      };
    }),
    problems: [],
  };
}

async function main() {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT_PATH;
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT_PATH;
  const raw = await readFile(inputPath, "utf8");
  const records = parseContestLines(raw);
  const bundle = buildDraftBundle(records, new Date().toISOString());

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        inputPath,
        outputPath,
        contestCount: records.length,
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
