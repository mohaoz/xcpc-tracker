// @vitest-environment node
import Ajv from "ajv/dist/2020.js";
import Dexie from "dexie";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { importCodeforcesMember, syncAllCodeforcesMembers } from "../../src/lib/codeforces";
import * as db from "../../src/lib/local-db";
import { importQojUserscriptMembers } from "../../src/lib/qoj";
import { cfReply } from "./helpers/async";
import { readRepoJson } from "./helpers/repo";

const { localDb } = db;
const at = "2026-09-30T00:00:00.000Z";
const member = (id: string) => ({ memberId: id, displayName: id, createdAt: at, updatedAt: at }) as any;
const handle = (id: string, account: string, provider = "qoj") =>
  ({ handleId: `${provider}:${account}`, memberId: id, provider, handle: account, displayLabel: null, createdAt: at, updatedAt: at }) as any;
const source = (id: string, account?: string) =>
  ({ sourceRecordId: id, kind: "qoj_userscript_json", label: "Synthetic import", importedAt: at, rawMetaJson: account ? { handle: account } : {} }) as any;
const status = (id: string, problem: string, sourceRecordId: string, provider = "qoj") => ({
  statusId: id, memberId: "alice", problemId: problem, provider, status: "solved", firstSeenAt: at, lastSeenAt: at, sourceRecordId,
  matchMethod: provider === "manual" ? "manual" : "provider_id",
});

vi.mock("../../src/lib/catalog-runtime", () => ({
  listRuntimeCatalogProblemsForImport: async () => [1, 2, 3, 4].map((n) => ({
    problemId: `test:${n}`, contestId: "test", ordinal: String(n), title: `Problem ${n}`,
    sources: [{ provider: "qoj", provider_problem_id: String(n) }, { provider: "codeforces", provider_problem_id: `123:${n}` }],
  })),
}));
vi.mock("../../src/lib/codeforces-auth", () => ({ loadCodeforcesApiCredentials: () => null }));

const importQoj = (id: string, account: string, solved: string[], attempted: string[] = []) =>
  importQojUserscriptMembers({ provider: "qoj", exported_at: at, members: [{ member_id: id, handle: account, solved, attempted }] } as any);
const contents = async () => JSON.stringify(await Promise.all(localDb.tables.map((table) => table.toArray())));
const clear = async () => { for (const table of localDb.tables) await table.clear(); };
const okSubmission = () => cfReply([{ id: 1, verdict: "OK", problem: { contestId: 123, index: "1" } }]);
const removedOrReplaced = /removed|rebound|replaced/;

/** Opens an actual v6 database before the app's v7 schema sees it. */
async function seedLegacyV6() {
  // Exercising only fresh v7 databases would miss destructive upgrades and
  // already-collapsed evidence from previous releases.
  const legacy = new Dexie("xcpc_tracker_local");
  legacy.version(6).stores({
    catalogContests: "contestId, deletedAt", catalogProblems: "problemId, contestId",
    members: "memberId, updatedAt, deletedAt", memberHandles: "handleId, memberId, [provider+handle], updatedAt, deletedAt",
    memberProblemStatus: "statusId, memberId, problemId, [memberId+problemId], [provider+problemId], lastSeenAt",
    importSources: "sourceRecordId, kind, importedAt", syncRecords: "syncId, adapter, startedAt, sourceRecordId",
    problemMatchCache: "cacheKey, [provider+externalRef], updatedAt", contestPreferences: "contest_id", appSettings: "key",
  });
  await legacy.open();
  await legacy.table("members").put(member("alice"));
  await legacy.table("memberHandles").bulkPut([handle("alice", "A"), handle("alice", "B")]);
  await legacy.table("importSources").bulkPut([source("qoj:A:legacy", "A"), source("legacy-B", "B"), source("ambiguous"), { ...source("manual"), kind: "manual_entry" }]);
  await legacy.table("memberProblemStatus").bulkPut([
    status("old:A", "test:1", "qoj:A:legacy"), status("old:B", "test:2", "legacy-B"),
    status("unknown", "test:3", "ambiguous"), status("manual", "test:4", "manual", "manual"),
  ]);
  await legacy.table("appSettings").put({ key: "allow_medal_estimates", value: false });
  legacy.close();
}

/** Starts a CF import whose fetch blocks until `release` is called. */
async function startBlockedCfImport(payload: { memberId: string; handle: string }) {
  let release!: (value: unknown) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  vi.stubGlobal("fetch", async () => { started(); return new Promise((resolve) => { release = resolve; }); });
  const pending = importCodeforcesMember(payload);
  pending.catch(() => {});
  await entered;
  return { pending, release: (value: unknown) => release(value) };
}

// Steps share one database and run in order, like the original script.
describe("member data integrity", () => {
  let backup: any;
  beforeAll(async () => {
    await seedLegacyV6();
    await localDb.open();
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await localDb.delete();
  });

  it("migrates v6 to v7 with explicit legacy ownership, ambiguous retention and manual isolation", async () => {
    expect(localDb.verno).toBe(7);
    const migrated = await localDb.memberProblemStatus.toArray();
    expect(migrated, "migration must not drop legacy evidence").toHaveLength(4);
    expect(migrated.find((s) => s.problemId === "test:1")!.handleId).toBe("qoj:A");
    expect(migrated.find((s) => s.problemId === "test:2")!.handleId, "raw metadata can identify a nonstandard source ID").toBe("qoj:B");
    expect((await localDb.memberProblemStatus.get("unknown"))!.handleId, "ambiguous evidence must not be guessed").toBeUndefined();
    expect((await localDb.appSettings.get("allow_medal_estimates"))!.value).toBe(false);
    expect((await localDb.members.get("alice"))!.identityRevision).toBeTruthy();
    await db.softDeleteMemberHandle("qoj:A");
    expect((await db.listMemberPeopleFromDb())[0].solvedCount, "B, unknown legacy and manual evidence remain").toBe(3);
    await db.softDeleteMemberHandle("qoj:B");
    expect((await db.listMemberPeopleFromDb())[0].solvedCount, "manual evidence remains after final provider unlink").toBe(1);
  });

  it("scopes overlapping/disjoint status per account through unlink and backup round-trip", async () => {
    await clear();
    await importQoj("alice", "A", ["1", "3"]);
    await importQoj("alice", "B", ["2", "3"], ["4"]);
    const before = await db.listMemberHandleProblemCountsFromDb("alice");
    expect(before["qoj:A"].solvedCount).toBe(2);
    expect(before["qoj:B"].solvedCount, "overlapping solved evidence belongs to both accounts").toBe(2);
    await db.softDeleteMemberHandle("qoj:A");
    const person = (await db.listMemberPeopleFromDb())[0];
    expect(person.solvedCount).toBe(2);
    expect(person.attemptedCount).toBe(1);
    expect((await localDb.memberProblemStatus.toArray()).map((s) => s.handleId)).toStrictEqual(["qoj:B", "qoj:B", "qoj:B"]);
    const roundTrip = await db.exportLocalRuntimeSnapshot();
    await db.applyLocalRuntimeSnapshot(roundTrip, { mode: "replace" });
    expect((await db.listMemberPeopleFromDb())[0].solvedCount).toBe(2);
  });

  it("rejects conflicting full/members-only merges atomically; explicit replace remains available", async () => {
    await clear();
    await importQoj("bob", "shared", ["2"]);
    backup = await db.exportLocalRuntimeSnapshot();
    await clear();
    await importQoj("alice", "shared", ["1"]);
    for (const includeProblemStatus of [true, false]) {
      const before = await contents();
      await expect(db.applyLocalRuntimeSnapshot(backup, { mode: "merge", includeProblemStatus } as any)).rejects.toThrow(/已绑定其他成员/);
      expect(await contents(), "conflicting merge must roll back every store").toBe(before);
    }
    await db.applyLocalRuntimeSnapshot(backup, { mode: "replace" });
    expect((await localDb.memberHandles.get("qoj:shared"))!.memberId, "explicit replace remains supported").toBe("bob");
  });

  const invalidEdits: Array<[string, (data: any) => void]> = [
    ["missing displayName", (data) => { delete data.members[0].displayName; }],
    ["unknown schemaVersion", (data) => { data.schemaVersion = 2; }],
    ["wrong exportKind", (data) => { data.exportKind = "local_catalog_snapshot"; }],
    ["null members", (data) => { data.members = null; }],
    ["duplicate member", (data) => { data.members.push({ ...data.members[0] }); }],
    ["handle of missing member", (data) => { data.memberHandles[0].memberId = "missing"; }],
    ["duplicate account under another ID", (data) => { data.memberHandles.push({ ...data.memberHandles[0], handleId: "different-id" }); }],
    ["invalid status", (data) => { data.memberProblemStatus[0].status = "unseen"; }],
    ["status of missing member", (data) => { data.memberProblemStatus[0].memberId = "missing"; }],
    ["status of missing handle", (data) => { data.memberProblemStatus[0].handleId = "missing"; }],
    ["status of missing source", (data) => { data.memberProblemStatus[0].sourceRecordId = "missing"; }],
    ["invalid date", (data) => { data.members[0].createdAt = "not a date"; }],
    ["invalid app setting", (data) => { data.app_settings = { allow_medal_estimates: "yes" }; }],
    ["null sync summary", (data) => { data.syncRecords[0].summaryJson = null; }],
    ["unknown import source kind", (data) => { data.importSources[0].kind = "unknown"; }],
  ];
  it.each(invalidEdits)("rejects a malformed backup (%s) without mutating any table", async (_name, edit) => {
    const data = structuredClone(backup);
    edit(data);
    const before = await contents();
    await expect(db.applyLocalRuntimeSnapshot(data, { mode: "merge" })).rejects.toThrow();
    await expect(db.applyLocalRuntimeSnapshot(data, { mode: "replace" })).rejects.toThrow();
    expect(await contents(), "invalid files must not mutate any table").toBe(before);
  });

  it("accepts v1 backups and validates them against the JSON Schema", async () => {
    const oldBackup = structuredClone(backup);
    for (const row of oldBackup.memberProblemStatus) { delete row.handleId; row.statusId = `${row.memberId}:${row.problemId}:${row.provider}`; }
    for (const row of [...oldBackup.members, ...oldBackup.memberHandles]) delete row.identityRevision;
    await db.applyLocalRuntimeSnapshot(oldBackup, { mode: "replace" });
    expect((await localDb.memberProblemStatus.toArray())[0].handleId).toBe("qoj:shared");
    const fixture = readRepoJson("fixtures/imports/local-runtime/legacy-member-backup.json");
    const schema = readRepoJson("schemas/local-runtime-snapshot.schema.json");
    const validate = new Ajv({ strict: true }).compile(schema);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(backup), JSON.stringify(validate.errors)).toBe(true);
    await db.applyLocalRuntimeSnapshot(fixture, { mode: "replace" });
    expect((await localDb.memberProblemStatus.toArray())[0].handleId).toBe("qoj:fixture-account");
  });

  it.each(["member", "handle", "rebind"])("rejects a stale CF reply after a manual %s change", async (action) => {
    vi.stubGlobal("navigator", undefined);
    await clear();
    await localDb.members.put(member("alice"));
    await localDb.memberHandles.put(handle("alice", "cf", "codeforces"));
    const run = await startBlockedCfImport({ memberId: "alice", handle: "cf" });
    if (action === "member") await db.softDeleteMember("alice");
    else await db.softDeleteMemberHandle("codeforces:cf");
    if (action === "rebind") {
      // Simulate a new incarnation with identical timestamps, to prove that
      // generation checks—not clock resolution—protect against stale replies.
      const account = await localDb.memberHandles.get("codeforces:cf");
      await localDb.memberHandles.put({ ...account!, deletedAt: null, identityRevision: crypto.randomUUID() });
    }
    run.release(okSubmission());
    await expect(run.pending).rejects.toThrow(removedOrReplaced);
    expect(await localDb.memberProblemStatus.count()).toBe(0);
    if (action === "member") expect((await localDb.members.get("alice"))!.deletedAt).toBeTruthy();
    if (action === "handle") expect((await localDb.memberHandles.get("codeforces:cf"))!.deletedAt).toBeTruthy();
  });

  it.each(["merge", "replace"] as const)("does not export generations or revive stale sync authority via %s restore", async (mode) => {
    vi.stubGlobal("navigator", undefined);
    await clear();
    await localDb.members.put(member("alice"));
    await localDb.memberHandles.put(handle("alice", "cf", "codeforces"));
    await db.captureMemberSyncGuard("alice", "codeforces", "cf");
    const snapshot: any = await db.exportLocalRuntimeSnapshot();
    expect(snapshot.members[0].identityRevision, "local generations must not be exported").toBeUndefined();
    expect(snapshot.memberHandles[0].identityRevision).toBeUndefined();
    // Even a backup made by an interim/third-party version must not be able to
    // roll a local generation back to a token held by a stale request.
    snapshot.members[0].identityRevision = (await localDb.members.get("alice"))!.identityRevision;
    snapshot.memberHandles[0].identityRevision = (await localDb.memberHandles.get("codeforces:cf"))!.identityRevision;
    const run = await startBlockedCfImport({ memberId: "alice", handle: "cf" });
    await db.softDeleteMemberHandle("codeforces:cf");
    await db.applyLocalRuntimeSnapshot(snapshot, { mode });
    run.release(okSubmission());
    await expect(run.pending).rejects.toThrow(removedOrReplaced);
    expect(await localDb.memberProblemStatus.count(), "restoring an old backup must not revive stale sync authority").toBe(0);
  });

  it("cancels queued bulk targets deleted mid-run and keeps update-only imports strict", async () => {
    vi.stubGlobal("navigator", undefined);
    await clear();
    await localDb.members.bulkPut([member("alice"), member("bob")]);
    await localDb.memberHandles.bulkPut([handle("alice", "alice", "codeforces"), handle("bob", "bob", "codeforces")]);
    let releaseFirst!: () => void;
    let startedFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { startedFirst = resolve; });
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const account = new URL(url).searchParams.get("handle")!;
      requested.push(account);
      if (account === "alice") { startedFirst(); await new Promise<void>((resolve) => { releaseFirst = resolve; }); }
      return cfReply([]);
    });
    const batch = syncAllCodeforcesMembers();
    await firstEntered;
    await db.softDeleteMember("bob");
    releaseFirst();
    const result = await batch;
    expect(result.cancelled).toBe(true);
    expect(requested).toStrictEqual(["alice"]);
    expect((await localDb.members.get("bob"))!.deletedAt, "queued bulk target must stay deleted").toBeTruthy();
    await expect(importCodeforcesMember({ memberId: "bob", handle: "bob" }, { requireExisting: true } as any)).rejects.toThrow(/removed/);
  });

  it("does not recreate a target deleted while its sync was queued behind another tab's lock", async () => {
    await clear();
    await localDb.members.put(member("alice"));
    await localDb.memberHandles.put(handle("alice", "cf", "codeforces"));
    let releaseLock!: () => void;
    let enteredLock!: () => void;
    const lockEntered = new Promise<void>((resolve) => { enteredLock = resolve; });
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, run: (lock: unknown) => unknown) => {
      enteredLock();
      await new Promise<void>((resolve) => { releaseLock = resolve; });
      return run({});
    } } });
    vi.stubGlobal("fetch", async () => cfReply([]));
    const queued = importCodeforcesMember({ memberId: "alice", handle: "cf" });
    queued.catch(() => {});
    await lockEntered;
    await db.softDeleteMember("alice");
    releaseLock();
    await expect(queued).rejects.toThrow(/removed|replaced/);
    expect((await localDb.members.get("alice"))!.deletedAt, "a sync queued behind another tab must not recreate a deleted target").toBeTruthy();
  });

  it("keeps a stable identity across first CF import and a later QOJ import", async () => {
    vi.stubGlobal("navigator", undefined);
    await clear();
    vi.stubGlobal("fetch", async () => okSubmission());
    await importCodeforcesMember({ memberId: "new", handle: "new" });
    const first = await localDb.members.get("new");
    await importQoj("new", "qoj-new", ["2"]);
    expect((await localDb.members.get("new"))!.createdAt).toBe(first!.createdAt);
    expect((await localDb.members.get("new"))!.identityRevision).toBe(first!.identityRevision);
    expect((await db.listMemberPeopleFromDb())[0].solvedCount).toBe(2);
  });
});
