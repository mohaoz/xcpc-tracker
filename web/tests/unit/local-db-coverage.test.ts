import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listContestCoverageSummariesForCatalog, localDb, subscribeCoverageDataMutated } from "../../src/lib/local-db";
import { contest, coverageRecords } from "./fixtures/coverage";

async function seed() {
  const records = coverageRecords();
  await localDb.transaction("rw", localDb.members, localDb.memberHandles, localDb.memberProblemStatus, async () => {
    await localDb.members.bulkPut(records.members);
    await localDb.memberHandles.bulkPut(records.memberHandles);
    await localDb.memberProblemStatus.bulkPut(records.memberProblemStatus.map((row, index) => ({ ...row, statusId: `s${index}` })));
  });
}

/** Resolves after Dexie has delivered pending storage-mutation events. */
const flushMutations = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("local-db coverage reads", () => {
  beforeEach(async () => {
    await localDb.delete();
    await localDb.open();
  });

  it("reads each member table once for any number of contests", async () => {
    await seed();
    const spies = [localDb.members, localDb.memberHandles, localDb.memberProblemStatus].map((table) => vi.spyOn(table, "toArray"));
    await listContestCoverageSummariesForCatalog(Array.from({ length: 235 }, (_, i) => contest(`contest-${i}`, ["p1", "p2"])));
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("invalidates coverage only for member and catalog writes in this database", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCoverageDataMutated(listener);

    await localDb.syncRecords.put({ syncId: "sync-1" } as never);
    await flushMutations();
    expect(listener).not.toHaveBeenCalled();

    const other = new Dexie("other-db");
    other.version(1).stores({ members: "memberId" });
    await other.table("members").put({ memberId: "x" });
    await flushMutations();
    expect(listener).not.toHaveBeenCalled();

    await seed();
    await flushMutations();
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    await localDb.members.put({ memberId: "late" } as never);
    await flushMutations();
    expect(listener).not.toHaveBeenCalled();
    other.close();
  });
});
