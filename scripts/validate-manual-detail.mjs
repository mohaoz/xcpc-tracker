import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import 'fake-indexeddb/auto';
import { loadModule } from './validate-coverage.mjs';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const vue = require('vue');
const db = loadModule('web/src/lib/local-db.ts');
const { localDb } = db;
const at = '2026-09-30T00:00:00.000Z';
const member = { memberId: 'alice', displayName: 'Alice', createdAt: at, updatedAt: at };
const contest = { contestId: 'test', title: 'Test', aliases: [], tags: [], sources: [], problemIds: ['test:A'], startAt: null, curationStatus: 'reviewed', notes: null, generatedFrom: null };
const problems = [{ problemId: 'test:A', contestId: 'test', ordinal: 'A', title: 'A', aliases: [], sources: [] }];
async function addMember(provider = 'qoj') {
  const sourceRecordId = `synthetic:${crypto.randomUUID()}`;
  await db.upsertMemberBundle({
    member,
    handles: [{ handleId: `${provider}:alice`, memberId: member.memberId, provider, handle: 'alice', displayLabel: null, createdAt: at, updatedAt: at }],
    statuses: [],
    importSource: { sourceRecordId, kind: 'manual_entry', label: 'Test', importedAt: at, rawMetaJson: {} },
    syncRecord: { syncId: sourceRecordId, sourceRecordId, adapter: 'manual', startedAt: at, finishedAt: at, status: 'succeeded', summaryJson: {} },
  });
  return (await db.getContestCoverageForCatalog(contest, problems)).trackedMembers[0];
}
const contents = async () => JSON.stringify(await Promise.all(localDb.tables.map(table => table.toArray())));
const mark = (snapshot, status = 'attempted') => db.upsertManualMemberProblemStatus({ memberId: snapshot.memberId, memberIdentityRevision: snapshot.identityRevision, problemId: 'test:A', status });
try {
  await localDb.open();
  let snapshot = await addMember();
  assert.ok(snapshot.identityRevision, 'coverage must carry the displayed identity revision');
  await mark(snapshot);
  assert.equal(await db.getManualMemberProblemStatusFromDb('alice', 'test:A', snapshot.identityRevision), 'attempted');
  await mark(snapshot, 'solved');
  await mark(snapshot, null);
  assert.equal(await localDb.memberProblemStatus.count(), 0, 'normal manual set/solve/clear stays supported');

  await db.softDeleteMember('alice');
  let before = await contents();
  await assert.rejects(mark(snapshot), { name: 'AbortError' });
  await assert.rejects(db.getManualMemberProblemStatusFromDb('alice', 'test:A', snapshot.identityRevision), { name: 'AbortError' });
  assert.equal(await contents(), before, 'deleted rows must not create status, import or sync evidence');
  for (const provider of ['codeforces', 'qoj']) {
    const old = snapshot;
    snapshot = await addMember(provider);
    assert.notEqual(snapshot.identityRevision, old.identityRevision, 'explicit Add Member rotates identity even with identical timestamps');
    await mark(snapshot, 'solved');
    before = await contents();
    for (const status of ['attempted', 'solved', null]) await assert.rejects(mark(old, status), { name: 'AbortError' });
    assert.equal(await contents(), before, 'stale sets and clears cannot mutate a recreated same-name member');
    await db.softDeleteMember('alice');
  }
  await localDb.members.delete('alice');
  before = await contents();
  await assert.rejects(mark(snapshot), { name: 'AbortError' });
  assert.equal(await contents(), before, 'hard-missing members also cannot receive orphan evidence');

  // Existing v7 stores may contain old records without a revision. They remain
  // usable, but a new incarnation must never inherit their undefined token.
  await localDb.members.put(member);
  const legacy = await db.getMemberPersonFromDb('alice');
  assert.equal(legacy.identityRevision, undefined);
  await mark(legacy);
  await db.softDeleteMember('alice');
  snapshot = await addMember();
  before = await contents();
  await assert.rejects(mark(legacy), { name: 'AbortError' });
  assert.equal(await contents(), before);

  // A delete/recreate transaction queued ahead of the mark must win; checking
  // only before opening the write transaction would accept this stale target.
  const pendingRecreate = localDb.transaction('rw', localDb.members, localDb.memberHandles, localDb.memberProblemStatus, async () => {
    await db.softDeleteMember('alice');
    await localDb.members.put({ ...member, identityRevision: crypto.randomUUID() });
  });
  const pendingMark = mark(snapshot);
  await pendingRecreate;
  await assert.rejects(pendingMark, { name: 'AbortError' });
  assert.equal(await localDb.memberProblemStatus.count(), 0);
  console.log('PASS manual snapshot identity, transactional no-write rejection, legacy rows, and explicit CF/QOJ recreation');

  const { liveQuery } = require('dexie');
  function observe(query) {
    let latest;
    const listeners = new Set();
    const subscription = liveQuery(query).subscribe({
      next(value) { latest = value; for (const listener of listeners) listener(value); },
      error(error) { throw error; },
    });
    return {
      subscription,
      until(predicate) {
        if (latest && predicate(latest)) return Promise.resolve(latest);
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { listeners.delete(listener); reject(new Error('liveQuery did not refresh')); }, 2000);
          const listener = value => {
            if (!predicate(value)) return;
            clearTimeout(timeout); listeners.delete(listener); resolve(value);
          };
          listeners.add(listener);
        });
      },
    };
  }
  const otherConnection = new localDb.constructor();
  const coverageObserver = observe(() => db.getContestCoverageForCatalog(contest, problems));
  const memberObserver = observe(() => localDb.transaction('r', localDb.members, localDb.memberHandles, localDb.memberProblemStatus,
    () => Promise.all([db.getMemberPersonFromDb('alice'), db.listMemberHandleProblemCountsFromDb('alice')]),
  ));
  try {
    await coverageObserver.until(value => value.freshProblemCount === 1);
    await memberObserver.until(([person]) => person?.solvedCount === 0);
    const current = await localDb.members.get('alice');
    await otherConnection.memberHandles.put({ handleId: 'qoj:live', memberId: 'alice', provider: 'qoj', handle: 'live', displayLabel: null, createdAt: at, updatedAt: at });
    await otherConnection.memberProblemStatus.put({ statusId: 'live-status', memberId: 'alice', handleId: 'qoj:live', problemId: 'test:A', provider: 'qoj', status: 'solved', firstSeenAt: at, lastSeenAt: at, sourceRecordId: 'live', matchMethod: 'provider_id' });
    await coverageObserver.until(value => value.problems[0].members[0].status === 'solved');
    await memberObserver.until(([person, counts]) => person?.solvedCount === 1 && counts['qoj:live']?.solvedCount === 1);
    await otherConnection.memberHandles.update('qoj:live', { deletedAt: at });
    await coverageObserver.until(value => value.freshProblemCount === 1);
    await memberObserver.until(([person, counts]) => person?.solvedCount === 0 && !counts['qoj:live']);
    await otherConnection.members.update('alice', { deletedAt: at });
    await coverageObserver.until(value => value.trackedMembers.length === 0);
    await memberObserver.until(([person]) => person === null);
    await otherConnection.transaction('rw', otherConnection.members, otherConnection.memberProblemStatus, async () => {
      await otherConnection.memberProblemStatus.where('memberId').equals('alice').delete();
      await otherConnection.members.put({ ...current, displayName: 'Replacement Alice', identityRevision: crypto.randomUUID(), deletedAt: null });
    });
    await coverageObserver.until(value => value.trackedMembers[0]?.displayName === 'Replacement Alice' && value.trackedMembers[0].identityRevision !== current.identityRevision);
    await memberObserver.until(([person]) => person?.displayName === 'Replacement Alice' && person.solvedCount === 0);
    console.log('PASS actual Dexie liveQuery on independent connection writes: status, account removal, member deletion and same-name recreation');
  } finally {
    coverageObserver.subscription.unsubscribe(); memberObserver.subscription.unsubscribe(); otherConnection.close();
  }

} finally {
  await localDb.delete();
}

// Exercise actual SFC setup in Vue, with deliberately late observable callbacks
// and async reads. Browser coverage separately verifies Dexie cross-tab delivery.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 16; i++) await vue.nextTick(); };
function mount(component) {
  let instance;
  component.render = () => { instance = vue.getCurrentInstance(); return vue.h('test'); };
  const renderer = vue.createRenderer({
    createElement: tag => ({ tag, children: [] }), createText: text => ({ text }), createComment: text => ({ text }),
    insert(node, parent) { parent.children.push(node); node.parent = parent; },
    remove(node) { const siblings = node.parent?.children; if (siblings) siblings.splice(siblings.indexOf(node), 1); },
    setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
    parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
  });
  const app = renderer.createApp(component);
  app.mount({ children: [] });
  return { app, get state() { return instance.setupState; } };
}
const subscriptions = [];
const fakeDexie = {
  liveQuery(query) {
    return { subscribe(observer) {
      const entry = { query, observer, closed: false };
      subscriptions.push(entry);
      // Intentionally retain the observer after unsubscribe to test view guards.
      return { unsubscribe() { entry.closed = true; } };
    } };
  },
};
const detail = id => ({ contest: { ...contest, contestId: id, title: id }, problems });
const matrix = id => ({ contest: detail(id).contest, trackedMembers: [{ memberId: 'alice', identityRevision: 'displayed-revision', displayName: 'Alice', handles: [] }], problemCount: 1, freshProblemCount: 1, problems: [{ problemId: 'test:A', ordinal: 'A', title: 'A', freshForTeam: true, members: [{ memberId: 'alice', displayName: 'Alice', status: 'unseen' }] }] });
const route = vue.reactive({ params: { contestId: 'first', memberId: 'alice' } });
let detailGate;
let readGate;
let readError;
let saveGate;
const writes = [];
const contestComponent = loadModule('web/src/views/ContestDetailView.vue', {
  dexie: fakeDexie,
  'vue-router': { useRoute: () => route, useRouter: () => ({ push: async () => {} }) },
  '../stores/settings': { useSettingsStore: () => ({ allowMedalEstimates: true }) },
  '../stores/spoilers': { useSpoilerStore: () => ({ visible: () => false }) },
  '../lib/member-events': { emitMemberMutated() {} },
  '../lib/catalog-events': { emitCatalogMutated() {} },
  '../lib/local-db': {
    replaceManualCatalogContest: async () => saveGate?.promise,
    getContestCoverageForCatalog: async record => matrix(record.contestId),
    getManualMemberProblemStatusFromDb: async (_id, _problem, revision) => {
      assert.equal(revision, 'displayed-revision');
      if (readError) throw readError;
      return readGate ? readGate.promise : null;
    },
    upsertManualMemberProblemStatus: async payload => { writes.push(payload); },
  },
  '../lib/catalog-runtime': {
    getRuntimeCatalogContestDetail: async id => detailGate ? detailGate.promise : detail(id),
    listRuntimeCatalogContests: async () => ({ contests: [contest] }),
  },
}).default;
const mountedContest = mount(contestComponent);
await settle();
let observation = subscriptions.at(-1);
observation.observer.next(matrix('first'));
assert.equal(mountedContest.state.contest.id, 'first');
mountedContest.state.markMode = true;
await mountedContest.state.applyMarkToCell('test:A', matrix('first').trackedMembers[0], 'unseen');
assert.equal(writes[0].memberIdentityRevision, 'displayed-revision', 'the write must use the rendered identity');
assert.equal(mountedContest.state.markSavingCellKey, '');
readError = Object.assign(new Error('Member removed or replaced'), { name: 'AbortError', inner: new DOMException('Member removed or replaced', 'AbortError') });
await mountedContest.state.applyMarkToCell('test:A', matrix('first').trackedMembers[0], 'unseen');
assert.match(mountedContest.state.error, /成员已删除/, 'Dexie-wrapped AbortError should show the friendly identity-change message');
assert.equal(mountedContest.state.markSavingCellKey, '', 'read errors must clear busy state');
assert.equal(writes.length, 1);
readError = null;
readGate = deferred();
const pendingMark = mountedContest.state.applyMarkToCell('test:A', matrix('first').trackedMembers[0], 'unseen');
route.params.contestId = 'second';
await settle();
assert.ok(observation.closed, 'route changes unsubscribe old coverage');
readGate.resolve(null);
await pendingMark;
assert.equal(writes.length, 1, 'navigation while reading a cell cancels its pending write');
readGate = null;
observation.observer.next(matrix('first'));
assert.equal(mountedContest.state.coverage, null, 'old coverage cannot flash into the next route');
observation = subscriptions.at(-1);
observation.observer.next(matrix('second'));
assert.equal(mountedContest.state.contest.id, 'second');
const slow = deferred();
detailGate = slow;
route.params.contestId = 'slow';
await settle();
detailGate = null;
route.params.contestId = 'third';
await settle();
const currentObservation = subscriptions.at(-1);
currentObservation.observer.next(matrix('third'));
const subscriptionCount = subscriptions.length;
slow.resolve(detail('slow'));
await settle();
assert.equal(subscriptions.length, subscriptionCount, 'late catalog reads must not resubscribe the old route');
assert.equal(mountedContest.state.contest.id, 'third');
saveGate = deferred();
const pendingSave = mountedContest.state.saveContestMetadata({ title: 'Edited third', aliases: [], tags: [], sources: [], notes: null });
assert.equal(mountedContest.state.saving, true);
mountedContest.app.unmount();
saveGate.resolve();
await pendingSave;
assert.equal(subscriptions.length, subscriptionCount, 'late metadata save must not restart observation after unmount');
assert.ok(currentObservation.closed);
currentObservation.observer.error(new Error('late error'));
currentObservation.observer.next(matrix('late'));
assert.equal(mountedContest.state.contest.id, 'third', 'unmounted detail ignores late results');

const memberComponent = loadModule('web/src/views/MemberDetailView.vue', {
  dexie: fakeDexie,
  'vue-router': { useRoute: () => route, useRouter: () => ({ push: async () => {} }), RouterLink: {} },
  '../lib/codeforces': { importCodeforcesMember: async () => {} },
  '../stores/qoj-sync': { useQojSyncStore: () => ({}) },
  '../lib/member-events': { emitMemberMutated() {} },
  '../lib/local-db': { localDb: {}, getMemberPersonFromDb: async () => null, listMemberHandleProblemCountsFromDb: async () => ({}) },
}).default;
const mountedMember = mount(memberComponent);
observation = subscriptions.at(-1);
observation.observer.next([{ memberId: 'alice', displayName: 'Alice', handles: [] }, { old: { solvedCount: 1 } }]);
assert.equal(mountedMember.state.person.memberId, 'alice');
route.params.memberId = 'bob';
await settle();
assert.ok(observation.closed);
observation.observer.next([{ memberId: 'alice' }, {}]);
assert.equal(mountedMember.state.person, null);
const memberObservation = subscriptions.at(-1);
memberObservation.observer.next([{ memberId: 'bob', handles: [] }, {}]);
assert.equal(mountedMember.state.person.memberId, 'bob');
memberObservation.observer.next([null, { orphan: { solvedCount: 5 } }]);
assert.equal(mountedMember.state.person, null);
assert.deepEqual(mountedMember.state.handleProblemCounts, {}, 'deleted members must not keep orphan handle counts');
assert.equal(mountedMember.state.error, 'member not found');
mountedMember.app.unmount();
assert.ok(memberObservation.closed);
memberObservation.observer.next([{ memberId: 'late' }, {}]);
assert.equal(mountedMember.state.person, null);
console.log('PASS detail lifecycle, displayed manual token, read-error handling, pending mark navigation, late catalog/observable results, and unmount cleanup');
