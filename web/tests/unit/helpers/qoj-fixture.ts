// Offline QOJ bridge fixture: real Pinia stores/importers on disposable IndexedDB,
// with a scripted userscript bridge on `window.postMessage`. Run in the node
// environment and register the doubles described in ./qoj-mocks.
import { createPinia, setActivePinia } from "pinia";
import { expect, vi } from "vitest";

import * as db from "../../../src/lib/local-db";
import * as qoj from "../../../src/lib/qoj";
import { useQojManualStore } from "../../../src/stores/qoj-manual";
import { useQojSyncStore } from "../../../src/stores/qoj-sync";
import { until } from "./async";
import { feedback, fixtureProblems, qojState, resetQojState, type BridgeRequest } from "./qoj-mocks";

export type QojFixture = Awaited<ReturnType<typeof createQojFixture>>;

export async function createQojFixture() {
  const { localDb } = db;
  const state = qojState;
  const listeners = new Set<(event: unknown) => void>();
  const locks = new Set<string>();
  const windowMock = {
    addEventListener(type: string, listener: (event: unknown) => void) { if (type === "message") listeners.add(listener); },
    removeEventListener(type: string, listener: (event: unknown) => void) { if (type === "message") listeners.delete(listener); },
    postMessage(request: BridgeRequest) {
      if (request.direction !== "request") return;
      if (request.method === "hello") { if (state.holdHello) state.hellos.push(request); else respond(request); }
      if (request.method === "syncMember") {
        state.requests.push(request);
        if (state.mode === "hold") state.held.push(request);
        else respond(request, state.mode === "success" ? undefined : state.mode);
      }
    },
  };
  const respond = (request: BridgeRequest, error?: string) => queueMicrotask(() => {
    const data = {
      protocol: "xcpc-sync", version: 1, direction: "response", request_id: request.request_id,
      ...(error ? { error: { code: error } } : {
        result: request.method === "hello"
          ? { version: 1, connected: true, script_version: "1.0.6" }
          : { provider: "qoj", handle: request.params.handle, fetched_at: new Date().toISOString(), snapshot: { scope: "profile_visible", solved: ["1", "2"], attempted: [] } },
      }),
    };
    for (const listener of [...listeners]) listener({ source: windowMock, origin: "https://fixture.invalid", data });
  });

  vi.stubGlobal("navigator", { locks: { request: async (name: string, _options: unknown, run: (lock: unknown) => unknown) => {
    await state.beforeLock(name);
    if (locks.has(name)) return run(null);
    locks.add(name);
    try { return await run({}); } finally { locks.delete(name); }
  } } });
  vi.stubGlobal("window", windowMock);
  vi.stubGlobal("location", { origin: "https://fixture.invalid" });
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("fetch", async () => ({ ok: false }));

  let store: ReturnType<typeof useQojSyncStore> | undefined;
  let manual: ReturnType<typeof useQojManualStore> | undefined;
  const payload = (memberId = "alice", handle = "test", solved = ["1"]) =>
    ({ provider: "qoj", exported_at: new Date().toISOString(), members: [{ member_id: memberId, handle, solved, attempted: [] }] }) as any;
  const reset = async () => {
    if (store?.busy || manual?.busy) throw new Error("previous step must settle before reset");
    store?.$dispose();
    manual?.$dispose();
    for (const table of localDb.tables) await table.clear();
    resetQojState();
    feedback.current = null;
    setActivePinia(createPinia());
    store = useQojSyncStore();
    manual = useQojManualStore();
    store.enabled = true;
    store.useUserscript = true;
    await qoj.importQojUserscriptMembers(payload());
  };
  await localDb.open();
  await reset();

  return {
    db, localDb, qoj, state, problems: fixtureProblems, respond, payload, reset,
    get store() { return store!; },
    get manual() { return manual!; },
    bridgeRecords: async () => (await localDb.syncRecords.toArray()).filter((r) => r.summaryJson.bridge),
    age: () => localDb.syncRecords.toCollection().modify((r) => { r.startedAt = new Date(Date.parse(r.startedAt) - 31 * 60000).toISOString(); }),
    begin: async (isManual = false) => {
      const count = state.requests.length;
      const pending = store!.sync(isManual);
      await until(() => state.requests.length === count + 1, "sync must reach the bridge");
      return { pending };
    },
    paused: async () => {
      const count = state.requests.length;
      state.mode = "success";
      await store!.setEnabled(true);
      await until(() => !store!.busy, "enable check must settle");
      await store!.sync(false, undefined, true);
      expect(state.requests.length, "paused target must not retry on enable or focus").toBe(count);
    },
    close: async () => {
      state.holdRecord = false;
      state.releaseRecord?.();
      store?.cancel();
      await until(() => !store?.busy, "cleanup must settle");
      store?.$dispose();
      manual?.$dispose();
      await localDb.delete();
      vi.unstubAllGlobals();
    },
  };
}
