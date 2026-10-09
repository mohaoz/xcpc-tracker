import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Offline CLI cases for scripts/import-codeforces-problems-export.mjs: rejected
// imports must preserve input/output bytes, accepted imports must replay unchanged.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const importer = join(repoRoot, "scripts/import-codeforces-problems-export.mjs");
const directory = mkdtempSync(join(tmpdir(), "xcpc-cf-import-safety-"));
const catalogPath = join(directory, "catalog.json");
const inputPath = join(directory, "input.json");
const outputPath = join(directory, "output.json");
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const clone = structuredClone;
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const readJSON = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function source(id: string, ordinal: string | null, title?: string) {
  return {
    provider: "codeforces", kind: ordinal ? "problem" : "contest",
    url: `https://codeforces.com/gym/${id}${ordinal ? `/problem/${ordinal}` : ""}`,
    [ordinal ? "provider_problem_id" : "provider_contest_id"]: ordinal ? `${id}:${ordinal}` : id,
    source_title: title, label: ordinal ? `Codeforces ${ordinal}` : "Codeforces Gym",
  };
}

function base(): any {
  return {
    exportedAt: "2026-10-02T00:00:00.000Z",
    contests: [{ contestId: "stable", title: "Curated contest", aliases: [], tags: [],
      curationStatus: "problem_listed", problemIds: ["stable:A", "stable:B"],
      sources: [source("100001", null, "Curated contest")] }],
    problems: ["A", "B"].map((ordinal) => ({ problemId: `stable:${ordinal}`, contestId: "stable",
      ordinal, title: `Task ${ordinal}`, aliases: [] as string[], sources: [source("100001", ordinal, `Task ${ordinal}`)] })),
  };
}

function input(id = "100001", targets?: string[]): any[] {
  return [{ title: "Curated contest", url: `https://codeforces.com/gym/${id}`,
    ...(targets ? { target_contest_ids: targets } : {}),
    problems: ["A", "B"].map((ordinal) => ({ ordinal, title: `Task ${ordinal}`,
      url: source(id, ordinal).url, provider_problem_id: `${id}:${ordinal}` })) }];
}

function execute(payload: unknown, check = false, output = catalogPath) {
  writeFileSync(inputPath, json(payload));
  return spawnSync(process.execPath, [importer, inputPath, catalogPath, output, ...(check ? ["--check"] : [])],
    { cwd: repoRoot, encoding: "utf8", timeout: 20_000 });
}

function reject(name: string, catalog: unknown, payload: unknown) {
  const before = json(catalog);
  writeFileSync(catalogPath, before);
  // A failed import must preserve both the source catalog and a distinct output.
  writeFileSync(outputPath, "previous successful output\n");
  const result = execute(payload, false, outputPath);
  expect(result.error, `${name}: ${result.error}`).toBeUndefined();
  expect(result.status, `${name}: unexpectedly accepted\n${result.stdout}`).not.toBe(0);
  expect(readFileSync(catalogPath, "utf8"), `${name}: changed input catalog`).toBe(before);
  expect(readFileSync(outputPath, "utf8"), `${name}: replaced prior output`).toBe("previous successful output\n");
  expect(readdirSync(directory).some((path) => path.endsWith(".tmp")), `${name}: leaked temporary file`).toBe(false);
}

function accept(name: string, catalog: unknown, payload: unknown, verify: (catalog: any) => void = () => {}, unchanged = false) {
  const before = json(catalog);
  writeFileSync(catalogPath, before);
  const result = execute(payload);
  expect(result.status, `${name}: ${result.stderr}`).toBe(0);
  const after = readFileSync(catalogPath, "utf8");
  if (unchanged) expect(after, `${name}: replay changed bytes`).toBe(before);
  verify(JSON.parse(after));
  const replay = execute(payload, true);
  expect(replay.status, `${name}: check replay failed\n${replay.stderr}\n${replay.stdout}`).toBe(0);
  expect(JSON.parse(replay.stdout).changed, `${name}: replay was not idempotent`).toBe(false);
  expect(readFileSync(catalogPath, "utf8")).toBe(after);
}

function sharedCatalog() {
  const shared = base();
  const other = clone(shared.contests[0]); other.contestId = "other"; other.problemIds = ["other:A", "other:B"];
  shared.contests.push(other);
  shared.problems.push(...clone(shared.problems).map((problem: any) => ({ ...problem,
    contestId: "other", problemId: `other:${problem.ordinal}` })));
  return shared;
}

describe("CF importer safety: identity rejection", () => {
  it.each([true, false])("rejects wrong titles, permutations and partial lists (existing provider mapping: %s)", (mapped) => {
    const catalog = base();
    if (!mapped) catalog.problems.forEach((problem: any) => { problem.sources = []; });
    const wrongTitle = input();
    wrongTitle[0].problems[0].title = "An unrelated task";
    reject(`${mapped ? "provider ID" : "ordinal"} cannot authorize a wrong-title alias`, catalog, wrongTitle);
    const permuted = input();
    [permuted[0].problems[0].title, permuted[0].problems[1].title] =
      [permuted[0].problems[1].title, permuted[0].problems[0].title];
    reject("coherent full-list title permutation", catalog, permuted);
    const partial = input(); partial[0].problems.pop();
    reject("partial existing or first mapping", catalog, partial);
  });

  it.each([[[]], [null], [undefined]])("rejects an empty or missing list (%j), including after a valid list", (problems) => {
    const payload = input(); payload[0].problems = problems;
    reject("empty or missing list", base(), payload);
    reject("empty list after a valid list is not silently filtered", base(), [...input("100002", ["stable"]), ...payload]);
  });

  it("rejects an empty export and duplicate incoming contests", () => {
    reject("empty export", base(), []);
    reject("duplicate incoming contest", base(), [...input(), ...input()]);
  });

  it.each([false, true])("rejects duplicate provider ownership (reversed catalog order: %s)", (reverse) => {
    const duplicate = base();
    duplicate.problems[1].sources.push(source("100001", "A", "Task A"));
    if (reverse) duplicate.problems.reverse();
    reject("duplicate provider ownership in either catalog order", duplicate, input());
  });

  it("rejects ambiguous ordinals, ambiguous titles and stale source URLs", () => {
    const ambiguousOrdinal = base();
    ambiguousOrdinal.problems.forEach((problem: any) => { problem.sources = []; problem.ordinal = "A"; });
    reject("duplicate canonical ordinal", ambiguousOrdinal, input());
    const ambiguousTitle = base(); ambiguousTitle.problems[1].aliases.push("Task A");
    reject("ambiguous title ownership", ambiguousTitle, input());
    const staleSource = base(); staleSource.problems[0].sources[0].url = source("100001", "Z").url;
    reject("catalog source URL disagrees with its provider ID", staleSource, input());
  });

  it("rejects a late conflict atomically, preserving all earlier changes", () => {
    const late = input("100002", ["stable"]); late[0].problems[0].title = "Wrong task";
    reject("late conflict preserves all earlier changes", base(), [...input(), ...late]);
  });
});

describe("CF importer safety: shared sources", () => {
  it.each([false, true])("rejects implicit or incomplete shared ownership (reversed: %s)", (reverse) => {
    const catalog = clone(sharedCatalog());
    if (reverse) catalog.problems.reverse();
    reject("implicit shared source ownership", catalog, input());
    reject("explicit target omits another existing owner", catalog, input("100001", ["stable"]));
  });

  it("accepts explicit complete shared contests", () => {
    accept("explicit complete shared contests", sharedCatalog(), input("100001", ["stable", "other"]), (catalog) => {
      expect(catalog.problems).toHaveLength(4);
      for (const ordinal of ["A", "B"]) expect(catalog.problems.filter((problem: any) =>
        problem.sources.some((entry: any) => entry.provider_problem_id === `100001:${ordinal}`)).length).toBe(2);
    });
  });

  it("requires full identity agreement for explicit sharing", () => {
    const unrelated = clone(sharedCatalog());
    unrelated.problems.find((problem: any) => problem.problemId === "other:A").title = "Different task";
    reject("explicit sharing still requires full identity agreement", unrelated, input("100001", ["stable", "other"]));
  });

  it("accepts explicit shared first mappings", () => {
    const firstShared = clone(sharedCatalog()); firstShared.problems.forEach((problem: any) => { problem.sources = []; });
    accept("explicit shared first mappings", firstShared, input("100001", ["stable", "other"]));
  });
});

describe("CF importer safety: accepted idempotent imports", () => {
  it("replays exact input, incoming row order and existing source order unchanged", () => {
    accept("exact replay", base(), input(), undefined, true);
    const reversed = input(); reversed[0].problems.reverse();
    accept("incoming row order", base(), reversed, undefined, true);
    const orderedSources = base();
    orderedSources.contests[0].sources.push({ provider: "qoj", kind: "contest", url: "https://qoj.ac/contest/999" });
    orderedSources.problems[0].sources.push({ provider: "qoj", kind: "problem", url: "https://qoj.ac/problem/999" });
    accept("existing source order", orderedSources, input(), undefined, true);
  });

  it("appends an explicit full mirror after the original source", () => {
    accept("explicit full mirror", base(), input("100002", ["stable"]), (catalog) => {
      expect(catalog.problems.map((problem: any) => problem.problemId)).toStrictEqual(["stable:A", "stable:B"]);
      for (const problem of catalog.problems) {
        expect(problem.sources[0]).toStrictEqual(source("100001", problem.ordinal, problem.title));
        expect(problem.sources[1].provider_problem_id).toBe(`100002:${problem.ordinal}`);
        expect(problem.aliases).toStrictEqual([]);
      }
    });
  });

  it("accepts a known alternate title without replacing the primary title", () => {
    const aliasCatalog = base(); aliasCatalog.problems[0].aliases.push("Reviewed alternate title");
    const aliasInput = input(); aliasInput[0].problems[0].title = "Reviewed alternate title";
    accept("known alternate title", aliasCatalog, aliasInput, (catalog) => expect(catalog.problems[0].title).toBe("Task A"));
  });

  it("keeps an established provider mapping that differs from the canonical ordinal", () => {
    const differentOrdinals = base();
    [differentOrdinals.problems[0].sources, differentOrdinals.problems[1].sources] =
      [differentOrdinals.problems[1].sources, differentOrdinals.problems[0].sources];
    [differentOrdinals.problems[0].title, differentOrdinals.problems[1].title] =
      [differentOrdinals.problems[1].title, differentOrdinals.problems[0].title];
    accept("established provider mapping can differ from canonical ordinal", differentOrdinals, input(), undefined, true);
  });

  it("remaps a reviewed contest by complete title identity", () => {
    const remapped = base();
    remapped.contests[0].sources = [{ provider: "qoj", kind: "contest", url: "https://qoj.ac/contest/1281", provider_contest_id: "1281" }];
    remapped.problems.forEach((problem: any) => { problem.sources = []; });
    [remapped.problems[0].title, remapped.problems[1].title] = [remapped.problems[1].title, remapped.problems[0].title];
    accept("reviewed contest remap uses complete title identity", remapped, input("104459"), (catalog) => {
      expect(catalog.problems[0].sources[0].provider_problem_id).toBe("104459:B");
      expect(catalog.problems[1].sources[0].provider_problem_id).toBe("104459:A");
    });
  });
});

describe("CF importer safety: reviewed Sichuan release list", () => {
  const catalog = readJSON(join(repoRoot, "catalog/default-catalog.min.json"));
  const fixture = readJSON(join(repoRoot, "fixtures/imports/codeforces/2026-10-02-reviewed-problem-lists.json"));
  const sichuanInput = fixture.filter((contest: any) => contest.url.endsWith("/103117"));
  const sichuanId = "8bd18c44-77b5-5f30-938a-83d2fe690a46";
  const sichuan = { contests: catalog.contests.filter((contest: any) => contest.contestId === sichuanId),
    problems: catalog.problems.filter((problem: any) => problem.contestId === sichuanId) };

  it("accepts the complete 12-source/13-canonical list unchanged", () => {
    accept("reviewed complete 12-source/13-canonical Sichuan list", sichuan, sichuanInput, (result) => {
      expect(result.problems).toHaveLength(13);
      expect(result.problems.filter((problem: any) => problem.sources.some((entry: any) =>
        entry.provider === "codeforces" && entry.provider_problem_id === "103117:C")).map((problem: any) => problem.ordinal)).toStrictEqual(["J"]);
      expect(result.problems.find((problem: any) => problem.ordinal === "C").sources.some((entry: any) => entry.provider === "codeforces")).toBe(false);
    }, true);
  });

  it("does not let a reviewed omission authorize further missing tasks", () => {
    const partialSichuan = clone(sichuanInput); partialSichuan[0].problems.pop();
    reject("reviewed omission does not authorize further missing tasks", sichuan, partialSichuan);
  });

  it.each([false, true])("rejects every old owner of a remapped source (reversed: %s)", (reverse) => {
    const duplicate = clone(sichuan);
    duplicate.problems.find((problem: any) => problem.ordinal === "C").sources.push(source("103117", "C", "Ants"));
    if (reverse) duplicate.problems.reverse();
    reject("reviewed remap rejects every old owner in either order", duplicate, sichuanInput);
  });
});
