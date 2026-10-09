// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { localDb, softDeleteMember, softDeleteMemberHandle } from "../../src/lib/local-db";
import { importQojUserscriptMembers, linkQojMember } from "../../src/lib/qoj";

vi.mock("../../src/lib/catalog-runtime", () => ({
  listRuntimeCatalogProblemsForImport: async () => [
    { problemId: "example:A", contestId: "example", ordinal: "A", title: "A", sources: [{ provider: "qoj", provider_problem_id: "1" }] },
  ],
}));

const importMember = (memberId: string) => importQojUserscriptMembers({
  provider: "qoj", exported_at: new Date().toISOString(),
  members: [{ member_id: memberId, handle: "B", solved: ["1"], attempted: [] }],
} as any);
const contents = async () => JSON.stringify(await Promise.all(
  (["members", "memberHandles", "memberProblemStatus", "importSources", "syncRecords"] as const).map((name) => localDb[name].toArray()),
));

// The steps build on each other, so they run in order on one database.
describe("member rebinding", () => {
  let rebound: any;
  beforeAll(async () => { await localDb.open(); });
  afterAll(async () => { await localDb.delete(); });

  it("rebinds a deleted member's account to a new member with fresh identity and no old data", async () => {
    await linkQojMember("a", "B");
    await importMember("a");
    await localDb.memberHandles.update("qoj:B", { displayLabel: "Old label", createdAt: "2020-01-01T00:00:00.000Z" });
    await softDeleteMember("a");
    await linkQojMember("b", "B");
    rebound = await localDb.memberHandles.get("qoj:B");
    expect(rebound.memberId).toBe("b");
    expect(rebound.deletedAt).toBeNull();
    expect(rebound.displayLabel).toBeNull();
    expect(rebound.createdAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect((await localDb.members.get("a"))!.deletedAt).toBeTruthy();
    expect(await localDb.memberProblemStatus.count()).toBe(0);
    await importMember("b");
    expect(await localDb.memberProblemStatus.where("memberId").equals("b").count()).toBe(1);
  });

  it("rejects binding an active account to another member without changing data", async () => {
    const bound = await contents();
    await expect(linkQojMember("c", "B")).rejects.toThrow(/已绑定其他成员/);
    await expect(importMember("c")).rejects.toThrow(/已绑定其他成员/);
    expect(await contents(), "Rejected bindings must not change data").toBe(bound);
  });

  it("lets an import claim an unlinked account and isolates the old member's data", async () => {
    await softDeleteMemberHandle("qoj:B");
    await importMember("c");
    expect((await localDb.memberHandles.get("qoj:B"))!.memberId).toBe("c");
    expect(await localDb.memberProblemStatus.where("memberId").equals("b").count()).toBe(0);
    expect((await localDb.memberHandles.get("qoj:B"))!.displayLabel).toBeNull();
  });

  it("checks account ownership even with a different record ID", async () => {
    await localDb.memberHandles.put({ ...rebound, handleId: "custom-id", handle: "custom-account" });
    const custom = await contents();
    await expect(linkQojMember("c", "custom-account")).rejects.toThrow(/已绑定其他成员/);
    expect(await contents(), "Check account ownership even with a different record ID").toBe(custom);
  });
});
