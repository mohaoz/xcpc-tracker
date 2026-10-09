import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import {
  compareSource,
  discover,
  markdown,
  normalizeSource,
  safeOutput,
  SOURCE_URLS,
} from "../../scripts/discover-catalog-updates.mjs";

const fixture = JSON.parse(
  await readFile(new URL("../../fixtures/imports/catalog-discovery.example.json", import.meta.url), "utf8"),
);

let inputs: any;
let failed: Set<string>;
let calls: string[];
let catalog: any;
let original: string;

const fetcher = async (url: string) => {
  calls.push(url);
  expect(new URL(url).hostname.endsWith("qoj.ac"), "Discovery must never fetch QOJ").toBe(false);
  let provider: string, raw: any;
  if (url === SOURCE_URLS.rating) { provider = "rating"; raw = inputs.rating; }
  else if (url === SOURCE_URLS.board) { provider = "board"; raw = inputs.board; }
  else if (url === SOURCE_URLS.rankland) { provider = "rankland"; raw = { sha: inputs.rankland.revision }; }
  else if (url.includes("/git/trees/")) { provider = "rankland"; raw = inputs.rankland.tree; }
  else if (url.endsWith("/official/config.yaml")) { provider = "rankland"; raw = inputs.rankland.config; }
  else throw new Error(`Unexpected request: ${url}`);
  return {
    ok: !failed.has(provider),
    status: failed.has(provider) ? 503 : 200,
    text: async () => (typeof raw === "string" ? raw : JSON.stringify(raw)),
  };
};

/** First run plus one repeat run, the baseline for most scenarios. */
async function baseline() {
  const first = await discover({ catalog, fetcher, now: "2026-09-21T00:00:00Z" });
  const second = await discover({ catalog, fetcher, previous: first.state, now: "2026-09-22T00:00:00Z" });
  return { first, second };
}

beforeEach(() => {
  inputs = structuredClone(fixture);
  failed = new Set();
  calls = [];
  catalog = structuredClone(fixture.catalog);
  original = JSON.stringify(catalog);
});

describe("catalog discovery", () => {
  it("records first-seen entries, metadata differences and uncatalogued candidates", async () => {
    const first = await discover({ catalog, fetcher, now: "2026-09-21T00:00:00Z" });
    expect(first.report.sources.every((source: any) => source.status === "succeeded")).toBe(true);
    expect(first.report.observations.filter((item: any) => item.change === "first_seen")).toHaveLength(4);
    expect(first.report.observations.find((item: any) => item.entry.id === "example").metadata_differences).toHaveLength(1);
    expect(first.report.observations.find((item: any) => item.entry.id === "candidate").catalog_contest_ids).toHaveLength(0);
    expect(markdown(first.report)).toMatch(/首次发现不代表新举办/);
  });

  it("does not manufacture events on repeat fetch, reordering or unrelated commits", async () => {
    const { second } = await baseline();
    expect(second.report.observations.every((item: any) => item.change === null), "Repeat fetch must not manufacture new events").toBe(true);
    inputs.rankland.revision = "cccccccccccccccccccccccccccccccccccccccc";
    inputs.rating.reverse();
    const reordered = await discover({ catalog, fetcher, previous: second.state });
    expect(reordered.report.observations.every((item: any) => item.change === null), "Ordering and unrelated commit changes are not content changes").toBe(true);
  });

  it("detects content changes including pinned SRK blob changes", async () => {
    const { second } = await baseline();
    inputs.rankland.revision = "cccccccccccccccccccccccccccccccccccccccc";
    inputs.rating.reverse();
    inputs.rating.find((row: any) => row.contestSlug === "example").problemRating = 1800;
    inputs.rankland.tree.tree[0].sha = "dddddddddddddddddddddddddddddddddddddddd";
    const changed = await discover({ catalog, fetcher, previous: second.state });
    expect(changed.report.observations.filter((item: any) => item.change === "changed")).toHaveLength(2);
  });

  it("retains the last successful snapshot on failure or empty source", async () => {
    const { second } = await baseline();
    inputs.rating.find((row: any) => row.contestSlug === "example").problemRating = 1800;
    inputs.rankland.tree.tree[0].sha = "dddddddddddddddddddddddddddddddddddddddd";
    const changed = await discover({ catalog, fetcher, previous: second.state });
    failed.add("rating");
    const partial = await discover({ catalog, fetcher, previous: changed.state });
    expect(partial.state.sources.rating).toStrictEqual(changed.state.sources.rating);
    expect(partial.report.observations.filter((item: any) => item.provider === "rating").every((item: any) => item.stale && item.change === null)).toBe(true);
    failed.clear();
    inputs.rating = [];
    const empty = await discover({ catalog, fetcher, previous: changed.state });
    expect(empty.report.sources.find((source: any) => source.provider === "rating").status).toBe("failed");
    expect(empty.state.sources.rating).toStrictEqual(changed.state.sources.rating);
  });

  it("tracks missing upstream entries and their reappearance", async () => {
    const { second } = await baseline();
    inputs.rating = inputs.rating.filter((row: any) => row.contestSlug !== "candidate");
    const missing = await discover({ catalog, fetcher, previous: second.state });
    expect(missing.report.observations.find((item: any) => item.entry.id === "candidate").change).toBe("missing_upstream");
    expect(missing.state.sources.rating.history.candidate.present).toBe(false);
    inputs = structuredClone(fixture);
    const back = await discover({ catalog, fetcher, previous: missing.state });
    expect(back.report.observations.find((item: any) => item.entry.id === "candidate").change).toBe("reappeared");
  });

  it("replays offline without requests and preserves the successful cache", async () => {
    const { second } = await baseline();
    calls = [];
    const replay = await discover({ catalog, fetcher, previous: second.state, offline: true });
    expect(calls).toHaveLength(0);
    expect(replay.report.sources.every((source: any) => source.status === "offline")).toBe(true);
    expect(replay.state, "Offline replay must preserve observed timestamps and the successful cache").toStrictEqual(second.state);
  });

  it("rejects malformed sources", () => {
    expect(() => normalizeSource("rating", [fixture.rating[0], fixture.rating[0]])).toThrow(/Duplicate/);
    expect(() => normalizeSource("rankland", { ...fixture.rankland, tree: { ...fixture.rankland.tree, truncated: true } })).toThrow(/truncated/);
    expect(() => normalizeSource("board", { x: { board_link: "//evil.test", config: { contest_name: "bad" } } })).toThrow(/Unsafe/);
    expect(() => normalizeSource("rating", [{ ...fixture.rating[0], problemRating: -1 }])).toThrow(/Invalid/);
  });

  it("keeps hostile keys as plain own properties", () => {
    const hostile = compareSource("rating", [{ id: "__proto__", title: "Prototype key" }], undefined, "2026-09-21");
    expect(Object.hasOwn(hostile.history, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(hostile.history)).toBe(Object.prototype);
  });

  it("never mutates the catalog", async () => {
    const { second } = await baseline();
    inputs.rating.find((row: any) => row.contestSlug === "example").problemRating = 1800;
    failed.add("rating");
    await discover({ catalog, fetcher, previous: second.state });
    await discover({ catalog, fetcher, previous: second.state, offline: true });
    expect(JSON.stringify(catalog), "Discovery must never mutate the catalog").toBe(original);
  });

  it("refuses to write outputs into catalog, public assets or .git", async () => {
    for (const target of ["catalog/new.json", "web/public/candidates.json", ".git/discovery.json"]) {
      await expect(safeOutput(target)).rejects.toThrow(/cannot write/);
    }
  });
});
