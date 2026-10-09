// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { importCodeforcesMember } from "../../src/lib/codeforces";
import { applyLocalRuntimeSnapshot, exportLocalRuntimeSnapshot, localDb } from "../../src/lib/local-db";
import { importQojUserscriptMembers } from "../../src/lib/qoj";
import { cfReply, isAbortError } from "./helpers/async";
import { readRepoJson } from "./helpers/repo";

vi.mock("../../src/lib/catalog-runtime", () => ({
  listRuntimeCatalogProblemsForImport: async () => [{
    problemId: "example:A", contestId: "example", ordinal: "A", title: "A",
    sources: [{ provider: "codeforces", provider_problem_id: "100000:A" }, { provider: "qoj", provider_problem_id: "1" }],
  }],
}));

const example = readRepoJson("fixtures/imports/member-backup.example.json");
const contents = async () => JSON.stringify(await Promise.all(
  (["members", "memberHandles", "memberProblemStatus", "importSources", "syncRecords", "contestPreferences", "appSettings"] as const)
    .map((table) => localDb[table].toArray()),
));
const qojPayload = {
  provider: "qoj", exported_at: new Date().toISOString(),
  members: [{ member_id: "example-member", handle: "qoj-example", solved: ["1"], attempted: [] }],
} as any;
const batch = {
  ...qojPayload,
  members: [
    { ...qojPayload.members[0], solved: [], attempted: ["1"] },
    { member_id: "second", handle: "second", solved: ["1"], attempted: [] },
  ],
};
async function rejectUnchanged(action: () => Promise<unknown>, check: RegExp | ((error: unknown) => boolean)) {
  const before = await contents();
  const error = await action().then(() => { throw new Error("expected rejection"); }, (caught) => caught);
  if (check instanceof RegExp) expect(String((error as Error)?.message ?? error)).toMatch(check);
  else expect(check(error), String(error)).toBe(true);
  expect(await contents(), "Failed import must roll back every table").toBe(before);
}

// Each step builds on the previous database state, so they run in order.
describe("member import supplements", () => {
  beforeAll(async () => {
    await localDb.open();
    await applyLocalRuntimeSnapshot(example);
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await localDb.delete();
  });

  it("CF import keeps backup display names and manual account labels", async () => {
    vi.stubGlobal("fetch", async () => cfReply([{ id: 1, verdict: "OK", problem: { contestId: 100000, index: "A" } }]));
    await importCodeforcesMember({ memberId: "example-member", handle: "example" });
    expect((await localDb.members.get("example-member"))!.displayName).toBe("示例成员");
    await localDb.memberHandles.update("codeforces:example", { displayLabel: "手动账号名" });
    await importCodeforcesMember({ memberId: "example-member", handle: "example", displayName: "远端名称" } as any);
    expect((await localDb.members.get("example-member"))!.displayName).toBe("示例成员");
    expect((await localDb.memberHandles.get("codeforces:example"))!.displayLabel).toBe("手动账号名");
  });

  it("QOJ import validates the whole payload first and keeps manual names", async () => {
    await importQojUserscriptMembers(qojPayload);
    const before = await contents();
    await expect(importQojUserscriptMembers({ ...qojPayload, members: [qojPayload.members[0], { handle: "bad" }] })).rejects.toThrow(/做题记录/);
    expect(await contents(), "Validate the entire QOJ payload before writing its first member").toBe(before);
    await localDb.memberHandles.update("qoj:qoj-example", { displayLabel: "手动 QOJ 名称" });
    await importQojUserscriptMembers({ ...qojPayload, members: [{ ...qojPayload.members[0], display_name: "同步名称" }] });
    expect((await localDb.members.get("example-member"))!.displayName).toBe("示例成员");
    expect((await localDb.memberHandles.get("qoj:qoj-example"))!.displayLabel).toBe("手动 QOJ 名称");
  });

  // The first row could succeed on its own; a later ownership/write failure must
  // roll it back along with history. Capture must not initialize identities early.
  it("rolls back a whole QOJ batch on ownership failure, write failure or cancellation", async () => {
    await localDb.members.update("example-member", { identityRevision: undefined });
    await localDb.memberHandles.update("qoj:qoj-example", { identityRevision: undefined });
    await rejectUnchanged(() => importQojUserscriptMembers({ ...batch, members: [
      batch.members[1], { ...batch.members[0], member_id: "wrong-owner" },
    ] }), /已绑定其他成员/);

    const failSecond = (_key: unknown, row: any) => { if (row.summaryJson.member_id === "second") throw new Error("injected write failure"); };
    localDb.syncRecords.hook("creating", failSecond);
    try { await rejectUnchanged(() => importQojUserscriptMembers(batch), /injected write failure/); }
    finally { localDb.syncRecords.hook("creating").unsubscribe(failSecond); }

    const cancel = new AbortController();
    await rejectUnchanged(() => importQojUserscriptMembers(batch, {
      signal: cancel.signal, onProgress: ({ currentIndex }: any) => { if (currentIndex === 2) cancel.abort(); },
    } as any), isAbortError);
  });

  it("commits multiple accounts of one legacy identity together", async () => {
    await importQojUserscriptMembers({ ...batch, members: [batch.members[0], { ...batch.members[1], member_id: "example-member" }] });
    expect((await localDb.memberHandles.get("qoj:second"))!.memberId, "Multiple accounts of one legacy identity can commit together").toBe("example-member");
  });

  it("keeps previous status for accounts whose fetch failed in a mixed batch", async () => {
    const previousStatus = await localDb.memberProblemStatus.where("handleId").equals("qoj:qoj-example").toArray();
    const mixed = await importQojUserscriptMembers({ ...batch, members: [{ ...batch.members[1], member_id: "example-member" }],
      fetch_failures: [{ member_id: "example-member", handle: "qoj-example", error: "登录失效" }] });
    expect(mixed.memberCount).toBe(1);
    expect(mixed.fetchFailureCount).toBe(1);
    expect(await localDb.memberProblemStatus.where("handleId").equals("qoj:qoj-example").toArray()).toStrictEqual(previousStatus);
    expect((await localDb.syncRecords.toArray()).some((row) => row.status === "failed" && row.summaryJson.fetch_error === "登录失效")).toBe(true);
  });

  it("restores old data when a backup replace fails mid-write, and round-trips backups", async () => {
    // A storage failure after clearing tables must also restore the old backup data.
    const failRestore = () => { throw new Error("injected restore failure"); };
    localDb.members.hook("creating", failRestore);
    try { await rejectUnchanged(() => applyLocalRuntimeSnapshot(example, { mode: "replace" }), /injected restore failure/); }
    finally { localDb.members.hook("creating").unsubscribe(failRestore); }
    const backup = await exportLocalRuntimeSnapshot();
    await applyLocalRuntimeSnapshot(backup, { mode: "replace" });
    const { exportedAt: _a, ...after } = await exportLocalRuntimeSnapshot() as any;
    const { exportedAt: _b, ...expected } = backup as any;
    expect(after).toStrictEqual(expected);
  });
});
