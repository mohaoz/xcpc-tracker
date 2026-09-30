import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import 'fake-indexeddb/auto';
import Ajv from 'ajv/dist/2020.js';
import {loadModule} from './validate-coverage.mjs';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const {default: Dexie} = require('dexie');
const at = '2026-09-30T00:00:00.000Z';
const member = id => ({memberId:id,displayName:id,createdAt:at,updatedAt:at});
const handle = (id, account, provider='qoj') => ({handleId:`${provider}:${account}`,memberId:id,provider,handle:account,displayLabel:null,createdAt:at,updatedAt:at});
const source = (id, account) => ({sourceRecordId:id,kind:'qoj_userscript_json',label:'Synthetic import',importedAt:at,rawMetaJson:account ? {handle:account} : {}});
const status = (id, problem, sourceRecordId, provider='qoj') => ({statusId:id,memberId:'alice',problemId:problem,provider,status:'solved',firstSeenAt:at,lastSeenAt:at,sourceRecordId,matchMethod:provider==='manual'?'manual':'provider_id'});
const problems = [1,2,3,4].map(n=>({problemId:`test:${n}`,contestId:'test',ordinal:String(n),title:`Problem ${n}`,sources:[{provider:'qoj',provider_problem_id:String(n)},{provider:'codeforces',provider_problem_id:`123:${n}`}]}));

// Open an actual v6 database first; exercising only fresh v7 databases would miss
// destructive upgrades and already-collapsed evidence from previous releases.
const legacy = new Dexie('xcpc_tracker_local');
legacy.version(6).stores({
  catalogContests:'contestId, deletedAt', catalogProblems:'problemId, contestId',
  members:'memberId, updatedAt, deletedAt', memberHandles:'handleId, memberId, [provider+handle], updatedAt, deletedAt',
  memberProblemStatus:'statusId, memberId, problemId, [memberId+problemId], [provider+problemId], lastSeenAt',
  importSources:'sourceRecordId, kind, importedAt', syncRecords:'syncId, adapter, startedAt, sourceRecordId',
  problemMatchCache:'cacheKey, [provider+externalRef], updatedAt', contestPreferences:'contest_id', appSettings:'key',
});
await legacy.open();
await legacy.table('members').put(member('alice'));
await legacy.table('memberHandles').bulkPut([handle('alice','A'),handle('alice','B')]);
await legacy.table('importSources').bulkPut([source('qoj:A:legacy','A'),source('legacy-B','B'),source('ambiguous'),{...source('manual'),kind:'manual_entry'}]);
await legacy.table('memberProblemStatus').bulkPut([
  status('old:A','test:1','qoj:A:legacy'),status('old:B','test:2','legacy-B'),status('unknown','test:3','ambiguous'),status('manual','test:4','manual','manual'),
]);
await legacy.table('appSettings').put({key:'allow_medal_estimates',value:false});
legacy.close();

const db = loadModule('web/src/lib/local-db.ts');
const {localDb} = db;
const qoj = loadModule('web/src/lib/qoj.ts', {'./local-db':db,'./catalog-runtime':{listRuntimeCatalogProblemsForImport:async()=>problems}});
const cf = loadModule('web/src/lib/codeforces.ts', {'./local-db':db,'./catalog-runtime':{listRuntimeCatalogProblemsForImport:async()=>problems},'./codeforces-auth':{loadCodeforcesApiCredentials:()=>null}});
const importQoj = (id, account, solved, attempted=[]) => qoj.importQojUserscriptMembers({provider:'qoj',exported_at:at,members:[{member_id:id,handle:account,solved,attempted}]});
const contents = async () => JSON.stringify(await Promise.all(localDb.tables.map(table=>table.toArray())));
const clear = async () => {for (const table of localDb.tables) await table.clear();};
const originalFetch = globalThis.fetch;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis,'navigator');
try {
  await localDb.open();
  assert.equal(localDb.verno,7);
  const migrated=await localDb.memberProblemStatus.toArray();
  assert.equal(migrated.length,4,'migration must not drop legacy evidence');
  assert.equal(migrated.find(s=>s.problemId==='test:1').handleId,'qoj:A');
  assert.equal(migrated.find(s=>s.problemId==='test:2').handleId,'qoj:B','raw metadata can identify a nonstandard source ID');
  assert.equal((await localDb.memberProblemStatus.get('unknown')).handleId,undefined,'ambiguous evidence must not be guessed');
  assert.equal((await localDb.appSettings.get('allow_medal_estimates')).value,false);
  assert.ok((await localDb.members.get('alice')).identityRevision);
  await db.softDeleteMemberHandle('qoj:A');
  assert.equal((await db.listMemberPeopleFromDb())[0].solvedCount,3,'B, unknown legacy and manual evidence remain');
  await db.softDeleteMemberHandle('qoj:B');
  assert.equal((await db.listMemberPeopleFromDb())[0].solvedCount,1,'manual evidence remains after final provider unlink');
  console.log('PASS v6→v7 migration, explicit legacy ownership, ambiguous retention and manual isolation');

  await clear();
  await importQoj('alice','A',['1','3']);
  await importQoj('alice','B',['2','3'],['4']);
  const before=await db.listMemberHandleProblemCountsFromDb('alice');
  assert.equal(before['qoj:A'].solvedCount,2);
  assert.equal(before['qoj:B'].solvedCount,2,'overlapping solved evidence belongs to both accounts');
  await db.softDeleteMemberHandle('qoj:A');
  const person=(await db.listMemberPeopleFromDb())[0];
  assert.equal(person.solvedCount,2); assert.equal(person.attemptedCount,1);
  assert.deepEqual((await localDb.memberProblemStatus.toArray()).map(s=>s.handleId),['qoj:B','qoj:B','qoj:B']);
  const roundTrip=await db.exportLocalRuntimeSnapshot();
  await db.applyLocalRuntimeSnapshot(roundTrip,{mode:'replace'});
  assert.equal((await db.listMemberPeopleFromDb())[0].solvedCount,2);
  console.log('PASS account-scoped overlap/disjoint status, unlink and current backup round-trip');

  await clear(); await importQoj('bob','shared',['2']);
  const backup=await db.exportLocalRuntimeSnapshot();
  await clear(); await importQoj('alice','shared',['1']);
  for (const includeProblemStatus of [true,false]) {
    const before=await contents();
    await assert.rejects(db.applyLocalRuntimeSnapshot(backup,{mode:'merge',includeProblemStatus}),/已绑定其他成员/);
    assert.equal(await contents(),before,'conflicting merge must roll back every store');
  }
  await db.applyLocalRuntimeSnapshot(backup,{mode:'replace'});
  assert.equal((await localDb.memberHandles.get('qoj:shared')).memberId,'bob','explicit replace remains supported');
  console.log('PASS conflict rejection in full/members-only merge; explicit replace remains available');

  const invalidEdits=[
    data=>{delete data.members[0].displayName;},
    data=>{data.schemaVersion=2;}, data=>{data.exportKind='local_catalog_snapshot';},
    data=>{data.members=null;},data=>{data.members.push({...data.members[0]});},
    data=>{data.memberHandles[0].memberId='missing';},data=>{data.memberHandles.push({...data.memberHandles[0],handleId:'different-id'});},
    data=>{data.memberProblemStatus[0].status='unseen';},data=>{data.memberProblemStatus[0].memberId='missing';},
    data=>{data.memberProblemStatus[0].handleId='missing';},data=>{data.memberProblemStatus[0].sourceRecordId='missing';},
    data=>{data.members[0].createdAt='not a date';},data=>{data.app_settings={allow_medal_estimates:'yes'};},
    data=>{data.syncRecords[0].summaryJson=null;},data=>{data.importSources[0].kind='unknown';},
  ];
  for(const edit of invalidEdits) {
    const data=structuredClone(backup);edit(data);const before=await contents();
    await assert.rejects(db.applyLocalRuntimeSnapshot(data,{mode:'merge'}));
    await assert.rejects(db.applyLocalRuntimeSnapshot(data,{mode:'replace'}));
    assert.equal(await contents(),before,'invalid files must not mutate any table');
  }
  const oldBackup=structuredClone(backup);
  for(const row of oldBackup.memberProblemStatus){delete row.handleId;row.statusId=`${row.memberId}:${row.problemId}:${row.provider}`;}
  for(const row of [...oldBackup.members,...oldBackup.memberHandles])delete row.identityRevision;
  await db.applyLocalRuntimeSnapshot(oldBackup,{mode:'replace'});
  assert.equal((await localDb.memberProblemStatus.toArray())[0].handleId,'qoj:shared');
  const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/imports/local-runtime/legacy-member-backup.json',import.meta.url),'utf8'));
  const schema=JSON.parse(fs.readFileSync(new URL('../schemas/local-runtime-snapshot.schema.json',import.meta.url),'utf8'));
  const validate=new Ajv({strict:true}).compile(schema);
  assert.ok(validate(fixture),JSON.stringify(validate.errors));
  assert.ok(validate(backup),JSON.stringify(validate.errors));
  await db.applyLocalRuntimeSnapshot(fixture,{mode:'replace'});
  assert.equal((await localDb.memberProblemStatus.toArray())[0].handleId,'qoj:fixture-account');
  console.log('PASS malformed-file atomic rejection, JSON Schema and v1 backup compatibility');

  Object.defineProperty(globalThis,'navigator',{configurable:true,value:undefined});
  for(const action of ['member','handle','rebind']) {
    await clear();
    await localDb.members.put(member('alice'));
    await localDb.memberHandles.put(handle('alice','cf','codeforces'));
    let release,started;
    const entered=new Promise(resolve=>started=resolve);
    globalThis.fetch=async()=>{started();return new Promise(resolve=>release=resolve);};
    const pending=cf.importCodeforcesMember({memberId:'alice',handle:'cf'});
    await entered;
    if(action==='member')await db.softDeleteMember('alice');
    else await db.softDeleteMemberHandle('codeforces:cf');
    if(action==='rebind') {
      // Simulate a new incarnation with identical timestamps, to prove that
      // generation checks—not clock resolution—protect against stale replies.
      const account=await localDb.memberHandles.get('codeforces:cf');
      await localDb.memberHandles.put({...account,deletedAt:null,identityRevision:crypto.randomUUID()});
    }
    release({ok:true,json:async()=>({status:'OK',result:[{id:1,verdict:'OK',problem:{contestId:123,index:'1'}}]})});
    await assert.rejects(pending,/removed|rebound|replaced/);
    assert.equal(await localDb.memberProblemStatus.count(),0);
    if(action==='member')assert.ok((await localDb.members.get('alice')).deletedAt);
    if(action==='handle')assert.ok((await localDb.memberHandles.get('codeforces:cf')).deletedAt);
  }
  for(const mode of ['merge','replace']) {
    await clear();
    await localDb.members.put(member('alice'));await localDb.memberHandles.put(handle('alice','cf','codeforces'));
    await db.captureMemberSyncGuard('alice','codeforces','cf');
    const backup=await db.exportLocalRuntimeSnapshot();
    assert.equal(backup.members[0].identityRevision,undefined,'local generations must not be exported');
    assert.equal(backup.memberHandles[0].identityRevision,undefined);
    // Even a backup made by an interim/third-party version must not be able to
    // roll a local generation back to a token held by a stale request.
    backup.members[0].identityRevision=(await localDb.members.get('alice')).identityRevision;
    backup.memberHandles[0].identityRevision=(await localDb.memberHandles.get('codeforces:cf')).identityRevision;
    let release,started;const entered=new Promise(resolve=>started=resolve);
    globalThis.fetch=async()=>{started();return new Promise(resolve=>release=resolve);};
    const pending=cf.importCodeforcesMember({memberId:'alice',handle:'cf'});
    await entered;await db.softDeleteMemberHandle('codeforces:cf');
    await db.applyLocalRuntimeSnapshot(backup,{mode});
    release({ok:true,json:async()=>({status:'OK',result:[{id:1,verdict:'OK',problem:{contestId:123,index:'1'}}]})});
    await assert.rejects(pending,/removed|rebound|replaced/);
    assert.equal(await localDb.memberProblemStatus.count(),0,'restoring an old backup must not revive stale sync authority');
  }
  await clear();
  await localDb.members.bulkPut([member('alice'),member('bob')]);
  await localDb.memberHandles.bulkPut([handle('alice','alice','codeforces'),handle('bob','bob','codeforces')]);
  let releaseFirst,startedFirst;const firstEntered=new Promise(resolve=>startedFirst=resolve);
  const requested=[];
  globalThis.fetch=async url=>{
    const account=new URL(url).searchParams.get('handle');requested.push(account);
    if(account==='alice'){startedFirst();await new Promise(resolve=>releaseFirst=resolve);}
    return {ok:true,json:async()=>({status:'OK',result:[]})};
  };
  const batch=cf.syncAllCodeforcesMembers();
  await firstEntered;await db.softDeleteMember('bob');releaseFirst();
  const result=await batch;
  assert.equal(result.cancelled,true);assert.deepEqual(requested,['alice']);
  assert.ok((await localDb.members.get('bob')).deletedAt,'queued bulk target must stay deleted');
  await assert.rejects(cf.importCodeforcesMember({memberId:'bob',handle:'bob'},{requireExisting:true}),/removed/);
  console.log('PASS backup generation isolation, queued bulk cancellation and update-only imports');

  await clear();
  await localDb.members.put(member('alice'));
  await localDb.memberHandles.put(handle('alice','cf','codeforces'));
  let releaseLock, enteredLock;
  const lockEntered=new Promise(resolve=>enteredLock=resolve);
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name,_options,run)=>{
    enteredLock();await new Promise(resolve=>releaseLock=resolve);return run({});
  }}}});
  globalThis.fetch=async()=>({ok:true,json:async()=>({status:'OK',result:[]})});
  const queued=cf.importCodeforcesMember({memberId:'alice',handle:'cf'});
  await lockEntered;await db.softDeleteMember('alice');releaseLock();
  await assert.rejects(queued,/removed|replaced/);
  assert.ok((await localDb.members.get('alice')).deletedAt,'a sync queued behind another tab must not recreate a deleted target');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:undefined});
  await clear();
  globalThis.fetch=async()=>({ok:true,json:async()=>({status:'OK',result:[{id:1,verdict:'OK',problem:{contestId:123,index:'1'}}]})});
  await cf.importCodeforcesMember({memberId:'new',handle:'new'});
  const first=await localDb.members.get('new');
  await importQoj('new','qoj-new',['2']);
  assert.equal((await localDb.members.get('new')).createdAt,first.createdAt);
  assert.equal((await localDb.members.get('new')).identityRevision,first.identityRevision);
  assert.equal((await db.listMemberPeopleFromDb())[0].solvedCount,2);
  console.log('PASS manual CF delete/unlink/rebind/queued-lock races, first import and stable cross-provider identity');
} finally {
  globalThis.fetch=originalFetch;
  if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;
  await localDb.delete();
}
