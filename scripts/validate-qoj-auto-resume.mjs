import assert from 'node:assert/strict';
import {createQojFixture,until} from './qoj-test-fixture.mjs';
const f=await createQojFixture();
try {
  for(let cycle=0;cycle<3;cycle++) {
    const before=await f.localDb.memberProblemStatus.toArray();f.state.mode='hold';
    const {pending}=await f.begin();await f.store.setEnabled(false);await pending;
    const cancelled=(await f.bridgeRecords()).find(r=>r.summaryJson.error_code==='CANCELLED');assert.ok(cancelled);
    assert.deepEqual(await f.localDb.memberProblemStatus.toArray(),before);
    f.respond(f.state.held.at(-1));await new Promise(r=>setTimeout(r,0));
    assert.deepEqual(await f.localDb.memberProblemStatus.toArray(),before,'late responses cannot save data');
    assert.equal(f.store.useUserscript,true);await f.store.sync(false,undefined,true);
    assert.equal(f.state.requests.length,cycle*2+1,'disabled sync stays idle');
    f.state.mode='success';await f.store.setEnabled(true);await until(()=>!f.store.busy,'resumed run must settle');
    assert.equal(f.state.requests.length,cycle*2+2,'reenabling resumes the interrupted automatic request');
    assert.equal(cancelled.summaryJson.manual,false);assert.equal(cancelled.summaryJson.cancellation_reason,'settings_disabled');
    assert.equal(cancelled.summaryJson.retry_at,0);assert.equal(cancelled.summaryJson.failures,0);
    assert.equal((await f.bridgeRecords()).filter(r=>r.status==='succeeded').length,cycle+1);
    for(let n=0;n<3;n++)await f.store.sync(false,undefined,true);
    assert.equal(f.state.requests.length,cycle*2+2,'fresh recovery must not loop');await f.age();
  }
  console.log('PASS automatic off/on, repeated recovery, data preservation and no retry loop');
  for(const stop of [false,true]) {
    await f.reset();f.state.holdRecord=true;const {pending}=await f.begin();await f.store.setEnabled(false);
    await until(()=>f.state.recordEntered,'cancellation must reach persistence');f.state.mode='success';await f.store.setEnabled(true);
    assert.equal(f.state.requests.length,1,'reenable must not overlap cancellation');if(stop)f.store.cancel();
    f.state.holdRecord=false;f.state.releaseRecord();await pending;await until(()=>!f.store.busy,'pending recovery must settle');
    assert.equal(f.state.requests.length,stop?1:2);
    if(stop) {
      assert.equal((await f.bridgeRecords())[0].summaryJson.cancellation_reason,'user_cancelled');
      await f.age();await f.paused();await f.store.sync(true);assert.equal(f.state.requests.length,2);
    }
  }
  console.log('PASS rapid off/on during persistence; explicit Stop overrides queued and future recovery');
  await f.reset();const mode=await f.begin();await f.store.setUseUserscript(false);await mode.pending;
  assert.equal(f.store.enabled,false);assert.equal(f.store.useUserscript,false);
  assert.equal((await f.bridgeRecords())[0].summaryJson.cancellation_reason,'settings_disabled');
  await f.store.setUseUserscript(true);await f.store.sync(false);assert.equal(f.state.requests.length,1);
  f.state.mode='success';await f.store.setEnabled(true);await until(()=>!f.store.busy,'mode recovery must settle');assert.equal(f.state.requests.length,2);
  console.log('PASS script-mode disable pauses both settings and automatic reenable recovers');
  for(const manual of [false,true]) {
    await f.reset();const run=await f.begin(manual);f.store.cancel();await run.pending;
    assert.equal((await f.bridgeRecords())[0].summaryJson.cancellation_reason,'user_cancelled');
    await f.age();await f.paused();await f.store.sync(true);assert.equal(f.state.requests.length,2);
  }
  await f.reset();const manual=await f.begin(true);await f.store.setEnabled(false);await manual.pending;
  assert.equal((await f.bridgeRecords())[0].summaryJson.manual,true);await f.paused();
  for(const code of ['AUTH_REQUIRED','PARSE_ERROR','NETWORK_ERROR']) {
    await f.reset();f.state.mode=code;await f.store.sync(true);await f.age();await f.paused();
  }
  await f.reset();f.state.mode='NETWORK_ERROR';await f.store.sync(false);
  assert.ok((await f.bridgeRecords())[0].summaryJson.retry_at>Date.now());f.state.mode='success';await f.store.sync(false,undefined,true);assert.equal(f.state.requests.length,1);
  console.log('PASS explicit stop, manual failure policy and automatic error backoff');
  for(const stage of ['lock','hello']) {
    await f.reset();let entered=false,release;
    if(stage==='lock')f.state.beforeLock=async()=>{entered=true;await new Promise(r=>{release=r;});};
    else f.state.holdHello=true;
    const pending=f.store.sync(false);
    await until(()=>stage==='lock'?entered:f.state.hellos.length===1,'run must reach preflight gate');
    f.store.cancel();
    if(stage==='lock'){f.state.beforeLock=async()=>{};release();}
    else {f.state.holdHello=false;f.respond(f.state.hellos[0]);}
    await pending;
    assert.equal(f.state.requests.length,0,'Stop before RPC must not send an upstream request');
    assert.equal((await f.bridgeRecords())[0].summaryJson.cancellation_reason,'user_cancelled');
    await f.paused();await f.store.sync(true);assert.equal(f.state.requests.length,1,'explicit retry after preflight Stop remains available');
  }
  console.log('PASS explicit Stop during lock or hello preflight remains paused without making a request');
  await f.reset();f.state.mode='success';await f.store.sync(true);await f.qoj.linkQojMember('bob','second');
  let lockEntered=false,releaseLock;
  f.state.beforeLock=async()=>{lockEntered=true;await new Promise(r=>{releaseLock=r;});};
  const queued=f.store.sync(false);await until(()=>lockEntered,'mixed batch must reach lock');
  f.store.cancel();f.state.beforeLock=async()=>{};releaseLock();await queued;
  const stopped=(await f.bridgeRecords()).filter(r=>r.summaryJson.error_code==='CANCELLED');
  assert.deepEqual(stopped.map(r=>r.summaryJson.handle),['second'],'Stop applies to the next eligible target, skipping fresh Alice');
  assert.equal(f.state.requests.length,1);await f.paused();
  assert.equal(f.state.requests.length,1,'eligible Bob must remain paused on subsequent automatic checks');
  console.log('PASS preflight Stop selects the eligible account without poisoning fresh accounts');
  await f.reset();const removed=await f.begin();await f.db.softDeleteMember('alice');f.respond(f.state.held.at(-1));await removed.pending;
  assert.equal((await f.bridgeRecords())[0].summaryJson.cancellation_reason,'target_removed');await f.paused();
  assert.ok((await f.localDb.members.get('alice')).deletedAt);assert.equal(await f.localDb.memberProblemStatus.count(),0);
  await f.reset();const interrupted=await f.begin();await f.store.setEnabled(false);await interrupted.pending;await f.db.softDeleteMember('alice');await f.paused();
  assert.ok((await f.localDb.members.get('alice')).deletedAt);assert.equal(await f.localDb.memberProblemStatus.count(),0);
  await f.reset();const legacy=await f.begin();f.store.cancel();await legacy.pending;
  await f.localDb.syncRecords.toCollection().modify(r=>{delete r.summaryJson.cancellation_reason;});await f.age();await f.paused();
  console.log('PASS deleted targets stay deleted and legacy unknown-cause cancellation remains paused');
} finally {await f.close();}
