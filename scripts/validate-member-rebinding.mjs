import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { loadModule } from './validate-coverage.mjs';

const db = loadModule('web/src/lib/local-db.ts');
const { localDb, softDeleteMember, softDeleteMemberHandle } = db;
const problem = {problemId:'example:A',contestId:'example',ordinal:'A',title:'A',sources:[{provider:'qoj',provider_problem_id:'1'}]};
const qoj = loadModule('web/src/lib/qoj.ts', {
  './local-db':db,
  './catalog-runtime':{listRuntimeCatalogProblemsForImport:async()=>[problem]},
});
const importMember = memberId => qoj.importQojUserscriptMembers({
  provider:'qoj',exported_at:new Date().toISOString(),
  members:[{member_id:memberId,handle:'B',solved:['1'],attempted:[]}],
});
const contents = async () => JSON.stringify(await Promise.all(
  ['members','memberHandles','memberProblemStatus','importSources','syncRecords'].map(name=>localDb[name].toArray()),
));
try {
  await localDb.open();
  await qoj.linkQojMember('a','B');
  await importMember('a');
  await localDb.memberHandles.update('qoj:B',{displayLabel:'Old label',createdAt:'2020-01-01T00:00:00.000Z'});
  await softDeleteMember('a');
  await qoj.linkQojMember('b','B');
  const rebound = await localDb.memberHandles.get('qoj:B');
  assert.equal(rebound.memberId,'b');
  assert.equal(rebound.deletedAt,null);
  assert.equal(rebound.displayLabel,null);
  assert.notEqual(rebound.createdAt,'2020-01-01T00:00:00.000Z');
  assert.ok((await localDb.members.get('a')).deletedAt);
  assert.equal(await localDb.memberProblemStatus.count(),0);
  await importMember('b');
  assert.equal(await localDb.memberProblemStatus.where('memberId').equals('b').count(),1);
  const bound = await contents();
  await assert.rejects(qoj.linkQojMember('c','B'),/已绑定其他成员/);
  await assert.rejects(importMember('c'),/已绑定其他成员/);
  assert.equal(await contents(),bound,'Rejected bindings must not change data');

  await softDeleteMemberHandle('qoj:B');
  await importMember('c');
  assert.equal((await localDb.memberHandles.get('qoj:B')).memberId,'c');
  assert.equal(await localDb.memberProblemStatus.where('memberId').equals('b').count(),0);
  assert.equal((await localDb.memberHandles.get('qoj:B')).displayLabel,null);

  await localDb.memberHandles.put({...rebound,handleId:'custom-id',handle:'custom-account'});
  const custom = await contents();
  await assert.rejects(qoj.linkQojMember('c','custom-account'),/已绑定其他成员/);
  assert.equal(await contents(),custom,'Check account ownership even with a different record ID');
  console.log('Member rebinding passed: delete/re-add, unlink/import, old data isolation and active ownership protection.');
} finally {
  await localDb.delete();
}
