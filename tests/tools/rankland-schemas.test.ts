// Offline design-contract checks for RankLand mapping/award review files.
// Ported from the former scripts/validate-rankland-schemas.py. Never writes the catalog.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readJSON = (path: string) => JSON.parse(readFileSync(`${root}${path}`, "utf8"));
const NAMES = ["rankland-source", "rankland-review", "rankland-award-review"] as const;
const SCHEMAS = Object.fromEntries(NAMES.map((name) => [name, readJSON(`schemas/${name}.schema.json`)]));

const ajv = new (Ajv2020 as any)({ strict: false, allErrors: true });
(addFormats as any)(ajv);
for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);
const validators = Object.fromEntries(NAMES.map((name) => [name, ajv.getSchema(SCHEMAS[name].$id)]));

/** A contract violation (schema or semantic); any other error is a test bug. */
class ContractError extends Error {}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContractError(message);
}
function unique(values: unknown[], label: string) {
  require(values.length === new Set(values).size, `duplicate ${label}`);
}
function schema(name: (typeof NAMES)[number], value: unknown) {
  const check = validators[name];
  if (!check(value)) throw new ContractError(`${name}: ${ajv.errorsText(check.errors)}`);
}

function validate(mapping: any, awards: any) {
  schema("rankland-review", mapping);
  schema("rankland-award-review", awards);
  require(mapping.synthetic === awards.synthetic, "synthetic mismatch");
  require(mapping.catalog_sha256 === awards.catalog_sha256, "catalog hash mismatch");
  unique(mapping.entries.map((e: any) => e.entry_id), "mapping entry ID");
  unique(mapping.entries.map((e: any) => e.source.provider_contest_id), "source identity");
  const defaults: string[] = [];
  const approved = new Map<string, any>();
  for (const entry of mapping.entries) {
    const source = entry.source;
    require(source.provider_contest_id === `srk:${source.srk_path}`, "source ID/path mismatch");
    require(source.srk_path.startsWith(`${source.collection}/`), "collection/path mismatch");
    const url = new URL(source.page_url);
    require(["rl.algoux.cn", "rl.algoux.org"].includes(url.host), "unexpected RankLand host");
    require(!url.hash, "page URL must not have a fragment");
    if (url.pathname === "/collection/official") {
      const rankIds = url.searchParams.getAll("rankId");
      require(rankIds.length === 1 && rankIds[0].trim() !== "", "missing or duplicate rankId");
    } else {
      const parts = url.pathname.split("/");
      require(url.pathname.startsWith("/ranklist/") && parts.length === 3 && parts[2] !== "", "invalid ranklist route");
    }
    if (entry.status === "approved") {
      const selected = entry.selection.contest_id;
      require(entry.candidate_contest_ids.includes(selected), "selection is not a candidate");
      approved.set(entry.entry_id, entry);
      if (entry.selection.make_default) defaults.push(selected);
    }
  }
  unique(defaults, "default target");
  unique(awards.entries.map((e: any) => e.entry_id), "award entry ID");
  const published: string[] = [];
  for (const entry of awards.entries) {
    const link = approved.get(entry.mapping_entry_id);
    require(link !== undefined, "award must reference approved mapping");
    require(link.selection.contest_id === entry.contest_id, "award target mismatch");
    require(link.source.content_sha256 === entry.source_content_sha256, "source hash mismatch");
    if (entry.status === "approved") published.push(entry.contest_id);
    if (!("result" in entry)) continue;
    const result = entry.result;
    const cuts = ["gold", "silver", "bronze"].map((medal) => result.cutoffs[medal]);
    require(cuts.some((c) => c !== null), "all medals missing");
    if (cuts.some((c) => c === null)) require((result.missing_medals_reason ?? "").trim() !== "", "missing medal explanation");
    const present = cuts.filter((c) => c !== null);
    unique(present.map((c) => c.team_id), "boundary team");
    const ranks = present.map((c) => c.rank);
    const solved = present.map((c) => c.solved);
    require(ranks.every((r, i) => i === 0 || ranks[i - 1] < r), "medal ranks not increasing");
    require(solved.every((s, i) => i === 0 || solved[i - 1] >= s), "medal solved counts not decreasing");
    require(Math.max(...ranks) <= result.eligible_team_count, "rank exceeds eligible count");
    require(Math.max(...solved) <= result.problem_count, "solved exceeds problem count");
  }
  unique(published, "approved award target");
}

const mapping = readJSON("fixtures/imports/rankland/mapping-review.example.json");
const awards = readJSON("fixtures/imports/rankland/award-review.example.json");

describe("RankLand review schemas", () => {
  it.each(NAMES)("%s is a valid draft 2020-12 schema", (name) => {
    expect(ajv.validateSchema(SCHEMAS[name]), ajv.errorsText(ajv.errors)).toBe(true);
  });

  it("accepts the example mapping and award reviews", () => {
    expect(() => validate(mapping, awards)).not.toThrow();
  });

  it("accepts a no-medal group and an all-eligible group with explicit semantics, independent of key order", () => {
    const m = structuredClone(mapping), a = structuredClone(awards);
    const result = a.entries[0].result;
    result.group.scope = "all_eligible";
    delete result.group.source_group_ids;
    result.cutoffs.bronze = null;
    result.missing_medals_reason = "Synthetic group has no bronze award.";
    expect(() => validate(m, a)).not.toThrow();
    // JSON object key order cannot affect medal semantics.
    result.cutoffs = Object.fromEntries(["bronze", "gold", "silver"].map((k) => [k, result.cutoffs[k]]));
    expect(() => validate(m, a)).not.toThrow();
  });
});

type Mutation = (m: any, a: any) => void;
const negativeCases: [string, Mutation][] = [
  ["duplicate default", (m) => Object.assign(m.entries[1], { status: "approved", selection: m.entries[0].selection, review: m.entries[0].review })],
  ["all medals missing", (_m, a) => Object.assign(a.entries[0].result, { cutoffs: { gold: null, silver: null, bronze: null }, missing_medals_reason: "No awards" })],
  ["missing approval", (m) => { delete m.entries[0].review; }],
  ["pending selection", (m) => Object.assign(m.entries[1], { selection: m.entries[0].selection })],
  ["unknown field", (m) => Object.assign(m, { typo: true })],
  ["unpinned commit", (m) => Object.assign(m.entries[0].source, { commit_sha: "master" })],
  ["invalid time", (m) => Object.assign(m.entries[0].review, { reviewed_at: "yesterday" })],
  ["unsafe path", (m) => Object.assign(m.entries[0].source, { srk_path: "official/../test.srk.json" })],
  ["identity mismatch", (m) => Object.assign(m.entries[0].source, { provider_contest_id: "srk:official/other.srk.json" })],
  ["no rankId", (m) => Object.assign(m.entries[0].source, { page_url: "https://rl.algoux.cn/collection/official?x=1" })],
  ["duplicate rankId", (m) => Object.assign(m.entries[0].source, { page_url: "https://rl.algoux.cn/collection/official?rankId=a&rankId=b" })],
  ["unlisted candidate", (m) => Object.assign(m.entries[0].selection, { contest_id: "unknown" })],
  ["catalog mismatch", (_m, a) => Object.assign(a, { catalog_sha256: "f".repeat(64) })],
  ["source mismatch", (_m, a) => Object.assign(a.entries[0], { source_content_sha256: "f".repeat(64) })],
  ["unapproved mapping", (_m, a) => Object.assign(a.entries[0], { mapping_entry_id: "mapping-pending" })],
  ["blocked result", (_m, a) => Object.assign(a.entries[2], { result: a.entries[0].result })],
  ["missing group", (_m, a) => { delete a.entries[0].result.group.source_group_ids; }],
  ["frozen standings", (_m, a) => Object.assign(a.entries[0].result, { standings_state: "frozen" })],
  ["implicit estimate", (_m, a) => Object.assign(a.entries[0].result, { method: "ratio" })],
  ["wrong output unit", (_m, a) => Object.assign(a.entries[0].result, { penalty_unit: "seconds" })],
  ["rank too large", (_m, a) => Object.assign(a.entries[0].result.cutoffs.bronze, { rank: 11 })],
  ["wrong order", (_m, a) => Object.assign(a.entries[0].result.cutoffs.gold, { rank: 4 })],
  ["too many solved", (_m, a) => Object.assign(a.entries[0].result.cutoffs.gold, { solved: 14 })],
  ["unexplained null", (_m, a) => Object.assign(a.entries[0].result.cutoffs, { bronze: null })],
  ["duplicate award target", (_m, a) => Object.assign(a.entries[1], { status: "approved", review: a.entries[0].review })],
];

describe("RankLand review contract rejects invalid reviews", () => {
  it.each(negativeCases)("%s", (_name, mutate) => {
    const m = structuredClone(mapping), a = structuredClone(awards);
    mutate(m, a);
    expect(() => validate(m, a)).toThrow(ContractError);
  });
});
