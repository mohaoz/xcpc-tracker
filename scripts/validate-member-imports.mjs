import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import 'fake-indexeddb/auto';
import {loadModule} from './validate-coverage.mjs';

const dbModule=loadModule('web/src/lib/local-db.ts');
const {localDb,applyLocalRuntimeSnapshot,exportLocalRuntimeSnapshot}=dbModule;
const example=JSON.parse(await readFile(new URL('../fixtures/imports/member-backup.example.json',import.meta.url),'utf8'));
const originalFetch=globalThis.fetch;
const problem={problemId:'example:A',contestId:'example',ordinal:'A',title:'A',sources:[{provider:'codeforces',provider_problem_id:'100000:A'},{provider:'qoj',provider_problem_id:'1'}]};
const overrides={'./local-db':dbModule,'./catalog-runtime':{listRuntimeCatalogProblemsForImport:async()=>[problem]}};
const cf=loadModule('web/src/lib/codeforces.ts',overrides);
const qoj=loadModule('web/src/lib/qoj.ts',overrides);
const contents=async()=>JSON.stringify(await Promise.all(['members','memberHandles','memberProblemStatus','importSources','syncRecords','contestPreferences','appSettings'].map(table=>localDb[table].toArray())));
try {
  await localDb.open();
  await applyLocalRuntimeSnapshot(example);
  globalThis.fetch=async()=>({ok:true,json:async()=>({status:'OK',result:[{id:1,verdict:'OK',problem:{contestId:100000,index:'A'}}]})});
  await cf.importCodeforcesMember({memberId:'example-member',handle:'example'});
  const member=await localDb.members.get('example-member');
  assert.equal(member.displayName,'示例成员');
  await localDb.memberHandles.update('codeforces:example',{displayLabel:'手动账号名'});
  await cf.importCodeforcesMember({memberId:'example-member',handle:'example',displayName:'远端名称'});
  assert.equal((await localDb.members.get('example-member')).displayName,'示例成员');
  assert.equal((await localDb.memberHandles.get('codeforces:example')).displayLabel,'手动账号名');
  const qojPayload={provider:'qoj',exported_at:new Date().toISOString(),members:[{member_id:'example-member',handle:'qoj-example',solved:['1'],attempted:[]}]};
  await qoj.importQojUserscriptMembers(qojPayload);
  const before=await contents();
  await assert.rejects(qoj.importQojUserscriptMembers({...qojPayload,members:[qojPayload.members[0],{handle:'bad'}]}),/做题记录/);
  assert.equal(await contents(),before,'Validate the entire QOJ payload before writing its first member');
  await localDb.memberHandles.update('qoj:qoj-example',{displayLabel:'手动 QOJ 名称'});
  await qoj.importQojUserscriptMembers({...qojPayload,members:[{...qojPayload.members[0],display_name:'同步名称'}]});
  assert.equal((await localDb.members.get('example-member')).displayName,'示例成员');
  assert.equal((await localDb.memberHandles.get('qoj:qoj-example')).displayLabel,'手动 QOJ 名称');

  // The first row could succeed on its own; a later ownership/write failure must
  // roll it back along with history. Capture must not initialize identities early.
  await localDb.members.update('example-member',{identityRevision:undefined});
  await localDb.memberHandles.update('qoj:qoj-example',{identityRevision:undefined});
  const batch={...qojPayload,members:[
    {...qojPayload.members[0],solved:[],attempted:['1']},
    {member_id:'second',handle:'second',solved:['1'],attempted:[]},
  ]};
  const rejectUnchanged=async(action,pattern)=>{
    const before=await contents();
    await assert.rejects(action(),pattern);
    assert.equal(await contents(),before,'Failed import must roll back every table');
  };
  await rejectUnchanged(()=>qoj.importQojUserscriptMembers({...batch,members:[
    batch.members[1],{...batch.members[0],member_id:'wrong-owner'},
  ]}),/已绑定其他成员/);
  const failSecond=(_key,row)=>{if(row.summaryJson.member_id==='second')throw new Error('injected write failure');};
  localDb.syncRecords.hook('creating',failSecond);
  try {await rejectUnchanged(()=>qoj.importQojUserscriptMembers(batch),/injected write failure/);}
  finally {localDb.syncRecords.hook('creating').unsubscribe(failSecond);}
  const cancel=new AbortController();
  await rejectUnchanged(()=>qoj.importQojUserscriptMembers(batch,{
    signal:cancel.signal,onProgress:({currentIndex})=>{if(currentIndex===2)cancel.abort();},
  }),error=>error.name==='AbortError');
  await qoj.importQojUserscriptMembers({...batch,members:[batch.members[0],{...batch.members[1],member_id:'example-member'}]});
  assert.equal((await localDb.memberHandles.get('qoj:second')).memberId,'example-member','Multiple accounts of one legacy identity can commit together');

  const previousStatus=await localDb.memberProblemStatus.where('handleId').equals('qoj:qoj-example').toArray();
  const mixed=await qoj.importQojUserscriptMembers({...batch,members:[{...batch.members[1],member_id:'example-member'}],
    fetch_failures:[{member_id:'example-member',handle:'qoj-example',error:'登录失效'}]});
  assert.equal(mixed.memberCount,1);assert.equal(mixed.fetchFailureCount,1);
  assert.deepEqual(await localDb.memberProblemStatus.where('handleId').equals('qoj:qoj-example').toArray(),previousStatus);
  assert.ok((await localDb.syncRecords.toArray()).some(row=>row.status==='failed' && row.summaryJson.fetch_error==='登录失效'));

  // A storage failure after clearing tables must also restore the old backup data.
  const failRestore=()=>{throw new Error('injected restore failure');};
  localDb.members.hook('creating',failRestore);
  try {await rejectUnchanged(()=>applyLocalRuntimeSnapshot(example,{mode:'replace'}),/injected restore failure/);}
  finally {localDb.members.hook('creating').unsubscribe(failRestore);}
  const backup=await exportLocalRuntimeSnapshot();
  await applyLocalRuntimeSnapshot(backup,{mode:'replace'});
  assert.deepEqual(await exportLocalRuntimeSnapshot().then(({exportedAt,...rest})=>rest),
    (({exportedAt,...rest})=>rest)(backup));
  console.log('Member import supplements passed: CF/QOJ name preservation, whole-batch rollback/cancellation, failed-fetch retention and backup write-failure recovery.');
} finally {globalThis.fetch=originalFetch;await localDb.delete();}
