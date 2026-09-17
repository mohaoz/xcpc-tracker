import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {loadModule} from './validate-coverage.mjs';
const dbModule = loadModule('web/src/lib/local-db.ts');
const {localDb, applyLocalRuntimeSnapshot, exportLocalRuntimeSnapshot} = dbModule;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalFetch = globalThis.fetch;
const {ratingClass} = loadModule('web/src/lib/rating-colors.ts');
for (const [rating,color] of [[1199,'gray'],[1200,'green'],[1399,'green'],[1400,'cyan'],[1599,'cyan'],[1600,'blue'],[1899,'blue'],[1900,'violet'],[2099,'violet'],[2100,'orange'],[2399,'orange'],[2400,'red'],[2999,'red'],[3000,'legendary']]) assert.equal(ratingClass(rating),`rating--${color}`);
const {selectAwardCutoffs} = loadModule('web/src/lib/award-policy.ts');
const estimate = {source:'inferred_official_medal_ratio_10_20_30'};
const official = {source:'explicit'};
assert.equal(selectAwardCutoffs({awardCutoffs:estimate}),null);
assert.equal(selectAwardCutoffs({awardCutoffs:estimate},true),estimate);
assert.equal(selectAwardCutoffs({awardCutoffs:official,estimatedAwardCutoffs:estimate},true),official);
assert.equal(selectAwardCutoffs({estimatedAwardCutoffs:estimate},false),null);
assert.equal(selectAwardCutoffs({estimatedAwardCutoffs:estimate},true),estimate);
try {
  await localDb.open();
  assert.equal(await localDb.appSettings.get('allow_medal_estimates'),undefined);
  await localDb.appSettings.put({key:'allow_medal_estimates',value:true});
  await localDb.contestPreferences.put({contest_id:'c',spoiler_mode:'non_spoiler'});
  const snapshot = await exportLocalRuntimeSnapshot();
  assert.equal(snapshot.app_settings.allow_medal_estimates,true);
  await localDb.appSettings.clear();
  assert.deepEqual(snapshot.contest_preferences,[{contest_id:'c',spoiler_mode:'non_spoiler'}]);
  await localDb.contestPreferences.clear();
  await applyLocalRuntimeSnapshot(snapshot,{mode:'replace'});
  assert.equal((await localDb.appSettings.get('allow_medal_estimates')).value,true);
  assert.equal((await localDb.contestPreferences.get('c')).spoiler_mode,'non_spoiler');
  const bad = {...snapshot,contest_preferences:[{contest_id:'c',spoiler_mode:'invalid'}]};
  await assert.rejects(applyLocalRuntimeSnapshot(bad,{mode:'replace'}));
  assert.equal((await localDb.contestPreferences.get('c')).spoiler_mode,'non_spoiler');
  const cf = loadModule('web/src/lib/codeforces.ts', {
    './local-db': dbModule,
    './catalog-runtime': {listRuntimeCatalogProblemsForImport: async () => [{problemId:'c:A',contestId:'c',ordinal:'A',title:'Example',aliases:[],sources:[{provider:'codeforces',provider_problem_id:'100000:A'}]}]},
  });
  // Node 20 CI has no browser navigator. Exercise this even on newer Node.
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:undefined});
  let automaticRequests=0;
  globalThis.fetch=async()=>{automaticRequests++;throw new Error('Automatic sync must not run without Web Locks');};
  await cf.importCodeforcesMember({memberId:'m',handle:'example'},{automatic:true});
  assert.equal(automaticRequests,0);
  globalThis.fetch = async () => ({ok:true,json:async()=>({status:'OK',result:[{id:1,verdict:'WRONG_ANSWER',problem:{contestId:100000,index:'A'}},{id:2,verdict:'OK',problem:{contestId:100001,index:'B'}}]})});
  await cf.importCodeforcesMember({memberId:'m',handle:'example'});
  assert.equal((await localDb.memberProblemStatus.toArray())[0].status,'attempted');
  const success = (await localDb.syncRecords.toArray())[0];
  assert.equal(success.summaryJson.unmatched_status_count,1);
  assert.equal((await localDb.importSources.get(success.sourceRecordId)).rawMetaJson.unmatched_problem_statuses.length,1);
  globalThis.fetch = async () => {throw new Error('offline fixture failure');};
  await assert.rejects(cf.importCodeforcesMember({memberId:'m',handle:'example'}));
  assert.equal((await localDb.syncRecords.toArray()).filter(s=>s.status==='failed').length,1);
  assert.equal((await localDb.memberProblemStatus.toArray()).length,1,'Failure must preserve last successful status');
  console.log('VP state checks passed: persistent spoiler backup/restore, invalid import atomicity, CF unmatched provenance and failure retention.');
} finally {
  globalThis.fetch=originalFetch;
  if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);
  else delete globalThis.navigator;
  await localDb.delete();
}
