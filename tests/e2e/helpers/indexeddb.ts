import type { Page } from '@playwright/test';

export type DatabaseAction =
  | { action: 'member'; data: { problemId: string } }
  | { action: 'clear'; data: { contestId: string } }
  | { action: 'spoiler'; data: { contestId: string; mode: 'spoiler' | 'non_spoiler' | string } };

/**
 * Writes directly to the app's IndexedDB (`xcpc_tracker_local`) without going
 * through app modules, so tests can seed state the way another tab would.
 */
export async function database(page: Page, { action, data }: DatabaseAction) {
  return page.evaluate(async ({ action, data }: any) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('xcpc_tracker_local'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const names = action === 'member' ? ['members', 'memberHandles', 'memberProblemStatus', 'syncRecords'] : ['contestPreferences'];
    await new Promise((resolve, reject) => {
      const tx = db.transaction(names, 'readwrite'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      if (action === 'member') {
        tx.objectStore('members').put({ memberId: 'test-member', displayName: 'Test member', createdAt: '2026-09-14', updatedAt: '2026-09-14' });
        tx.objectStore('memberHandles').put({ handleId: 'manual:test', memberId: 'test-member', provider: 'manual', handle: 'test', createdAt: '2026-09-14', updatedAt: '2026-09-14' });
        tx.objectStore('memberProblemStatus').put({ statusId: 'test-status', memberId: 'test-member', problemId: data.problemId, provider: 'manual', status: 'attempted', firstSeenAt: '2026-09-14', lastSeenAt: '2026-09-14', sourceRecordId: 'manual', matchMethod: 'manual' });
      } else if (action === 'clear') tx.objectStore('contestPreferences').delete(data.contestId);
      else tx.objectStore('contestPreferences').put({ contest_id: data.contestId, spoiler_mode: data.mode });
    });
    db.close();
  }, { action, data });
}

/** Reads every row of one object store directly from IndexedDB. */
export async function readStore<T = any>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(store => new Promise<any[]>((resolve, reject) => {
    const open = indexedDB.open('xcpc_tracker_local'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result; const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error); };
  }), store);
}
