import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { localDb, migrateSpoilerPreferencesOnce } from "../../src/lib/local-db";
import { defaultSpoilerMode, shouldShowSpoilers } from "../../src/lib/spoiler-policy";
import { useSpoilerStore } from "../../src/stores/spoilers";
import { until } from "./helpers/async";

describe("spoiler policy with a global default", () => {
  it("touched: only touched contests show spoilers by default", () => {
    expect(shouldShowSpoilers(undefined, false, true, "touched")).toBe(false);
    expect(shouldShowSpoilers(undefined, true, true, "touched")).toBe(true);
    expect(shouldShowSpoilers(undefined, true), "touched is the default").toBe(true);
  });

  it("all: every contest shows spoilers by default", () => {
    expect(shouldShowSpoilers(undefined, false, true, "all")).toBe(true);
  });

  it("none: no contest shows spoilers by default, touched or not", () => {
    expect(shouldShowSpoilers(undefined, true, true, "none")).toBe(false);
    expect(shouldShowSpoilers(undefined, false, true, "none")).toBe(false);
  });

  it("manual choices win over every default", () => {
    expect(shouldShowSpoilers("non_spoiler", true, true, "all")).toBe(false);
    expect(shouldShowSpoilers("spoiler", false, true, "touched")).toBe(true);
    expect(shouldShowSpoilers("spoiler", true, true, "none")).toBe(true);
  });

  it("hides everything until loaded", () => {
    expect(shouldShowSpoilers("spoiler", true, false, "all")).toBe(false);
  });

  it("derives the default mode", () => {
    expect(defaultSpoilerMode(false, "touched")).toBe("non_spoiler");
    expect(defaultSpoilerMode(true, "touched")).toBe("spoiler");
    expect(defaultSpoilerMode(false, "all")).toBe("spoiler");
    expect(defaultSpoilerMode(true, "none")).toBe("non_spoiler");
  });
});

async function freshStore() {
  setActivePinia(createPinia());
  const store = useSpoilerStore();
  await until(() => store.loaded, "spoiler store loads");
  return store;
}

describe("spoiler store", () => {
  beforeEach(async () => {
    await localDb.delete();
    await localDb.open();
  });

  it("clears legacy bulk-written rows once, then keeps later manual choices", async () => {
    await localDb.contestPreferences.bulkPut([
      { contest_id: "a", spoiler_mode: "non_spoiler" },
      { contest_id: "b", spoiler_mode: "non_spoiler" },
    ] as never);
    const store = await freshStore();
    expect(store.overrideCount).toBe(0);
    expect(store.visible("a", true)).toBe(true);

    await localDb.contestPreferences.put({ contest_id: "a", spoiler_mode: "non_spoiler" } as never);
    await migrateSpoilerPreferencesOnce();
    expect(await localDb.contestPreferences.count()).toBe(1);
  });

  it("records every manual flip until it is reset", async () => {
    const store = await freshStore();
    await store.toggle("c", false);
    await store.toggle("c", false);
    expect(store.visible("c", false)).toBe(false);
    expect(store.hasOverride("c"), "an explicit off is kept even though it matches the default").toBe(true);
    expect(store.visible("c", true), "it keeps winning after the contest becomes touched").toBe(false);
  });

  it("changing the global default keeps manual choices", async () => {
    const store = await freshStore();
    await store.toggle("hidden", true);
    await store.toggle("shown", false);
    expect(store.overrideCount).toBe(2);

    await store.setSpoilerDefault("all");
    expect(store.visible("untouched", false)).toBe(true);
    expect(store.visible("hidden", true), "manual off survives the all default").toBe(false);
    await store.setSpoilerDefault("none");
    expect(store.visible("touched", true)).toBe(false);
    expect(store.visible("shown", false), "manual on survives the none default").toBe(true);
    await store.setSpoilerDefault("touched");
    expect(store.visible("untouched", false)).toBe(false);
    expect(store.visible("touched", true)).toBe(true);
    expect(store.overrideCount).toBe(2);
    expect((await localDb.appSettings.get("spoiler_default"))!.value).toBe("touched");
  });

  it("falls back to touched for a missing or unknown stored default", async () => {
    await localDb.appSettings.put({ key: "spoiler_default", value: "bogus" });
    const store = await freshStore();
    expect(store.spoilerDefault).toBe("touched");
  });

  it("resets one contest or all manual choices to the default", async () => {
    const store = await freshStore();
    await store.toggle("x", true);
    await store.toggle("y", false);
    await store.resetContest("x");
    expect(store.hasOverride("x")).toBe(false);
    expect(store.visible("x", true)).toBe(true);
    expect(store.overrideCount).toBe(1);

    await store.resetAll();
    expect(store.overrideCount).toBe(0);
    expect(await localDb.contestPreferences.count()).toBe(0);
  });
});
