// @vitest-environment node
import { liveQuery } from "dexie";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as db from "../../src/lib/local-db";
import { isAbortError } from "./helpers/async";

const { localDb } = db;
const at = "2026-09-30T00:00:00.000Z";
const member = { memberId: "alice", displayName: "Alice", createdAt: at, updatedAt: at } as any;
const contest = {
  contestId: "test", title: "Test", aliases: [], tags: [], sources: [], problemIds: ["test:A"], startAt: null,
  curationStatus: "reviewed", notes: null, generatedFrom: null,
} as any;
const problems = [{ problemId: "test:A", contestId: "test", ordinal: "A", title: "A", aliases: [], sources: [] }] as any[];

async function addMember(provider = "qoj") {
  const sourceRecordId = `synthetic:${crypto.randomUUID()}`;
  await db.upsertMemberBundle({
    member,
    handles: [{ handleId: `${provider}:alice`, memberId: member.memberId, provider, handle: "alice", displayLabel: null, createdAt: at, updatedAt: at }],
    statuses: [],
    importSource: { sourceRecordId, kind: "manual_entry", label: "Test", importedAt: at, rawMetaJson: {} },
    syncRecord: { syncId: sourceRecordId, sourceRecordId, adapter: "manual", startedAt: at, finishedAt: at, status: "succeeded", summaryJson: {} },
  } as any);
  return (await db.getContestCoverageForCatalog(contest, problems)).trackedMembers[0] as any;
}
const contents = async () => JSON.stringify(await Promise.all(localDb.tables.map((table) => table.toArray())));
const mark = (snapshot: any, status: "attempted" | "solved" | null = "attempted") =>
  db.upsertManualMemberProblemStatus({ memberId: snapshot.memberId, memberIdentityRevision: snapshot.identityRevision, problemId: "test:A", status } as any);
async function expectAbort(promise: Promise<unknown>) {
  const error = await promise.then(() => { throw new Error("expected AbortError"); }, (caught) => caught);
  expect(isAbortError(error), String(error)).toBe(true);
}

/** Subscribes to a real Dexie liveQuery and waits for matching emissions. */
function observe<T>(query: () => Promise<T>) {
  let latest: T | undefined;
  const listeners = new Set<(value: T) => void>();
  const subscription = liveQuery(query).subscribe({
    next(value) { latest = value; for (const listener of listeners) listener(value); },
    error(error) { throw error; },
  });
  return {
    subscription,
    until(predicate: (value: T) => boolean): Promise<T> {
      if (latest && predicate(latest)) return Promise.resolve(latest);
      return new Promise((resolve, reject) => {
        const listener = (value: T) => {
          if (!predicate(value)) return;
          clearTimeout(timeout); listeners.delete(listener); resolve(value);
        };
        const timeout = setTimeout(() => { listeners.delete(listener); reject(new Error("liveQuery did not refresh")); }, 2000);
        listeners.add(listener);
      });
    },
  };
}

// Steps share one database and run in order, like the original script.
describe("manual detail marks and identity", () => {
  let snapshot: any;
  beforeAll(async () => { await localDb.open(); });
  afterAll(async () => { await localDb.delete(); });

  it("supports normal manual set, solve and clear using the displayed identity revision", async () => {
    snapshot = await addMember();
    expect(snapshot.identityRevision, "coverage must carry the displayed identity revision").toBeTruthy();
    await mark(snapshot);
    expect(await db.getManualMemberProblemStatusFromDb("alice", "test:A", snapshot.identityRevision)).toBe("attempted");
    await mark(snapshot, "solved");
    await mark(snapshot, null);
    expect(await localDb.memberProblemStatus.count(), "normal manual set/solve/clear stays supported").toBe(0);
  });

  it("rejects marks for deleted members without writing evidence", async () => {
    await db.softDeleteMember("alice");
    const before = await contents();
    await expectAbort(mark(snapshot));
    await expectAbort(db.getManualMemberProblemStatusFromDb("alice", "test:A", snapshot.identityRevision));
    expect(await contents(), "deleted rows must not create status, import or sync evidence").toBe(before);
  });

  it.each(["codeforces", "qoj"])("explicit %s Add Member rotates identity and stale marks cannot touch the recreation", async (provider) => {
    const old = snapshot;
    snapshot = await addMember(provider);
    expect(snapshot.identityRevision, "explicit Add Member rotates identity even with identical timestamps").not.toBe(old.identityRevision);
    await mark(snapshot, "solved");
    const before = await contents();
    for (const status of ["attempted", "solved", null] as const) await expectAbort(mark(old, status));
    expect(await contents(), "stale sets and clears cannot mutate a recreated same-name member").toBe(before);
    await db.softDeleteMember("alice");
  });

  it("hard-missing members cannot receive orphan evidence", async () => {
    await localDb.members.delete("alice");
    const before = await contents();
    await expectAbort(mark(snapshot));
    expect(await contents(), "hard-missing members also cannot receive orphan evidence").toBe(before);
  });

  // Existing v7 stores may contain old records without a revision. They remain
  // usable, but a new incarnation must never inherit their undefined token.
  it("legacy rows without a revision stay usable but cannot target a new incarnation", async () => {
    await localDb.members.put(member);
    const legacy = await db.getMemberPersonFromDb("alice");
    expect(legacy!.identityRevision).toBeUndefined();
    await mark(legacy);
    await db.softDeleteMember("alice");
    snapshot = await addMember();
    const before = await contents();
    await expectAbort(mark(legacy));
    expect(await contents()).toBe(before);
  });

  // A delete/recreate transaction queued ahead of the mark must win; checking
  // only before opening the write transaction would accept this stale target.
  it("a queued delete/recreate transaction wins over a later mark", async () => {
    const pendingRecreate = localDb.transaction("rw", localDb.members, localDb.memberHandles, localDb.memberProblemStatus, async () => {
      await db.softDeleteMember("alice");
      await localDb.members.put({ ...member, identityRevision: crypto.randomUUID() });
    });
    const pendingMark = mark(snapshot);
    await pendingRecreate;
    await expectAbort(pendingMark);
    expect(await localDb.memberProblemStatus.count()).toBe(0);
  });

  it("actual Dexie liveQuery refreshes on independent connection writes", async () => {
    const otherConnection = new (localDb.constructor as new () => typeof localDb)();
    const coverageObserver = observe(() => db.getContestCoverageForCatalog(contest, problems) as Promise<any>);
    const memberObserver = observe(() => localDb.transaction("r", localDb.members, localDb.memberHandles, localDb.memberProblemStatus,
      () => Promise.all([db.getMemberPersonFromDb("alice"), db.listMemberHandleProblemCountsFromDb("alice")]),
    ) as Promise<[any, Record<string, any>]>);
    try {
      await coverageObserver.until((value) => value.freshProblemCount === 1);
      await memberObserver.until(([person]) => person?.solvedCount === 0);
      const current = await localDb.members.get("alice");
      await otherConnection.memberHandles.put({ handleId: "qoj:live", memberId: "alice", provider: "qoj", handle: "live", displayLabel: null, createdAt: at, updatedAt: at } as any);
      await otherConnection.memberProblemStatus.put({ statusId: "live-status", memberId: "alice", handleId: "qoj:live", problemId: "test:A", provider: "qoj", status: "solved", firstSeenAt: at, lastSeenAt: at, sourceRecordId: "live", matchMethod: "provider_id" } as any);
      await coverageObserver.until((value) => value.problems[0].members[0].status === "solved");
      await memberObserver.until(([person, counts]) => person?.solvedCount === 1 && counts["qoj:live"]?.solvedCount === 1);
      await otherConnection.memberHandles.update("qoj:live", { deletedAt: at });
      await coverageObserver.until((value) => value.freshProblemCount === 1);
      await memberObserver.until(([person, counts]) => person?.solvedCount === 0 && !counts["qoj:live"]);
      await otherConnection.members.update("alice", { deletedAt: at });
      await coverageObserver.until((value) => value.trackedMembers.length === 0);
      await memberObserver.until(([person]) => person === null);
      await otherConnection.transaction("rw", otherConnection.members, otherConnection.memberProblemStatus, async () => {
        await otherConnection.memberProblemStatus.where("memberId").equals("alice").delete();
        await otherConnection.members.put({ ...current!, displayName: "Replacement Alice", identityRevision: crypto.randomUUID(), deletedAt: null });
      });
      await coverageObserver.until((value) => value.trackedMembers[0]?.displayName === "Replacement Alice" && value.trackedMembers[0].identityRevision !== current!.identityRevision);
      await memberObserver.until(([person]) => person?.displayName === "Replacement Alice" && person.solvedCount === 0);
    } finally {
      coverageObserver.subscription.unsubscribe();
      memberObserver.subscription.unsubscribe();
      otherConnection.close();
    }
  });
});
