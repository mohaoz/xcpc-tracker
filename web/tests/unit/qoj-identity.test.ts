// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { cfReply, isAbortError, until } from "./helpers/async";
import { createQojFixture, type QojFixture } from "./helpers/qoj-fixture";

vi.mock("../../src/lib/catalog-runtime", async () => (await import("./helpers/qoj-mocks")).catalogRuntimeMock());
vi.mock("../../src/lib/local-db", async (orig) => (await import("./helpers/qoj-mocks")).localDbMock(await orig<any>()));
vi.mock("../../src/lib/member-events", async () => (await import("./helpers/qoj-mocks")).memberEventsMock());
vi.mock("../../src/lib/codeforces-auth", () => ({ loadCodeforcesApiCredentials: () => null }));
// The sync store gets a no-op CF importer; the explicit Add Member check below
// uses the real adapter through vi.importActual.
vi.mock("../../src/lib/codeforces", async (orig) => ({ ...await orig<any>(), importCodeforcesMember: async () => {} }));
vi.mock("../../src/stores/feedback", async () => (await import("./helpers/qoj-mocks")).feedbackMock());
vi.mock("vue-router", async () => (await import("./helpers/qoj-mocks")).routerMock());

type Action = "delete" | "recreate" | "unlink" | "rebind";
const actions: Action[] = ["delete", "recreate", "unlink", "rebind"];

async function expectAbort(promise: Promise<unknown>) {
  const error = await promise.then(() => { throw new Error("expected AbortError"); }, (caught) => caught);
  expect(isAbortError(error), String(error)).toBe(true);
}

// Steps reuse one fixture; each step resets it first.
describe("QOJ import identity guards", () => {
  let f: QojFixture;
  beforeAll(async () => { f = await createQojFixture(); });
  afterAll(async () => { await f.close(); });

  function holdCatalog() {
    let entered = false;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    f.state.catalog = async () => { entered = true; await ready; return f.problems; };
    return { entered: () => entered, release };
  }
  async function changeIdentity(action: Action) {
    if (action === "unlink" || action === "rebind") await f.db.softDeleteMemberHandle("qoj:test");
    else await f.db.softDeleteMember("alice");
    if (action === "recreate" || action === "rebind") await f.qoj.linkQojMember("alice", "test");
  }
  const stateWithoutHistory = async () =>
    JSON.stringify(await Promise.all([f.localDb.members.toArray(), f.localDb.memberHandles.toArray(), f.localDb.memberProblemStatus.toArray()]));

  it.each(actions)("an existing raw import is guarded against %s", async (action) => {
    await f.reset();
    const catalog = holdCatalog();
    const rejected = expectAbort(f.qoj.importQojUserscriptMembers(f.payload("alice", "test", ["2"])));
    await until(catalog.entered, "raw import must wait after capturing identity");
    await changeIdentity(action);
    const before = await stateWithoutHistory();
    catalog.release();
    await rejected;
    expect(await stateWithoutHistory(), "stale raw import must not change deleted/new identities").toBe(before);
  });

  it.each((["request", "catalog"] as const).flatMap((stage) => actions.map((action) => [stage, action] as const)))(
    "the bridge guards at %s stage against %s, including re-created identities",
    async (stage, action) => {
      await f.reset();
      const catalog = stage === "catalog" ? holdCatalog() : null;
      const { pending } = await f.begin(true);
      if (catalog) {
        f.respond(f.state.held.at(-1)!);
        await until(catalog.entered, "bridge save must wait at catalog");
      }
      await changeIdentity(action);
      const before = await stateWithoutHistory();
      if (catalog) catalog.release();
      else f.respond(f.state.held.at(-1)!);
      await pending;
      expect(await stateWithoutHistory(), "stale bridge response cannot recreate or modify a replacement").toBe(before);
      expect((await f.bridgeRecords())[0].summaryJson.error_code).toBe("CANCELLED");
      expect((await f.bridgeRecords())[0].summaryJson.cancellation_reason).toBe("target_removed");
    },
  );

  it.each(["export", "catalog", "lock"])("a stale manual import waiting at %s cannot target a replacement identity", async (stage) => {
    await f.reset();
    await f.manual.show([{ memberId: "alice", handle: "test" }] as any);
    const catalog = stage === "catalog" ? holdCatalog() : null;
    let lockEntered = false;
    let releaseLock: (() => void) | undefined;
    if (stage === "lock") f.state.beforeLock = async () => { lockEntered = true; await new Promise<void>((resolve) => { releaseLock = resolve; }); };
    if (stage === "export") await changeIdentity("recreate");
    f.manual.input = JSON.stringify(f.payload("alice", "test", ["2"]));
    const pending = f.manual.importJson();
    if (catalog) await until(catalog.entered, "manual import must reach catalog");
    if (stage === "lock") await until(() => lockEntered, "manual import must enter lock");
    if (stage !== "export") await changeIdentity("recreate");
    const before = await stateWithoutHistory();
    catalog?.release();
    releaseLock?.();
    await pending;
    expect(f.manual.error).toMatch(/账号已变更/);
    expect(await stateWithoutHistory()).toBe(before);
  });

  it("a bridge run queued behind the lock keeps its captured identity", async () => {
    await f.reset();
    let lockEntered = false;
    let releaseLock!: () => void;
    f.state.beforeLock = async () => { lockEntered = true; await new Promise<void>((resolve) => { releaseLock = resolve; }); };
    const queued = f.store.sync(true);
    await until(() => lockEntered, "bridge must queue after identity capture");
    await changeIdentity("recreate");
    const queuedBefore = await stateWithoutHistory();
    releaseLock();
    await queued;
    expect(f.state.requests.length).toBe(0);
    expect(await stateWithoutHistory()).toBe(queuedBefore);
    expect((await f.bridgeRecords())[0].summaryJson.error_code).toBe("CANCELLED");
  });

  it("later batch entries keep their original identities", async () => {
    await f.reset();
    await f.qoj.linkQojMember("bob", "second");
    const batch = await f.begin(true);
    await f.db.softDeleteMember("bob");
    f.state.mode = "success";
    f.respond(f.state.held.at(-1)!);
    await batch.pending;
    expect(f.state.requests.map((r) => r.params.handle), "deleted later batch target must never be requested").toStrictEqual(["test"]);
    expect((await f.localDb.members.get("bob"))!.deletedAt).toBeTruthy();
    expect(await f.localDb.memberProblemStatus.where("memberId").equals("bob").count()).toBe(0);
  });

  it.each(["merge", "replace"] as const)("a %s backup restore does not revive old sync authority", async (mode) => {
    await f.reset();
    const backup = await f.db.exportLocalRuntimeSnapshot();
    const run = await f.begin(true);
    await f.db.softDeleteMember("alice");
    await f.db.applyLocalRuntimeSnapshot(backup, { mode });
    const before = await stateWithoutHistory();
    f.respond(f.state.held.at(-1)!);
    await run.pending;
    expect(await stateWithoutHistory(), "backup restore must not revive old sync authority").toBe(before);
  });

  it("cancellation during catalog loading leaves data unchanged", async () => {
    await f.reset();
    const catalog = holdCatalog();
    const cancel = new AbortController();
    const rejected = expectAbort(f.qoj.importQojUserscriptMembers(f.payload("alice", "test", ["2"]), { requireExisting: true, signal: cancel.signal } as any));
    await until(catalog.entered, "cancellable import must reach catalog");
    const before = await stateWithoutHistory();
    cancel.abort();
    catalog.release();
    await rejected;
    expect(await stateWithoutHistory()).toBe(before);
  });

  it("explicit QOJ/CF add and raw file import restore deleted members; refresh and duplicate guards stay strict", async () => {
    await f.reset();
    const old = (await f.localDb.members.get("alice"))!.identityRevision;
    await f.db.softDeleteMember("alice");
    await f.qoj.linkQojMember("alice", "test");
    const restored = await f.localDb.members.get("alice");
    expect(restored!.deletedAt).toBeFalsy();
    expect(restored!.identityRevision).not.toBe(old);
    await f.manual.show([{ memberId: "alice", handle: "test" }] as any);
    f.manual.input = JSON.stringify(f.payload("alice", "test", ["2"]));
    await f.manual.importJson();
    expect(f.manual.error).toBe("");
    expect((await f.localDb.memberProblemStatus.toArray())[0].problemId).toBe("fixture:2");
    await f.db.softDeleteMember("alice");
    await f.qoj.importQojUserscriptMembers(f.payload("alice", "test", ["1"]));
    expect((await f.localDb.members.get("alice"))!.deletedAt, "explicit raw import still restores deleted members").toBeFalsy();

    const cf = await vi.importActual<typeof import("../../src/lib/codeforces")>("../../src/lib/codeforces");
    await f.db.softDeleteMember("alice");
    vi.stubGlobal("fetch", async () => cfReply([{ id: 1, verdict: "OK", problem: { contestId: 123, index: "1" } }]));
    await cf.importCodeforcesMember({ memberId: "alice", handle: "cf" });
    expect((await f.localDb.members.get("alice"))!.deletedAt, "explicit Add Member CF restore stays supported").toBeFalsy();
    expect((await f.localDb.memberProblemStatus.toArray()).some((row) => row.provider === "codeforces")).toBe(true);

    await expectAbort(f.qoj.importQojUserscriptMembers(f.payload("missing", "missing"), { requireExisting: true } as any));
    await expect(f.qoj.importQojUserscriptMembers({ ...f.payload(), members: [...f.payload().members, ...f.payload("bob").members] }))
      .rejects.toThrow(/账号重复/);
  });
});
