import assert from 'node:assert/strict';
import {loadModule} from './validate-coverage.mjs';
import {createQojFixture,until} from './qoj-test-fixture.mjs';
const f=await createQojFixture();
const isAbort=error=>error?.name==='AbortError';
function holdCatalog() {
  let entered=false,release;const ready=new Promise(r=>{release=r;});
  f.state.catalog=async()=>{entered=true;await ready;return f.problems;};
  return {entered:()=>entered,release};
}
async function changeIdentity(action) {
  if(action==='unlink'||action==='rebind')await f.db.softDeleteMemberHandle('qoj:test');
  else await f.db.softDeleteMember('alice');
  if(action==='recreate'||action==='rebind')await f.qoj.linkQojMember('alice','test');
}
async function stateWithoutHistory() {
  return JSON.stringify(await Promise.all([f.localDb.members.toArray(),f.localDb.memberHandles.toArray(),f.localDb.memberProblemStatus.toArray()]));
}
try {
  for(const action of ['delete','recreate','unlink','rebind']) {
    await f.reset();const catalog=holdCatalog();
    const pending=f.qoj.importQojUserscriptMembers(f.payload('alice','test',['2']));
    const rejected=assert.rejects(pending,isAbort);
    await until(catalog.entered,'raw import must wait after capturing identity');await changeIdentity(action);
    const before=await stateWithoutHistory();catalog.release();await rejected;
    assert.equal(await stateWithoutHistory(),before,'stale raw import must not change deleted/new identities');
  }
  console.log('PASS existing raw import guards deletion, same-name recreation, unlink and same-owner rebind');

  for(const stage of ['request','catalog'])for(const action of ['delete','recreate','unlink','rebind']) {
    await f.reset();const catalog=stage==='catalog'?holdCatalog():null;
    const {pending}=await f.begin(true);
    if(catalog){f.respond(f.state.held.at(-1));await until(catalog.entered,'bridge save must wait at catalog');}
    await changeIdentity(action);const before=await stateWithoutHistory();
    if(catalog)catalog.release();else f.respond(f.state.held.at(-1));
    await pending;assert.equal(await stateWithoutHistory(),before,'stale bridge response cannot recreate or modify a replacement');
    assert.equal((await f.bridgeRecords())[0].summaryJson.error_code,'CANCELLED');
    assert.equal((await f.bridgeRecords())[0].summaryJson.cancellation_reason,'target_removed');
  }
  console.log('PASS bridge guards before response and at save transaction, including re-created identities');

  for(const stage of ['export','catalog','lock']) {
    await f.reset();await f.manual.show([{memberId:'alice',handle:'test'}]);
    const catalog=stage==='catalog'?holdCatalog():null;let lockEntered=false,releaseLock;
    if(stage==='lock')f.state.beforeLock=async()=>{lockEntered=true;await new Promise(r=>{releaseLock=r;});};
    if(stage==='export')await changeIdentity('recreate');
    f.manual.input=JSON.stringify(f.payload('alice','test',['2']));const pending=f.manual.importJson();
    if(catalog)await until(catalog.entered,'manual import must reach catalog');
    if(stage==='lock')await until(()=>lockEntered,'manual import must enter lock');
    if(stage!=='export')await changeIdentity('recreate');
    const before=await stateWithoutHistory();catalog?.release();releaseLock?.();await pending;
    assert.match(f.manual.error,/账号已变更/);assert.equal(await stateWithoutHistory(),before);
  }
  console.log('PASS stale manual export, queued lock and catalog waits cannot target replacement identities');

  await f.reset();let lockEntered=false,releaseLock;
  f.state.beforeLock=async()=>{lockEntered=true;await new Promise(r=>{releaseLock=r;});};
  const queued=f.store.sync(true);await until(()=>lockEntered,'bridge must queue after identity capture');
  await changeIdentity('recreate');const queuedBefore=await stateWithoutHistory();releaseLock();await queued;
  assert.equal(f.state.requests.length,0);assert.equal(await stateWithoutHistory(),queuedBefore);
  assert.equal((await f.bridgeRecords())[0].summaryJson.error_code,'CANCELLED');

  await f.reset();await f.qoj.linkQojMember('bob','second');
  const batch=await f.begin(true);await f.db.softDeleteMember('bob');f.state.mode='success';f.respond(f.state.held.at(-1));await batch.pending;
  assert.deepEqual(f.state.requests.map(r=>r.params.handle),['test'],'deleted later batch target must never be requested');
  assert.ok((await f.localDb.members.get('bob')).deletedAt);
  assert.equal((await f.localDb.memberProblemStatus.where('memberId').equals('bob').count()),0);
  console.log('PASS bridge queue and later batch entries keep their original identities');

  for(const mode of ['merge','replace']) {
    await f.reset();const backup=await f.db.exportLocalRuntimeSnapshot();const run=await f.begin(true);
    await f.db.softDeleteMember('alice');await f.db.applyLocalRuntimeSnapshot(backup,{mode});
    const before=await stateWithoutHistory();f.respond(f.state.held.at(-1));await run.pending;
    assert.equal(await stateWithoutHistory(),before,'backup restore must not revive old sync authority');
  }
  await f.reset();const catalog=holdCatalog(),cancel=new AbortController();
  const pending=f.qoj.importQojUserscriptMembers(f.payload('alice','test',['2']),{requireExisting:true,signal:cancel.signal});
  const rejected=assert.rejects(pending,isAbort);await until(catalog.entered,'cancellable import must reach catalog');
  const before=await stateWithoutHistory();cancel.abort();catalog.release();await rejected;assert.equal(await stateWithoutHistory(),before);
  console.log('PASS backup restore generation isolation and cancellation during catalog loading');

  await f.reset();const old=(await f.localDb.members.get('alice')).identityRevision;await f.db.softDeleteMember('alice');
  await f.qoj.linkQojMember('alice','test');const restored=await f.localDb.members.get('alice');
  assert.ok(!restored.deletedAt);assert.notEqual(restored.identityRevision,old);
  await f.manual.show([{memberId:'alice',handle:'test'}]);f.manual.input=JSON.stringify(f.payload('alice','test',['2']));await f.manual.importJson();
  assert.equal(f.manual.error,'');assert.equal((await f.localDb.memberProblemStatus.toArray())[0].problemId,'fixture:2');
  await f.db.softDeleteMember('alice');await f.qoj.importQojUserscriptMembers(f.payload('alice','test',['1']));
  assert.ok(!(await f.localDb.members.get('alice')).deletedAt,'explicit raw import still restores deleted members');
  const cf=loadModule('web/src/lib/codeforces.ts',{'./local-db':f.db,'./catalog-runtime':{listRuntimeCatalogProblemsForImport:async()=>f.problems},'./codeforces-auth':{loadCodeforcesApiCredentials:()=>null}});
  await f.db.softDeleteMember('alice');
  globalThis.fetch=async()=>({ok:true,json:async()=>({status:'OK',result:[{id:1,verdict:'OK',problem:{contestId:123,index:'1'}}]})});
  await cf.importCodeforcesMember({memberId:'alice',handle:'cf'});
  assert.ok(!(await f.localDb.members.get('alice')).deletedAt,'explicit Add Member CF restore stays supported');
  assert.ok((await f.localDb.memberProblemStatus.toArray()).some(row=>row.provider==='codeforces'));
  await assert.rejects(f.qoj.importQojUserscriptMembers(f.payload('missing','missing'),{requireExisting:true}),isAbort);
  await assert.rejects(f.qoj.importQojUserscriptMembers({...f.payload(),members:[...f.payload().members,...f.payload('bob').members]}),/账号重复/);
  console.log('PASS explicit QOJ/CF add and restore, raw file restore, and strict refresh/duplicate guards');
} finally {await f.close();}
