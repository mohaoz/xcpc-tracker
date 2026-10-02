import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const importer = resolve(process.argv[2] ?? join(repoRoot, "scripts/import-codeforces-problems-export.mjs"));
const directory = mkdtempSync(join(tmpdir(), "xcpc-cf-import-safety-"));
const catalogPath = join(directory, "catalog.json");
const inputPath = join(directory, "input.json");
const outputPath = join(directory, "output.json");
const clone = structuredClone;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));
let cases = 0;

function source(id, ordinal, title) {
  return {
    provider: "codeforces", kind: ordinal ? "problem" : "contest",
    url: `https://codeforces.com/gym/${id}${ordinal ? `/problem/${ordinal}` : ""}`,
    [ordinal ? "provider_problem_id" : "provider_contest_id"]: ordinal ? `${id}:${ordinal}` : id,
    source_title: title, label: ordinal ? `Codeforces ${ordinal}` : "Codeforces Gym",
  };
}

function base() {
  return {
    exportedAt: "2026-10-02T00:00:00.000Z",
    contests: [{ contestId: "stable", title: "Curated contest", aliases: [], tags: [],
      curationStatus: "problem_listed", problemIds: ["stable:A", "stable:B"],
      sources: [source("100001", null, "Curated contest")] }],
    problems: ["A", "B"].map((ordinal) => ({ problemId: `stable:${ordinal}`, contestId: "stable",
      ordinal, title: `Task ${ordinal}`, aliases: [], sources: [source("100001", ordinal, `Task ${ordinal}`)] })),
  };
}

function input(id = "100001", targets) {
  return [{ title: "Curated contest", url: `https://codeforces.com/gym/${id}`,
    ...(targets ? { target_contest_ids: targets } : {}),
    problems: ["A", "B"].map((ordinal) => ({ ordinal, title: `Task ${ordinal}`,
      url: source(id, ordinal).url, provider_problem_id: `${id}:${ordinal}` })) }];
}

function execute(payload, check = false, output = catalogPath) {
  writeFileSync(inputPath, json(payload));
  return spawnSync(process.execPath, [importer, inputPath, catalogPath, output, ...(check ? ["--check"] : [])],
    { cwd: repoRoot, encoding: "utf8", timeout: 20_000 });
}

function reject(name, catalog, payload) {
  const before = json(catalog);
  writeFileSync(catalogPath, before);
  // A failed import must preserve both the source catalog and a distinct output.
  writeFileSync(outputPath, "previous successful output\n");
  const result = execute(payload, false, outputPath);
  assert.equal(result.error, undefined, `${name}: ${result.error}`);
  assert.notEqual(result.status, 0, `${name}: unexpectedly accepted\n${result.stdout}`);
  assert.equal(readFileSync(catalogPath, "utf8"), before, `${name}: changed input catalog`);
  assert.equal(readFileSync(outputPath, "utf8"), "previous successful output\n", `${name}: replaced prior output`);
  assert.ok(!readdirSync(directory).some((path) => path.endsWith(".tmp")), `${name}: leaked temporary file`);
  cases += 1;
}

function accept(name, catalog, payload, verify = () => {}, unchanged = false) {
  const before = json(catalog);
  writeFileSync(catalogPath, before);
  const result = execute(payload);
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  const after = readFileSync(catalogPath, "utf8");
  if (unchanged) assert.equal(after, before, `${name}: replay changed bytes`);
  verify(JSON.parse(after));
  const replay = execute(payload, true);
  assert.equal(replay.status, 0, `${name}: check replay failed\n${replay.stderr}\n${replay.stdout}`);
  assert.equal(JSON.parse(replay.stdout).changed, false, `${name}: replay was not idempotent`);
  assert.equal(readFileSync(catalogPath, "utf8"), after);
  cases += 1;
}

try {
  for (const mapped of [true, false]) {
    const catalog = base();
    if (!mapped) catalog.problems.forEach((problem) => { problem.sources = []; });
    const wrongTitle = input();
    wrongTitle[0].problems[0].title = "An unrelated task";
    reject(`${mapped ? "provider ID" : "ordinal"} cannot authorize a wrong-title alias`, catalog, wrongTitle);
    const permuted = input();
    [permuted[0].problems[0].title, permuted[0].problems[1].title] =
      [permuted[0].problems[1].title, permuted[0].problems[0].title];
    reject("coherent full-list title permutation", catalog, permuted);
    const partial = input(); partial[0].problems.pop();
    reject("partial existing or first mapping", catalog, partial);
  }
  for (const problems of [[], null, undefined]) {
    const payload = input(); payload[0].problems = problems;
    reject("empty or missing list", base(), payload);
    reject("empty list after a valid list is not silently filtered", base(), [...input("100002", ["stable"]), ...payload]);
  }
  reject("empty export", base(), []);
  reject("duplicate incoming contest", base(), [...input(), ...input()]);

  for (const reverse of [false, true]) {
    const duplicate = base();
    duplicate.problems[1].sources.push(source("100001", "A", "Task A"));
    if (reverse) duplicate.problems.reverse();
    reject("duplicate provider ownership in either catalog order", duplicate, input());
  }
  const ambiguousOrdinal = base();
  ambiguousOrdinal.problems.forEach((problem) => { problem.sources = []; problem.ordinal = "A"; });
  reject("duplicate canonical ordinal", ambiguousOrdinal, input());
  const ambiguousTitle = base(); ambiguousTitle.problems[1].aliases.push("Task A");
  reject("ambiguous title ownership", ambiguousTitle, input());
  const staleSource = base(); staleSource.problems[0].sources[0].url = source("100001", "Z").url;
  reject("catalog source URL disagrees with its provider ID", staleSource, input());

  const shared = base();
  const other = clone(shared.contests[0]); other.contestId = "other"; other.problemIds = ["other:A", "other:B"];
  shared.contests.push(other);
  shared.problems.push(...clone(shared.problems).map((problem) => ({ ...problem,
    contestId: "other", problemId: `other:${problem.ordinal}` })));
  for (const reverse of [false, true]) {
    const catalog = clone(shared);
    if (reverse) catalog.problems.reverse();
    reject("implicit shared source ownership", catalog, input());
    reject("explicit target omits another existing owner", catalog, input("100001", ["stable"]));
  }
  accept("explicit complete shared contests", shared, input("100001", ["stable", "other"]), (catalog) => {
    assert.equal(catalog.problems.length, 4);
    for (const ordinal of ["A", "B"]) assert.equal(catalog.problems.filter((problem) =>
      problem.sources.some((entry) => entry.provider_problem_id === `100001:${ordinal}`)).length, 2);
  });
  const unrelated = clone(shared); unrelated.problems.find((problem) => problem.problemId === "other:A").title = "Different task";
  reject("explicit sharing still requires full identity agreement", unrelated, input("100001", ["stable", "other"]));
  const firstShared = clone(shared); firstShared.problems.forEach((problem) => { problem.sources = []; });
  accept("explicit shared first mappings", firstShared, input("100001", ["stable", "other"]));

  accept("exact replay", base(), input(), undefined, true);
  const reversed = input(); reversed[0].problems.reverse();
  accept("incoming row order", base(), reversed, undefined, true);
  const orderedSources = base();
  orderedSources.contests[0].sources.push({ provider: "qoj", kind: "contest", url: "https://qoj.ac/contest/999" });
  orderedSources.problems[0].sources.push({ provider: "qoj", kind: "problem", url: "https://qoj.ac/problem/999" });
  accept("existing source order", orderedSources, input(), undefined, true);
  accept("explicit full mirror", base(), input("100002", ["stable"]), (catalog) => {
    assert.deepEqual(catalog.problems.map((problem) => problem.problemId), ["stable:A", "stable:B"]);
    for (const problem of catalog.problems) {
      assert.deepEqual(problem.sources[0], source("100001", problem.ordinal, problem.title));
      assert.equal(problem.sources[1].provider_problem_id, `100002:${problem.ordinal}`);
      assert.deepEqual(problem.aliases, []);
    }
  });
  const aliasCatalog = base(); aliasCatalog.problems[0].aliases.push("Reviewed alternate title");
  const aliasInput = input(); aliasInput[0].problems[0].title = "Reviewed alternate title";
  accept("known alternate title", aliasCatalog, aliasInput, (catalog) => assert.equal(catalog.problems[0].title, "Task A"));
  const differentOrdinals = base();
  [differentOrdinals.problems[0].sources, differentOrdinals.problems[1].sources] =
    [differentOrdinals.problems[1].sources, differentOrdinals.problems[0].sources];
  [differentOrdinals.problems[0].title, differentOrdinals.problems[1].title] =
    [differentOrdinals.problems[1].title, differentOrdinals.problems[0].title];
  accept("established provider mapping can differ from canonical ordinal", differentOrdinals, input(), undefined, true);

  const remapped = base();
  remapped.contests[0].sources = [{ provider: "qoj", kind: "contest", url: "https://qoj.ac/contest/1281", provider_contest_id: "1281" }];
  remapped.problems.forEach((problem) => { problem.sources = []; });
  [remapped.problems[0].title, remapped.problems[1].title] = [remapped.problems[1].title, remapped.problems[0].title];
  accept("reviewed contest remap uses complete title identity", remapped, input("104459"), (catalog) => {
    assert.equal(catalog.problems[0].sources[0].provider_problem_id, "104459:B");
    assert.equal(catalog.problems[1].sources[0].provider_problem_id, "104459:A");
  });
  const late = input("100002", ["stable"]); late[0].problems[0].title = "Wrong task";
  reject("late conflict preserves all earlier changes", base(), [...input(), ...late]);

  const catalog = readJSON(join(repoRoot, "catalog/default-catalog.min.json"));
  const fixture = readJSON(join(repoRoot, "fixtures/imports/codeforces/2026-10-02-reviewed-problem-lists.json"));
  const sichuanInput = fixture.filter((contest) => contest.url.endsWith("/103117"));
  const sichuanId = "8bd18c44-77b5-5f30-938a-83d2fe690a46";
  const sichuan = { contests: catalog.contests.filter((contest) => contest.contestId === sichuanId),
    problems: catalog.problems.filter((problem) => problem.contestId === sichuanId) };
  accept("reviewed complete 12-source/13-canonical Sichuan list", sichuan, sichuanInput, (result) => {
    assert.equal(result.problems.length, 13);
    assert.deepEqual(result.problems.filter((problem) => problem.sources.some((entry) =>
      entry.provider === "codeforces" && entry.provider_problem_id === "103117:C")).map((problem) => problem.ordinal), ["J"]);
    assert.equal(result.problems.find((problem) => problem.ordinal === "C").sources.some((entry) => entry.provider === "codeforces"), false);
  }, true);
  const partialSichuan = clone(sichuanInput); partialSichuan[0].problems.pop();
  reject("reviewed omission does not authorize further missing tasks", sichuan, partialSichuan);
  for (const reverse of [false, true]) {
    const duplicate = clone(sichuan);
    duplicate.problems.find((problem) => problem.ordinal === "C").sources.push(source("103117", "C", "Ants"));
    if (reverse) duplicate.problems.reverse();
    reject("reviewed remap rejects every old owner in either order", duplicate, sichuanInput);
  }
  console.log(`CF importer safety: ${cases} offline cases passed; rejected imports preserve input/output bytes, complete mirrors replay unchanged.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
