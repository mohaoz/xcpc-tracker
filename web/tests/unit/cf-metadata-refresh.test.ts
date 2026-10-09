import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { sha256 } from "../../../scripts/source-import-lib.mjs";
import { readRepoJson, repoPath, repoRoot } from "./helpers/repo";

const generated = vi.hoisted(() => ({ bundle: null as unknown, cached: null as any }));
vi.mock("../../src/lib/catalog", () => ({ fetchGeneratedCatalogBundle: async () => generated.bundle }));
vi.mock("../../src/lib/local-db", () => ({ refreshGeneratedCatalogSnapshot: async (value: unknown) => { generated.cached = value; } }));

import { refreshCatalogCache } from "../../src/lib/catalog-cache";

const dir = "fixtures/imports/codeforces/";
const rawBytes = readFileSync(repoPath(`${dir}2026-10-02-user-export.json`));
const raw = JSON.parse(rawBytes.toString("utf8"));
const review = readRepoJson(`${dir}2026-10-02-mapping-review.json`);
const input = readRepoJson<any[]>(`${dir}2026-10-02-reviewed-problem-lists.json`);
const catalog = readRepoJson("catalog/default-catalog.min.json");
const problems = new Map<string, any>(catalog.problems.map((p: any) => [p.problemId, p]));
const SICHUAN_ID = "8bd18c44-77b5-5f30-938a-83d2fe690a46";

const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value;

describe("CF metadata refresh (2026-10-02 user export)", () => {
  it("binds the authenticated export to its review by hash and summary", () => {
    expect(sha256(rawBytes)).toBe(review.user_export_sha256);
    expect(raw.summary).toEqual({ requested: 3, succeeded: 2, failed: 1, unattempted: 0, problems: 25 });
    expect(raw.failures).toEqual([{ id: 695551, code: "target_unavailable", stopped_batch: false }]);
    expect(input).toHaveLength(2);
    for (const contest of raw.contests) {
      expect(sha256(JSON.stringify(canonical({ contest: contest.api_contest, problems: contest.problems })))).toBe(contest.provenance.metadata_sha256);
      const reviewed = input.find((c) => c.url === contest.url);
      expect(reviewed.problems).toEqual(contest.problems.map(({ ordinal, title, url, provider_problem_id }: any) => ({ ordinal, title, url, provider_problem_id })));
    }
  });

  it("keeps original identities and the reviewed CF/QOJ sources in the catalog", () => {
    for (const row of review.mapping) {
      const problem = problems.get(row.canonical_problem_id);
      expect(problem.title).toBe(row.title);
      expect(problem.ordinal).toBe(row.original_ordinal);
      expect(problem.sources.some((s: any) => s.provider === "qoj" && s.provider_problem_id === row.qoj_problem_id)).toBe(true);
      expect(problem.sources.filter((s: any) => s.provider === "codeforces").map((s: any) => s.provider_problem_id))
        .toEqual(row.current_cf_problem_id ? [row.current_cf_problem_id] : []);
    }
    for (const after of review.after_problems) expect(problems.get(after.problemId)).toEqual(after);
    expect(problems.get(review.mapping_correction.from_problem_id).aliases).not.toContain("Ants");
    expect(catalog.contests.find((c: any) => c.contestId === SICHUAN_ID).problemIds).toHaveLength(13);
    expect(catalog.contests.some((c: any) => c.sources.some((s: any) => s.provider_contest_id === "695551"))).toBe(false);
  });

  describe("the CF importer stops atomically", () => {
    function withTempCatalog(catalogValue: unknown, inputValue: unknown) {
      const temp = mkdtempSync(join(tmpdir(), "xcpc-cf-review-"));
      const catPath = join(temp, "catalog.json");
      const inputPath = join(temp, "input.json");
      writeFileSync(catPath, JSON.stringify(catalogValue));
      writeFileSync(inputPath, JSON.stringify(inputValue));
      const invoke = () => execFileSync(process.execPath, ["scripts/import-codeforces-problems-export.mjs", inputPath, catPath, catPath], { stdio: "pipe", cwd: repoRoot });
      return { catPath, invoke, cleanup: () => rmSync(temp, { recursive: true, force: true }) };
    }

    it("on a stale ordinal association", () => {
      const stale = structuredClone(catalog);
      for (const before of review.before_problems) stale.problems[stale.problems.findIndex((p: any) => p.problemId === before.problemId)] = before;
      const { catPath, invoke, cleanup } = withTempCatalog(stale, input);
      try {
        const before = readFileSync(catPath, "utf8");
        expect(invoke).toThrow(/source correction/);
        expect(readFileSync(catPath, "utf8")).toBe(before);
      } finally { cleanup(); }
    });

    it("on a changed upstream identity", () => {
      const changed = structuredClone(input);
      changed[0].problems.find((p: any) => p.provider_problem_id === "103117:C").title = "Triangle Pendant";
      const { catPath, invoke, cleanup } = withTempCatalog(catalog, changed);
      try {
        const before = readFileSync(catPath, "utf8");
        expect(invoke).toThrow(/identity changed/);
        expect(readFileSync(catPath, "utf8")).toBe(before);
      } finally { cleanup(); }
    });
  });

  it("legacy cache refresh does not invent provider identities from ordinals", async () => {
    const sc = catalog.contests.find((c: any) => c.contestId === SICHUAN_ID);
    const detail = {
      id: sc.contestId, title: sc.title, aliases: sc.aliases, tags: sc.tags, curation_status: sc.curationStatus, sources: sc.sources,
      problems: sc.problemIds.map((id: string) => { const p = problems.get(id); return { ...p, id: p.problemId }; }),
    };
    generated.bundle = { generated_at: "test", source: "test", contest_count: 1, contests: [detail] };
    await refreshCatalogCache();
    expect(generated.cached.problems.find((p: any) => p.ordinal === "C").sources.every((s: any) => s.provider !== "codeforces")).toBe(true);
    expect(generated.cached.problems.find((p: any) => p.ordinal === "J").sources.find((s: any) => s.provider === "codeforces").provider_problem_id).toBe("103117:C");
  });

  describe("2025 Guizhou", () => {
    const gz = readRepoJson("fixtures/imports/rankland/2026-10-02-guizhou-review.json");
    const rating = readRepoJson("fixtures/imports/xcpc-rating/2026-10-02-guizhou-review.json");
    const contest = catalog.contests.find((c: any) => c.contestId === gz.contest_id);

    it("uses explicit eligibility and tie-free medal boundaries", () => {
      expect(contest.startAt).toBe(gz.startAt);
      expect(contest.problemIds).toHaveLength(13);
      expect(contest.awardCutoffs).toEqual(gz.value);
      expect(gz.teams).toHaveLength(116);
      expect(gz.teams.filter((t: any) => t.official === false)).toHaveLength(17);
      expect(gz.teams.filter((t: any) => t.official_field_absent)).toHaveLength(99);
      const eligible = gz.teams
        .filter((t: any) => t.official === true || (t.official_field_absent && t.official === null))
        .sort((a: any, b: any) => b.solved - a.solved || a.penalty - b.penalty);
      expect(eligible).toHaveLength(99);
      for (const team of gz.teams) {
        expect(team.problem_cells).toBe(13);
        expect(team.penalty_unit).toBe("min");
        expect(team.pending).toBe(0);
      }
      for (const [medal, rank] of Object.entries({ gold: 9, silver: 26, bronze: 52 })) {
        const row = eligible[rank - 1];
        const next = eligible[rank];
        expect(gz.value.cutoffs[medal]).toEqual({ rank, teamId: row.team_id, solved: row.solved, penalty: row.penalty });
        expect(!next || row.solved !== next.solved || row.penalty !== next.penalty).toBe(true);
      }
    });

    it("matches all 13 XCPC Rating values one to one", () => {
      expect(rating.matches).toHaveLength(13);
      expect(rating.values).toHaveLength(13);
      for (const row of rating.values) {
        const p = problems.get(row.problem_id);
        expect(p.title).toBe(row.title);
        expect(p.rating).toBe(row.value);
        expect(p.sources.some((s: any) => s.provider === "xcpc_rating" && s.provider_problem_id === row.source_identity)).toBe(true);
        expect(p.tags).toEqual([]);
      }
      expect(new Set(gz.correspondence.map((r: any) => r.ordinal)).size).toBe(13);
      for (const row of gz.correspondence) {
        expect(row.cf_title).toBe(row.srk_title);
        expect(row.cf_title).toBe(row.rating_title);
        expect(rating.values.some((v: any) => v.title === row.cf_title && v.value === row.problemRating)).toBe(true);
      }
    });
  });
});
