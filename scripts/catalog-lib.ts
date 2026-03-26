// @ts-nocheck

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CURATION_STATUS = new Set([
  "contest_stub",
  "problem_listed",
  "reviewed",
]);

export function getRepoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function getCatalogBundlePath(): string {
  return join(getRepoRoot(), "catalog", "default-catalog.min.json");
}

type CatalogSource = {
  provider: string;
  kind: string;
  url: string;
  provider_contest_id?: string;
  provider_problem_id?: string;
  label?: string;
};

type CatalogProblem = {
  id: string;
  ordinal: string;
  title: string;
  aliases: string[];
  sources: CatalogSource[];
};

export type CatalogContest = {
  id: string;
  title: string;
  aliases: string[];
  tags: string[];
  start_at?: string;
  curation_status: string;
  sources: CatalogSource[];
  problems: CatalogProblem[];
  notes?: string;
};

type CatalogBundle = {
  schemaVersion?: number;
  exportKind?: string;
  exportedAt?: string;
  schema_version: number;
  catalog_id: string;
  title: string;
  exported_at: string;
  contests: CatalogContest[];
  problems?: Array<{
    problemId: string;
    contestId: string;
    ordinal: string;
    title: string;
    aliases: string[];
    sources: CatalogSource[];
  }>;
};

function assertString(value: unknown, label: string, errors: string[]) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value: unknown, label: string, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(`${label}[${index}] must be a non-empty string`);
    }
  }
}

function assertSourceArray(value: unknown, label: string, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label}[${index}] must be an object`);
      continue;
    }
    assertString(item.provider, `${label}[${index}].provider`, errors);
    assertString(item.kind, `${label}[${index}].kind`, errors);
    assertString(item.url, `${label}[${index}].url`, errors);
    if ("label" in item && item.label !== undefined && typeof item.label !== "string") {
      errors.push(`${label}[${index}].label must be a string when present`);
    }
    if (
      "provider_contest_id" in item &&
      item.provider_contest_id !== undefined &&
      typeof item.provider_contest_id !== "string"
    ) {
      errors.push(`${label}[${index}].provider_contest_id must be a string when present`);
    }
    if (
      "provider_problem_id" in item &&
      item.provider_problem_id !== undefined &&
      typeof item.provider_problem_id !== "string"
    ) {
      errors.push(`${label}[${index}].provider_problem_id must be a string when present`);
    }
  }
}

export function validateContest(contest: CatalogContest, filePath: string): string[] {
  const errors: string[] = [];

  if (!contest || typeof contest !== "object" || Array.isArray(contest)) {
    return [`${filePath}: contest file must contain a JSON object`];
  }

  assertString(contest.id, "id", errors);
  assertString(contest.title, "title", errors);
  assertStringArray(contest.aliases, "aliases", errors);
  assertStringArray(contest.tags, "tags", errors);
  assertSourceArray(contest.sources, "sources", errors);

  if (!CURATION_STATUS.has(contest.curation_status)) {
    errors.push(`curation_status must be one of: ${[...CURATION_STATUS].join(", ")}`);
  }
  if ("start_at" in contest && contest.start_at !== undefined && typeof contest.start_at !== "string") {
    errors.push("start_at must be a string when present");
  }
  if ("notes" in contest && contest.notes !== undefined && typeof contest.notes !== "string") {
    errors.push("notes must be a string when present");
  }

  if (!Array.isArray(contest.problems)) {
    errors.push("problems must be an array");
  } else {
    const problemIds = new Set<string>();
    for (const [index, problem] of contest.problems.entries()) {
      if (!problem || typeof problem !== "object" || Array.isArray(problem)) {
        errors.push(`problems[${index}] must be an object`);
        continue;
      }
      assertString(problem.id, `problems[${index}].id`, errors);
      assertString(problem.ordinal, `problems[${index}].ordinal`, errors);
      assertString(problem.title, `problems[${index}].title`, errors);
      assertStringArray(problem.aliases, `problems[${index}].aliases`, errors);
      assertSourceArray(problem.sources, `problems[${index}].sources`, errors);
      if (typeof problem.id === "string") {
        if (problemIds.has(problem.id)) {
          errors.push(`problems[${index}].id duplicates another problem id in the same contest`);
        }
        problemIds.add(problem.id);
      }
    }
  }

  return errors.map((error) => `${filePath}: ${error}`);
}

export async function loadCatalogContests(): Promise<CatalogContest[]> {
  const bundlePath = getCatalogBundlePath();
  const raw = await readFile(bundlePath, "utf8");
  const parsed = JSON.parse(raw) as CatalogBundle;

  if (parsed?.exportKind === "local_catalog_snapshot") {
    if (!Array.isArray(parsed.contests) || !Array.isArray(parsed.problems)) {
      throw new Error(`${bundlePath}: local catalog snapshot must contain contests and problems arrays`);
    }

    const problemsByContestId = new Map<string, CatalogProblem[]>();
    for (const problem of parsed.problems) {
      const bucket = problemsByContestId.get(problem.contestId) ?? [];
      bucket.push({
        id: problem.problemId,
        ordinal: problem.ordinal,
        title: problem.title,
        aliases: Array.isArray(problem.aliases) ? problem.aliases : [],
        sources: Array.isArray(problem.sources) ? problem.sources : [],
      });
      problemsByContestId.set(problem.contestId, bucket);
    }

    const contests = parsed.contests.map((contest) => ({
      id: contest.contestId,
      title: contest.title,
      aliases: Array.isArray(contest.aliases) ? contest.aliases : [],
      tags: Array.isArray(contest.tags) ? contest.tags : [],
      start_at: contest.startAt ?? undefined,
      curation_status: contest.curationStatus,
      sources: Array.isArray(contest.sources) ? contest.sources : [],
      problems: (problemsByContestId.get(contest.contestId) ?? []).sort((left, right) =>
        left.ordinal.localeCompare(right.ordinal),
      ),
      notes: contest.notes ?? undefined,
    }));

    const ids = new Set<string>();
    for (const [index, contest] of contests.entries()) {
      const filePath = `${bundlePath}#contests[${index}]`;
      const errors = validateContest(contest, filePath);
      if (errors.length > 0) {
        throw new Error(errors.join("\n"));
      }
      if (ids.has(contest.id)) {
        throw new Error(`${filePath}: duplicate contest id ${contest.id}`);
      }
      ids.add(contest.id);
    }

    return contests;
  }

  const bundleErrors: string[] = [];

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${bundlePath}: catalog bundle must contain a JSON object`);
  }
  if (parsed.schema_version !== 1) {
    bundleErrors.push("schema_version must be 1");
  }
  if (typeof parsed.catalog_id !== "string" || parsed.catalog_id.trim() === "") {
    bundleErrors.push("catalog_id must be a non-empty string");
  }
  if (typeof parsed.title !== "string" || parsed.title.trim() === "") {
    bundleErrors.push("title must be a non-empty string");
  }
  if (typeof parsed.exported_at !== "string" || parsed.exported_at.trim() === "") {
    bundleErrors.push("exported_at must be a non-empty string");
  }
  if (!Array.isArray(parsed.contests)) {
    bundleErrors.push("contests must be an array");
  }
  if (bundleErrors.length > 0) {
    throw new Error(bundleErrors.map((error) => `${bundlePath}: ${error}`).join("\n"));
  }

  const contests: CatalogContest[] = [];
  const ids = new Set<string>();

  for (const [index, contest] of parsed.contests.entries()) {
    const filePath = `${bundlePath}#contests[${index}]`;
    const errors = validateContest(contest, filePath);
    if (errors.length > 0) {
      const message = errors.join("\n");
      throw new Error(message);
    }
    if (ids.has(contest.id)) {
      throw new Error(`${filePath}: duplicate contest id ${contest.id}`);
    }
    ids.add(contest.id);
    contests.push(contest);
  }

  return contests;
}
