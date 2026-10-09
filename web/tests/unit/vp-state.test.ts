// @vitest-environment node
// Node 20 CI has no browser navigator; these checks exercise that runtime.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { selectAwardCutoffs } from "../../src/lib/award-policy";
import { importCodeforcesMember } from "../../src/lib/codeforces";
import { applyLocalRuntimeSnapshot, exportLocalRuntimeSnapshot, localDb } from "../../src/lib/local-db";
import { ratingClass } from "../../src/lib/rating-colors";

vi.mock("../../src/lib/catalog-runtime", () => ({
  listRuntimeCatalogProblemsForImport: async () => [{
    problemId: "c:A", contestId: "c", ordinal: "A", title: "Example", aliases: [],
    sources: [{ provider: "codeforces", provider_problem_id: "100000:A" }],
  }],
}));

describe("rating colors", () => {
  it.each([
    [1199, "gray"], [1200, "green"], [1399, "green"], [1400, "cyan"], [1599, "cyan"], [1600, "blue"], [1899, "blue"],
    [1900, "violet"], [2099, "violet"], [2100, "orange"], [2399, "orange"], [2400, "red"], [2999, "red"], [3000, "legendary"],
  ])("rating %i uses the %s CF rank color", (rating, color) => {
    expect(ratingClass(rating)).toBe(`rating--${color}`);
  });
});

describe("award cutoff selection", () => {
  const estimate = { source: "inferred_official_medal_ratio_10_20_30" };
  const official = { source: "explicit" };
  it("hides estimates unless enabled and prefers explicit awards", () => {
    expect(selectAwardCutoffs({ awardCutoffs: estimate } as any)).toBeNull();
    expect(selectAwardCutoffs({ awardCutoffs: estimate } as any, true)).toBe(estimate);
    expect(selectAwardCutoffs({ awardCutoffs: official, estimatedAwardCutoffs: estimate } as any, true)).toBe(official);
    expect(selectAwardCutoffs({ estimatedAwardCutoffs: estimate } as any, false)).toBeNull();
    expect(selectAwardCutoffs({ estimatedAwardCutoffs: estimate } as any, true)).toBe(estimate);
  });
});

describe("VP state persistence and CF import", () => {
  beforeAll(async () => { await localDb.open(); });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await localDb.delete();
  });

  it("backs up and restores spoiler preferences and medal-estimate settings", async () => {
    expect(await localDb.appSettings.get("allow_medal_estimates")).toBeUndefined();
    await localDb.appSettings.put({ key: "allow_medal_estimates", value: true } as any);
    await localDb.contestPreferences.put({ contest_id: "c", spoiler_mode: "non_spoiler" } as any);
    const snapshot = await exportLocalRuntimeSnapshot();
    expect((snapshot as any).app_settings.allow_medal_estimates).toBe(true);
    await localDb.appSettings.clear();
    expect((snapshot as any).contest_preferences).toStrictEqual([{ contest_id: "c", spoiler_mode: "non_spoiler" }]);
    await localDb.contestPreferences.clear();
    await applyLocalRuntimeSnapshot(snapshot, { mode: "replace" });
    expect((await localDb.appSettings.get("allow_medal_estimates"))!.value).toBe(true);
    expect((await localDb.contestPreferences.get("c"))!.spoiler_mode).toBe("non_spoiler");

    expect((snapshot as any).app_settings.spoiler_default).toBe("touched");

    const bad = { ...snapshot, contest_preferences: [{ contest_id: "c", spoiler_mode: "invalid" }] };
    await expect(applyLocalRuntimeSnapshot(bad as any, { mode: "replace" })).rejects.toThrow();
    expect((await localDb.contestPreferences.get("c"))!.spoiler_mode).toBe("non_spoiler");
  });

  it("restores the global spoiler default and ignores per-contest rows from legacy backups", async () => {
    await localDb.appSettings.put({ key: "spoiler_default", value: "none" });
    await localDb.contestPreferences.put({ contest_id: "manual", spoiler_mode: "spoiler" } as any);
    const snapshot = await exportLocalRuntimeSnapshot();
    expect((snapshot as any).app_settings.spoiler_default).toBe("none");
    await localDb.appSettings.put({ key: "spoiler_default", value: "all" });
    await localDb.contestPreferences.clear();
    await applyLocalRuntimeSnapshot(snapshot, { mode: "replace" });
    expect((await localDb.appSettings.get("spoiler_default"))!.value).toBe("none");
    expect((await localDb.contestPreferences.get("manual"))!.spoiler_mode).toBe("spoiler");

    // A backup from before spoiler_default: its bulk-written rows are not restored,
    // and the current global default is kept.
    const legacy = { ...snapshot, app_settings: { allow_medal_estimates: true }, contest_preferences: [{ contest_id: "bulk", spoiler_mode: "non_spoiler" }] };
    await localDb.contestPreferences.clear();
    await applyLocalRuntimeSnapshot(legacy as any, { mode: "replace" });
    expect(await localDb.contestPreferences.get("bulk")).toBeUndefined();

    const invalid = { ...snapshot, app_settings: { allow_medal_estimates: true, spoiler_default: "maybe" } };
    await expect(applyLocalRuntimeSnapshot(invalid as any, { mode: "replace" })).rejects.toThrow();
    expect((await localDb.appSettings.get("spoiler_default"))!.value).toBe("none");
  });

  it("skips automatic sync without Web Locks", async () => {
    vi.stubGlobal("navigator", undefined);
    let automaticRequests = 0;
    vi.stubGlobal("fetch", async () => { automaticRequests++; throw new Error("Automatic sync must not run without Web Locks"); });
    await importCodeforcesMember({ memberId: "m", handle: "example" }, { automatic: true });
    expect(automaticRequests).toBe(0);
  });

  it("records unmatched CF statuses as provenance", async () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ status: "OK", result: [
      { id: 1, verdict: "WRONG_ANSWER", problem: { contestId: 100000, index: "A" } },
      { id: 2, verdict: "OK", problem: { contestId: 100001, index: "B" } },
    ] }) }));
    await importCodeforcesMember({ memberId: "m", handle: "example" });
    expect((await localDb.memberProblemStatus.toArray())[0].status).toBe("attempted");
    const success = (await localDb.syncRecords.toArray())[0];
    expect(success.summaryJson.unmatched_status_count).toBe(1);
    expect((await localDb.importSources.get(success.sourceRecordId!))!.rawMetaJson.unmatched_problem_statuses).toHaveLength(1);
  });

  it("keeps the last successful status when an import fails", async () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("fetch", async () => { throw new Error("offline fixture failure"); });
    await expect(importCodeforcesMember({ memberId: "m", handle: "example" })).rejects.toThrow();
    expect((await localDb.syncRecords.toArray()).filter((s) => s.status === "failed")).toHaveLength(1);
    expect(await localDb.memberProblemStatus.toArray(), "Failure must preserve last successful status").toHaveLength(1);
  });
});
