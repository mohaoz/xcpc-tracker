import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixture = JSON.parse(await readFile(resolve(repoRoot, "fixtures/imports/qoj/contest-export-regression.json"), "utf8"));

function makePage(page: any) {
  const rows = (page.rows ?? []).map((row: any) => {
    const cells = [{ textContent: row.ordinal }, { textContent: row.title }];
    const anchor = {
      href: new URL(row.href, page.url).toString(),
      textContent: row.title,
      getAttribute: () => row.href,
      closest: () => ({ previousElementSibling: cells[0] }),
    };
    return { querySelectorAll: (selector: string) => (selector === "td" ? cells : [anchor]) };
  });
  return {
    title: `${page.title} - QOJ.ac`,
    querySelector: (selector: string) => (selector === "h1" ? { textContent: page.title } : null),
    querySelectorAll: (selector: string) => (selector === "tr" ? rows : []),
  };
}

async function browserEnvironment(current: any, pages: any[] = [current]) {
  const page = makePage(current);
  const downloads: Blob[] = [];
  const requests: string[] = [];
  const logs: unknown[][] = [];
  let clipboard = "";
  const entries = pages.map(({ title, url }) => ({ title, url }));
  const environment = {
    URL: class extends URL {
      static createObjectURL(blob: Blob) { downloads.push(blob); return "blob:fixture"; }
      static revokeObjectURL() {}
    },
    Blob,
    location: new URL(current.url),
    navigator: { clipboard: { writeText: async (text: string) => { clipboard = text; } } },
    console: { log: (...items: unknown[]) => logs.push(items), warn: (...items: unknown[]) => logs.push(items) },
    document: {
      ...page,
      body: { appendChild() {} },
      createElement(tag: string) {
        if (tag !== "input") return { click() {} };
        let onChange: () => void;
        return {
          style: {},
          files: [{ text: async () => JSON.stringify(entries) }],
          addEventListener: (_: string, callback: () => void) => { onChange = callback; },
          click: () => { queueMicrotask(onChange); },
          remove() {},
        };
      },
    },
    DOMParser: class { parseFromString(text: string) { return makePage(JSON.parse(text)); } },
    fetch: async (url: string, options: any) => {
      requests.push(url);
      expect(options.credentials).toBe("include");
      const response = pages.find((candidate) => candidate.url === url);
      expect(response, `unexpected request: ${url}`).toBeTruthy();
      return {
        ok: !response.status || response.status === 200,
        status: response.status ?? 200,
        url: response.fetched_url ?? url,
        text: async () => JSON.stringify(response),
      };
    },
  };
  return { environment, downloads, requests, logs, getClipboard: () => clipboard };
}

const batchSource = await readFile(resolve(repoRoot, "scripts/browser-fetch-qoj-problems.mjs"), "utf8");
const singleSource = await readFile(resolve(repoRoot, "scripts/browser-fetch-current-contest-problems.mjs"), "utf8");
const failedPages = [
  { title: "Empty page", url: "https://qoj.ac/contest/900002?v=1", rows: [] },
  { title: "Login redirect", url: "https://qoj.ac/contest/900003", fetched_url: "https://qoj.ac/login" },
  { title: "Lost version", url: "https://qoj.ac/contest/900004?v=1", fetched_url: "https://qoj.ac/contest/900004" },
  { title: "HTTP error", url: "https://qoj.ac/contest/900005", status: 403 },
];

describe("QOJ contest export browser scripts", () => {
  it("batch export parses versioned/relative links and reports empty, login, version-loss and HTTP failures", async () => {
    const batch = await browserEnvironment(fixture, [fixture, ...failedPages]);
    const result = JSON.parse(JSON.stringify(await vm.runInNewContext(batchSource, batch.environment, { timeout: 1000 })));
    expect(result).toHaveLength(5);
    expect(result[0].problems).toStrictEqual(fixture.expected_problems);
    expect(result[0].fetched_url).toBe(fixture.url);
    expect(result[0].source_title).toBe(fixture.title);
    expect(result[1].error).toContain("未解析到题目");
    expect(result[2].error).toContain("跳转");
    expect(result[3].error).toContain("版本");
    expect(result[4].error).toContain("403");
    expect(batch.requests).toStrictEqual([fixture, ...failedPages].map((page) => page.url));
    expect(JSON.parse(batch.getClipboard())).toStrictEqual(result);
    expect(batch.downloads).toHaveLength(1);
    expect(JSON.parse(await batch.downloads[0].text())).toStrictEqual(result);
    expect(batch.logs.some((items: any) => items[0]?.success_count === 1 && items[0]?.failed_count === 4)).toBe(true);
  });

  it("single-contest export returns and downloads the expected problems", async () => {
    const single = await browserEnvironment(fixture);
    const singleResult = JSON.parse(JSON.stringify(await vm.runInNewContext(singleSource, single.environment, { timeout: 1000 })));
    expect(singleResult).toStrictEqual(fixture.expected_problems);
    expect(JSON.parse(await single.downloads[0].text())).toStrictEqual(fixture.expected_problems);
  });

  it("single-contest export rejects an empty page without downloading", async () => {
    const emptySingle = await browserEnvironment(failedPages[0]);
    await expect(vm.runInNewContext(singleSource, emptySingle.environment, { timeout: 1000 })).rejects.toThrow(/未解析到题目/u);
    expect(emptySingle.downloads).toHaveLength(0);
  });

  it("single-contest export rejects links to a different contest version without downloading", async () => {
    const wrongVersion = await browserEnvironment({
      ...fixture,
      rows: [{ ...fixture.rows[0], href: "/contest/900001/problem/900011?v=2" }],
    });
    await expect(vm.runInNewContext(singleSource, wrongVersion.environment, { timeout: 1000 })).rejects.toThrow(/版本/u);
    expect(wrongVersion.downloads).toHaveLength(0);
  });
});

describe("QOJ contest curation importer", () => {
  let tempDir: string;
  let catalogPath: string;
  let inputPath: string;
  let saved: string;
  const rawPath = resolve(repoRoot, "fixtures/imports/qoj/2026-xcpc-browser-export.json");
  const reviewedPath = resolve(repoRoot, "fixtures/imports/qoj/2026-xcpc-problem-lists.json");
  let reviewed: any[];

  const runImport = (input: string, ...flags: string[]) => spawnSync(process.execPath, [
    resolve(repoRoot, "scripts/import-qoj-problems-export.mjs"), input, catalogPath, catalogPath, ...flags,
  ], { cwd: repoRoot, encoding: "utf8", timeout: 10000 });
  const successfulImport = (input: string, ...flags: string[]) => {
    const result = runImport(input, ...flags);
    expect(result.status, result.stderr || result.error?.message).toBe(0);
    return JSON.parse(result.stdout);
  };

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "xcpc-qoj-contest-tools-"));
    catalogPath = join(tempDir, "catalog.json");
    inputPath = join(tempDir, "input.json");
    reviewed = JSON.parse(await readFile(reviewedPath, "utf8"));
    await writeFile(catalogPath, JSON.stringify({
      schemaVersion: 1, exportKind: "local_catalog_snapshot", version: "0.6.0",
      exportedAt: "2026-09-08T00:00:00.000Z", contests: [], problems: [],
    }));
  });
  afterAll(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it("keeps raw browser exports as drafts", async () => {
    const unreviewedResult = successfulImport(rawPath);
    expect(unreviewedResult.insertedContestCount).toBe(0);
    expect(unreviewedResult.skippedContestCount).toBe(5);
    expect(unreviewedResult.emptyInputContestCount).toBe(3);
    expect(JSON.parse(await readFile(catalogPath, "utf8")).contests).toHaveLength(0);
  });

  it("creates 8 contests/103 problems from explicit reviewed targets", async () => {
    const raw = JSON.parse(await readFile(rawPath, "utf8"));
    const retry = JSON.parse(await readFile(resolve(repoRoot, "fixtures/imports/qoj/2026-xcpc-browser-retry-export.json"), "utf8"));
    const successfulRaw = [...raw.filter((entry: any) => entry.problems.length), ...retry];
    const inserted = successfulImport(reviewedPath);
    expect(inserted.insertedContestCount).toBe(8);
    expect(inserted.insertedProblemCount).toBe(103);
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    expect(catalog.contests).toHaveLength(8);
    expect(catalog.problems).toHaveLength(103);
    for (const entry of reviewed) {
      expect(entry.problems).toStrictEqual(successfulRaw.find((candidate: any) => candidate.url === entry.url).problems);
      const contest = catalog.contests.find((candidate: any) => candidate.contestId === entry.target_contest.contest_id);
      expect(contest.title).toBe(entry.target_contest.title);
      expect(contest.curationStatus).toBe("problem_listed");
      expect(contest.problemIds).toHaveLength(entry.problems.length);
      expect(contest.sources).toStrictEqual(entry.target_contest.sources);
      for (const inputProblem of entry.problems) {
        const problem = catalog.problems.find((candidate: any) => candidate.contestId === contest.contestId && candidate.ordinal === inputProblem.ordinal);
        expect(problem.title).toBe(inputProblem.title);
        expect(problem.sources[0].provider_problem_id).toBe(inputProblem.provider_problem_id);
        expect(problem.sources[0].url).toBe(inputProblem.url);
      }
    }
    saved = await readFile(catalogPath, "utf8");
  });

  it("repeat imports are stable", async () => {
    expect(successfulImport(reviewedPath, "--check").changed).toBe(false);
    expect(await readFile(catalogPath, "utf8")).toBe(saved);
  });

  const rejected: [string, (r: any[]) => any, RegExp][] = [
    ["empty problems", (r) => ({ ...r[0], problems: [] }), /non-empty/u],
    ["error entry", (r) => ({ ...r[0], error: "incomplete response" }), /successful/u],
    ["duplicate problems", (r) => ({ ...r[0], problems: [r[0].problems[0], r[0].problems[0]] }), /duplicates/u],
    ["versioned target URL", (r) => { const e = structuredClone(r[0]); e.target_contest.sources[0].url += "?v=1"; return e; }, /complete import URL/u],
    ["different problem version", (r) => { const e = structuredClone(r[0]); e.problems[0].url += "?v=2"; return e; }, /different QOJ version/u],
    ["reused contest ID", (r) => { const e = structuredClone(r[0]); e.target_contest.contest_id = r[1].target_contest.contest_id; return e; }, /another curated contest|different QOJ URL/u],
    ["conflicting title", (r) => { const e = structuredClone(r[0]); e.problems[0].title = "Different unreviewed problem"; return e; }, /complete reviewed ordinal\/title match/u],
    ["partial mirror", (r) => { const e = structuredClone(r[0]); e.problems.pop(); return e; }, /complete reviewed ordinal\/title match/u],
    ["duplicate URL under new ID", (r) => { const e = structuredClone(r[0]); e.target_contest.contest_id = "different-curated-id"; return e; }, /another curated contest/u],
  ];
  it.each(rejected)("rejects %s without writing partial changes", async (_name, build, message) => {
    await writeFile(inputPath, JSON.stringify([build(reviewed)]));
    const result = runImport(inputPath);
    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stderr).toMatch(message);
    expect(await readFile(catalogPath, "utf8"), "failed import must not write partial data").toBe(saved);
  });

  it("--check on a raw export with empty contests fails without writing", async () => {
    const emptyCheck = runImport(rawPath, "--check");
    expect(emptyCheck.status).toBe(1);
    expect(JSON.parse(emptyCheck.stdout).emptyInputContestCount).toBe(3);
    expect(await readFile(catalogPath, "utf8")).toBe(saved);
  });
});
