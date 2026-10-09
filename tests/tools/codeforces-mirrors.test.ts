import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "xcpc-cf-mirrors-"));
const catalogPath = join(dir, "catalog.json");
const inputPath = join(dir, "input.json");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const source = (id: string, ordinal?: string) => ({
  provider: "codeforces", kind: ordinal ? "problem" : "contest",
  url: `https://codeforces.com/gym/${id}${ordinal ? `/problem/${ordinal}` : ""}`,
  [ordinal ? "provider_problem_id" : "provider_contest_id"]: ordinal ? `${id}:${ordinal}` : id,
});
const original = {
  contests: [{ contestId: "stable", title: "Curated title", aliases: [], tags: [],
    curationStatus: "problem_listed", problemIds: ["stable:A", "stable:B"], sources: [source("100001")] }],
  problems: ["A", "B"].map((ordinal) => ({ problemId: `stable:${ordinal}`, contestId: "stable", ordinal,
    title: `Problem ${ordinal}`, aliases: [], sources: [source("100001", ordinal)] })),
};
const mirror: any = {
  title: "Official mirror", url: "https://codeforces.com/gym/100002",
  target_contest_ids: ["stable"], problems: ["A", "B"].map((ordinal) => ({ ordinal, title: `Problem ${ordinal}`,
    url: source("100002", ordinal).url, provider_problem_id: `100002:${ordinal}` })),
};
function run(input: any, check = false) {
  writeFileSync(inputPath, JSON.stringify([input]));
  return execFileSync(process.execPath, ["scripts/import-codeforces-problems-export.mjs", inputPath,
    catalogPath, catalogPath, ...(check ? ["--check"] : [])], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
}

describe("Codeforces mirrors", () => {
  let mergedBytes: string;

  it("merges an explicit complete-list mirror preserving curated title, IDs and original sources", () => {
    writeFileSync(catalogPath, JSON.stringify(original));
    run(mirror);
    mergedBytes = readFileSync(catalogPath, "utf8");
    const merged = JSON.parse(mergedBytes);
    expect(merged.contests[0].title).toBe(original.contests[0].title);
    expect(merged.contests[0].problemIds).toStrictEqual(original.contests[0].problemIds);
    expect(merged.problems.map((p: any) => p.problemId)).toStrictEqual(original.problems.map((p) => p.problemId));
    for (const p of merged.problems) {
      expect(p.sources[0]).toStrictEqual(source("100001", p.ordinal));
      expect(p.sources[1].provider_problem_id).toBe(`100002:${p.ordinal}`);
    }
  });

  it("is idempotent on --check replay", () => {
    run(mirror, true);
    expect(readFileSync(catalogPath, "utf8")).toBe(mergedBytes);
  });

  it("rejects an implicit mirror of an already-mapped catalog without writing", () => {
    const implicitMirror = structuredClone(mirror);
    delete implicitMirror.target_contest_ids;
    expect(() => run(implicitMirror)).toThrow();
    expect(readFileSync(catalogPath, "utf8")).toBe(mergedBytes);
  });

  it.each([
    ["untargeted (unrelated, not merged)", (input: any) => { delete input.target_contest_ids; }],
    ["different title", (input: any) => { input.problems[0].title = "Different task"; }],
    ["partial list", (input: any) => { input.problems.pop(); }],
    ["permuted titles", (input: any) => { [input.problems[0].title, input.problems[1].title] = [input.problems[1].title, input.problems[0].title]; }],
  ])("leaves the catalog unchanged for an invalid mirror: %s", (_name, mutate) => {
    writeFileSync(catalogPath, JSON.stringify(original));
    const before = readFileSync(catalogPath, "utf8");
    const invalid = structuredClone(mirror); mutate(invalid);
    // Without explicit targeting this URL is unrelated and must not be merged.
    if (!invalid.target_contest_ids) run(invalid);
    else expect(() => run(invalid)).toThrow();
    expect(readFileSync(catalogPath, "utf8")).toBe(before);
  });

  it("release fixture replays unchanged against the canonical catalog (--check)", () => {
    expect(() => execFileSync(process.execPath, ["scripts/import-codeforces-problems-export.mjs",
      "fixtures/imports/codeforces/2026-09-28-problem-lists.json", "--check"], { cwd: repoRoot, stdio: "pipe" })).not.toThrow();
  });
});
