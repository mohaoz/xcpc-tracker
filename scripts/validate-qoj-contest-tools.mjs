import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(await readFile(resolve(repoRoot, "fixtures/imports/qoj/contest-export-regression.json"), "utf8"));

function makePage(page) {
  const rows = (page.rows ?? []).map((row) => {
    const cells = [{ textContent: row.ordinal }, { textContent: row.title }];
    const anchor = {
      href: new URL(row.href, page.url).toString(),
      textContent: row.title,
      getAttribute: () => row.href,
      closest: () => ({ previousElementSibling: cells[0] }),
    };
    return {
      querySelectorAll: (selector) => selector === "td" ? cells : [anchor],
    };
  });
  return {
    title: `${page.title} - QOJ.ac`,
    querySelector: (selector) => selector === "h1" ? { textContent: page.title } : null,
    querySelectorAll: (selector) => selector === "tr" ? rows : [],
  };
}

async function browserEnvironment(current, pages = [current]) {
  const page = makePage(current);
  const downloads = [];
  const requests = [];
  const logs = [];
  let clipboard = "";
  const entries = pages.map(({ title, url }) => ({ title, url }));
  const environment = {
    URL: class extends URL {
      static createObjectURL(blob) {
        downloads.push(blob);
        return "blob:fixture";
      }
      static revokeObjectURL() {}
    },
    Blob,
    location: new URL(current.url),
    navigator: { clipboard: { writeText: async (text) => { clipboard = text; } } },
    console: { log: (...items) => logs.push(items), warn: (...items) => logs.push(items) },
    document: {
      ...page,
      body: { appendChild() {} },
      createElement(tag) {
        if (tag !== "input") return { click() {} };
        let onChange;
        return {
          style: {},
          files: [{ text: async () => JSON.stringify(entries) }],
          addEventListener: (_, callback) => { onChange = callback; },
          click: () => { queueMicrotask(onChange); },
          remove() {},
        };
      },
    },
    DOMParser: class {
      parseFromString(text) { return makePage(JSON.parse(text)); }
    },
    fetch: async (url, options) => {
      requests.push(url);
      assert.equal(options.credentials, "include");
      const response = pages.find((candidate) => candidate.url === url);
      assert(response, `unexpected request: ${url}`);
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
const batch = await browserEnvironment(fixture, [fixture, ...failedPages]);
const result = JSON.parse(JSON.stringify(await vm.runInNewContext(batchSource, batch.environment, { timeout: 1000 })));
assert.equal(result.length, 5);
assert.deepEqual(result[0].problems, fixture.expected_problems);
assert.equal(result[0].fetched_url, fixture.url);
assert.equal(result[0].source_title, fixture.title);
assert(result[1].error.includes("未解析到题目"));
assert(result[2].error.includes("跳转"));
assert(result[3].error.includes("版本"));
assert(result[4].error.includes("403"));
assert.deepEqual(batch.requests, [fixture, ...failedPages].map((page) => page.url));
assert.deepEqual(JSON.parse(batch.getClipboard()), result);
assert.equal(batch.downloads.length, 1);
assert.deepEqual(JSON.parse(await batch.downloads[0].text()), result);
assert(batch.logs.some((items) => items[0]?.success_count === 1 && items[0]?.failed_count === 4));

const single = await browserEnvironment(fixture);
const singleResult = JSON.parse(JSON.stringify(await vm.runInNewContext(singleSource, single.environment, { timeout: 1000 })));
assert.deepEqual(singleResult, fixture.expected_problems);
assert.deepEqual(JSON.parse(await single.downloads[0].text()), fixture.expected_problems);

const emptySingle = await browserEnvironment(failedPages[0]);
await assert.rejects(vm.runInNewContext(singleSource, emptySingle.environment, { timeout: 1000 }), /未解析到题目/u);
assert.equal(emptySingle.downloads.length, 0);

const wrongVersion = await browserEnvironment({
  ...fixture,
  rows: [{ ...fixture.rows[0], href: "/contest/900001/problem/900011?v=2" }],
});
await assert.rejects(vm.runInNewContext(singleSource, wrongVersion.environment, { timeout: 1000 }), /版本/u);
assert.equal(wrongVersion.downloads.length, 0);

console.log("QOJ contest exports passed: versioned/relative links, unrelated contests, empty results, login redirects, version loss, HTTP errors, and download payloads.");

const tempDir = await mkdtemp(join(tmpdir(), "xcpc-qoj-contest-tools-"));
try {
  const catalogPath = join(tempDir, "catalog.json");
  const inputPath = join(tempDir, "input.json");
  const emptyCatalog = {
    schemaVersion: 1, exportKind: "local_catalog_snapshot", version: "0.6.0",
    exportedAt: "2026-09-08T00:00:00.000Z", contests: [], problems: [],
  };
  const rawPath = resolve(repoRoot, "fixtures/imports/qoj/2026-xcpc-browser-export.json");
  const reviewedPath = resolve(repoRoot, "fixtures/imports/qoj/2026-xcpc-problem-lists.json");
  const raw = JSON.parse(await readFile(rawPath, "utf8"));
  const reviewed = JSON.parse(await readFile(reviewedPath, "utf8"));
  const retry = JSON.parse(await readFile(resolve(repoRoot, "fixtures/imports/qoj/2026-xcpc-browser-retry-export.json"), "utf8"));
  const successfulRaw = [...raw.filter((entry) => entry.problems.length), ...retry];
  const runImport = (input, ...flags) => spawnSync(process.execPath, [
    resolve(repoRoot, "scripts/import-qoj-problems-export.mjs"), input, catalogPath, catalogPath, ...flags,
  ], { encoding: "utf8", timeout: 10000 });
  const successfulImport = (input, ...flags) => {
    const result = runImport(input, ...flags);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return JSON.parse(result.stdout);
  };
  await writeFile(catalogPath, JSON.stringify(emptyCatalog));
  const unreviewedResult = successfulImport(rawPath);
  assert.equal(unreviewedResult.insertedContestCount, 0);
  assert.equal(unreviewedResult.skippedContestCount, 5);
  assert.equal(unreviewedResult.emptyInputContestCount, 3);
  assert.equal(JSON.parse(await readFile(catalogPath, "utf8")).contests.length, 0);

  const inserted = successfulImport(reviewedPath);
  assert.equal(inserted.insertedContestCount, 8);
  assert.equal(inserted.insertedProblemCount, 103);
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  assert.equal(catalog.contests.length, 8);
  assert.equal(catalog.problems.length, 103);
  for (const entry of reviewed) {
    assert.deepEqual(entry.problems, successfulRaw.find((candidate) => candidate.url === entry.url).problems);
    const contest = catalog.contests.find((candidate) => candidate.contestId === entry.target_contest.contest_id);
    assert.equal(contest.title, entry.target_contest.title);
    assert.equal(contest.curationStatus, "problem_listed");
    assert.equal(contest.problemIds.length, entry.problems.length);
    assert.deepEqual(contest.sources, entry.target_contest.sources);
    for (const inputProblem of entry.problems) {
      const problem = catalog.problems.find((candidate) => candidate.contestId === contest.contestId && candidate.ordinal === inputProblem.ordinal);
      assert.equal(problem.title, inputProblem.title);
      assert.equal(problem.sources[0].provider_problem_id, inputProblem.provider_problem_id);
      assert.equal(problem.sources[0].url, inputProblem.url);
    }
  }
  const saved = await readFile(catalogPath, "utf8");
  assert.equal(successfulImport(reviewedPath, "--check").changed, false);
  assert.equal(await readFile(catalogPath, "utf8"), saved);

  async function assertRejected(entry, message) {
    await writeFile(inputPath, JSON.stringify([entry]));
    const result = runImport(inputPath);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, message);
    assert.equal(await readFile(catalogPath, "utf8"), saved, "failed import must not write partial changes");
  }
  await assertRejected({ ...reviewed[0], problems: [] }, /non-empty/u);
  await assertRejected({ ...reviewed[0], error: "incomplete response" }, /successful/u);
  await assertRejected({ ...reviewed[0], problems: [reviewed[0].problems[0], reviewed[0].problems[0]] }, /duplicates/u);
  const wrongTarget = structuredClone(reviewed[0]);
  wrongTarget.target_contest.sources[0].url += "?v=1";
  await assertRejected(wrongTarget, /complete import URL/u);
  const wrongProblem = structuredClone(reviewed[0]);
  wrongProblem.problems[0].url += "?v=2";
  await assertRejected(wrongProblem, /different QOJ version/u);
  const reusedId = structuredClone(reviewed[0]);
  reusedId.target_contest.contest_id = reviewed[1].target_contest.contest_id;
  await assertRejected(reusedId, /another curated contest|different QOJ URL/u);
  const duplicateUrl = structuredClone(reviewed[0]);
  duplicateUrl.target_contest.contest_id = "different-curated-id";
  await assertRejected(duplicateUrl, /another curated contest/u);
  const emptyCheck = runImport(rawPath, "--check");
  assert.equal(emptyCheck.status, 1);
  assert.equal(JSON.parse(emptyCheck.stdout).emptyInputContestCount, 3);
  assert.equal(await readFile(catalogPath, "utf8"), saved);
  console.log("QOJ curation passed: raw exports stay drafts, explicit targets create 8 contests/103 problems, repeat imports are stable, and invalid targets/versions/empty exports never write partial data.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
