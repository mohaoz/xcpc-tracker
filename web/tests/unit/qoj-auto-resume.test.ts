// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { until } from "./helpers/async";
import { createQojFixture, type QojFixture } from "./helpers/qoj-fixture";

vi.mock("../../src/lib/catalog-runtime", async () => (await import("./helpers/qoj-mocks")).catalogRuntimeMock());
vi.mock("../../src/lib/local-db", async (orig) => (await import("./helpers/qoj-mocks")).localDbMock(await orig<any>()));
vi.mock("../../src/lib/member-events", async () => (await import("./helpers/qoj-mocks")).memberEventsMock());
vi.mock("../../src/lib/codeforces", () => ({ importCodeforcesMember: async () => {} }));
vi.mock("../../src/stores/feedback", async () => (await import("./helpers/qoj-mocks")).feedbackMock());
vi.mock("vue-router", async () => (await import("./helpers/qoj-mocks")).routerMock());

// Steps reuse one fixture; each later step resets it first.
describe("QOJ automatic sync pause and resume", () => {
  let f: QojFixture;
  beforeAll(async () => { f = await createQojFixture(); });
  afterAll(async () => { await f.close(); });

  it("pauses on off, preserves data, ignores late replies and resumes once on re-enable without looping", async () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const before = await f.localDb.memberProblemStatus.toArray();
      f.state.mode = "hold";
      const { pending } = await f.begin();
      await f.store.setEnabled(false);
      await pending;
      const cancelled = (await f.bridgeRecords()).find((r) => r.summaryJson.error_code === "CANCELLED");
      expect(cancelled).toBeTruthy();
      expect(await f.localDb.memberProblemStatus.toArray()).toStrictEqual(before);
      f.respond(f.state.held.at(-1)!);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(await f.localDb.memberProblemStatus.toArray(), "late responses cannot save data").toStrictEqual(before);
      expect(f.store.useUserscript).toBe(true);
      await f.store.sync(false, undefined, true);
      expect(f.state.requests.length, "disabled sync stays idle").toBe(cycle * 2 + 1);
      f.state.mode = "success";
      await f.store.setEnabled(true);
      await until(() => !f.store.busy, "resumed run must settle");
      expect(f.state.requests.length, "reenabling resumes the interrupted automatic request").toBe(cycle * 2 + 2);
      expect(cancelled!.summaryJson.manual).toBe(false);
      expect(cancelled!.summaryJson.cancellation_reason).toBe("settings_disabled");
      expect(cancelled!.summaryJson.retry_at).toBe(0);
      expect(cancelled!.summaryJson.failures).toBe(0);
      expect((await f.bridgeRecords()).filter((r) => r.status === "succeeded")).toHaveLength(cycle + 1);
      for (let n = 0; n < 3; n++) await f.store.sync(false, undefined, true);
      expect(f.state.requests.length, "fresh recovery must not loop").toBe(cycle * 2 + 2);
      await f.age();
    }
  });

  it.each([false, true])("handles rapid off/on during persistence (explicit Stop: %s)", async (stop) => {
    await f.reset();
    f.state.holdRecord = true;
    const { pending } = await f.begin();
    await f.store.setEnabled(false);
    await until(() => f.state.recordEntered, "cancellation must reach persistence");
    f.state.mode = "success";
    await f.store.setEnabled(true);
    expect(f.state.requests.length, "reenable must not overlap cancellation").toBe(1);
    if (stop) f.store.cancel();
    f.state.holdRecord = false;
    f.state.releaseRecord!();
    await pending;
    await until(() => !f.store.busy, "pending recovery must settle");
    expect(f.state.requests.length).toBe(stop ? 1 : 2);
    if (stop) {
      expect((await f.bridgeRecords())[0].summaryJson.cancellation_reason).toBe("user_cancelled");
      await f.age();
      await f.paused();
      await f.store.sync(true);
      expect(f.state.requests.length).toBe(2);
    }
  });

  it("disabling script mode pauses both settings and automatic re-enable recovers", async () => {
    await f.reset();
    const mode = await f.begin();
    await f.store.setUseUserscript(false);
    await mode.pending;
    expect(f.store.enabled).toBe(false);
    expect(f.store.useUserscript).toBe(false);
    expect((await f.bridgeRecords())[0].summaryJson.cancellation_reason).toBe("settings_disabled");
    await f.store.setUseUserscript(true);
    await f.store.sync(false);
    expect(f.state.requests.length).toBe(1);
    f.state.mode = "success";
    await f.store.setEnabled(true);
    await until(() => !f.store.busy, "mode recovery must settle");
    expect(f.state.requests.length).toBe(2);
  });

  it.each([false, true])("explicit Stop pauses future recovery (manual run: %s)", async (manual) => {
    await f.reset();
    const run = await f.begin(manual);
    f.store.cancel();
    await run.pending;
    expect((await f.bridgeRecords())[0].summaryJson.cancellation_reason).toBe("user_cancelled");
    await f.age();
    await f.paused();
    await f.store.sync(true);
    expect(f.state.requests.length).toBe(2);
  });

  it("a manual run interrupted by disabling stays paused", async () => {
    await f.reset();
    const manual = await f.begin(true);
    await f.store.setEnabled(false);
    await manual.pending;
    expect((await f.bridgeRecords())[0].summaryJson.manual).toBe(true);
    await f.paused();
  });

  it.each(["AUTH_REQUIRED", "PARSE_ERROR", "NETWORK_ERROR"])("a manual %s failure is not retried automatically", async (code) => {
    await f.reset();
    f.state.mode = code;
    await f.store.sync(true);
    await f.age();
    await f.paused();
  });

  it("automatic errors back off", async () => {
    await f.reset();
    f.state.mode = "NETWORK_ERROR";
    await f.store.sync(false);
    expect((await f.bridgeRecords())[0].summaryJson.retry_at).toBeGreaterThan(Date.now());
    f.state.mode = "success";
    await f.store.sync(false, undefined, true);
    expect(f.state.requests.length).toBe(1);
  });

  it.each(["lock", "hello"])("explicit Stop during %s preflight stays paused without making a request", async (stage) => {
    await f.reset();
    let entered = false;
    let release!: () => void;
    if (stage === "lock") f.state.beforeLock = async () => { entered = true; await new Promise<void>((resolve) => { release = resolve; }); };
    else f.state.holdHello = true;
    const pending = f.store.sync(false);
    await until(() => (stage === "lock" ? entered : f.state.hellos.length === 1), "run must reach preflight gate");
    f.store.cancel();
    if (stage === "lock") { f.state.beforeLock = async () => {}; release(); }
    else { f.state.holdHello = false; f.respond(f.state.hellos[0]); }
    await pending;
    expect(f.state.requests.length, "Stop before RPC must not send an upstream request").toBe(0);
    expect((await f.bridgeRecords())[0].summaryJson.cancellation_reason).toBe("user_cancelled");
    await f.paused();
    await f.store.sync(true);
    expect(f.state.requests.length, "explicit retry after preflight Stop remains available").toBe(1);
  });

  it("preflight Stop selects the eligible account without poisoning fresh accounts", async () => {
    await f.reset();
    f.state.mode = "success";
    await f.store.sync(true);
    await f.qoj.linkQojMember("bob", "second");
    let lockEntered = false;
    let releaseLock!: () => void;
    f.state.beforeLock = async () => { lockEntered = true; await new Promise<void>((resolve) => { releaseLock = resolve; }); };
    const queued = f.store.sync(false);
    await until(() => lockEntered, "mixed batch must reach lock");
    f.store.cancel();
    f.state.beforeLock = async () => {};
    releaseLock();
    await queued;
    const stopped = (await f.bridgeRecords()).filter((r) => r.summaryJson.error_code === "CANCELLED");
    expect(stopped.map((r) => r.summaryJson.handle), "Stop applies to the next eligible target, skipping fresh Alice").toStrictEqual(["second"]);
    expect(f.state.requests.length).toBe(1);
    await f.paused();
    expect(f.state.requests.length, "eligible Bob must remain paused on subsequent automatic checks").toBe(1);
  });

  it("deleted targets stay deleted and legacy unknown-cause cancellation remains paused", async () => {
    await f.reset();
    const removed = await f.begin();
    await f.db.softDeleteMember("alice");
    f.respond(f.state.held.at(-1)!);
    await removed.pending;
    expect((await f.bridgeRecords())[0].summaryJson.cancellation_reason).toBe("target_removed");
    await f.paused();
    expect((await f.localDb.members.get("alice"))!.deletedAt).toBeTruthy();
    expect(await f.localDb.memberProblemStatus.count()).toBe(0);

    await f.reset();
    const interrupted = await f.begin();
    await f.store.setEnabled(false);
    await interrupted.pending;
    await f.db.softDeleteMember("alice");
    await f.paused();
    expect((await f.localDb.members.get("alice"))!.deletedAt).toBeTruthy();
    expect(await f.localDb.memberProblemStatus.count()).toBe(0);

    await f.reset();
    const legacy = await f.begin();
    f.store.cancel();
    await legacy.pending;
    await f.localDb.syncRecords.toCollection().modify((r) => { delete r.summaryJson.cancellation_reason; });
    await f.age();
    await f.paused();
  });
});
