// Shared offline fixture: real Pinia stores/importers and disposable IndexedDB.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import 'fake-indexeddb/auto';
import {loadModule} from './validate-coverage.mjs';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {createPinia,setActivePinia}=require('pinia');
export async function until(predicate,message) {
  const deadline=Date.now()+4000;
  while(!await predicate()) {assert.ok(Date.now()<deadline,message);await new Promise(r=>setTimeout(r,2));}
}
export async function createQojFixture() {
  const globals=Object.fromEntries(['navigator','window','location','document','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const db=loadModule('web/src/lib/local-db.ts'),{localDb}=db;
  const problems=[1,2].map(id=>({problemId:`fixture:${id}`,contestId:'fixture',ordinal:String(id),title:`Problem ${id}`,sources:[{provider:'qoj',provider_problem_id:String(id)},{provider:'codeforces',provider_problem_id:`123:${id}`}]}));
  const state={mode:'hold',requests:[],held:[],holdHello:false,hellos:[],holdRecord:false,recordEntered:false,releaseRecord:null,catalog:async()=>problems,beforeLock:async()=>{}};
  const qoj=loadModule('web/src/lib/qoj.ts',{'./local-db':db,'./catalog-runtime':{listRuntimeCatalogProblemsForImport:()=>state.catalog()}});
  const listeners=new Set(),locks=new Set();
  const respond=(request,error)=>queueMicrotask(()=>{
    const data={protocol:'xcpc-sync',version:1,direction:'response',request_id:request.request_id,
      ...(error?{error:{code:error}}:{result:request.method==='hello'?{version:1,connected:true,script_version:'1.0.6'}:{provider:'qoj',handle:request.params.handle,fetched_at:new Date().toISOString(),snapshot:{scope:'profile_visible',solved:['1','2'],attempted:[]}}})};
    for(const listener of [...listeners])listener({source:windowMock,origin:'https://fixture.invalid',data});
  });
  const windowMock={
    addEventListener(type,listener){if(type==='message')listeners.add(listener);},
    removeEventListener(type,listener){if(type==='message')listeners.delete(listener);},
    postMessage(request){
      if(request.direction!=='request')return;
      if(request.method==='hello'){if(state.holdHello)state.hellos.push(request);else respond(request);}
      if(request.method==='syncMember') {
        state.requests.push(request);
        if(state.mode==='hold')state.held.push(request);else respond(request,state.mode==='success'?undefined:state.mode);
      }
    },
  };
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(name,_options,run)=>{
    await state.beforeLock(name);
    if(locks.has(name))return run(null);locks.add(name);
    try{return await run({});}finally{locks.delete(name);}
  }}}});
  globalThis.window=windowMock;globalThis.location={origin:'https://fixture.invalid'};globalThis.document={visibilityState:'visible'};globalThis.fetch=async()=>({ok:false});
  const feedback={current:null,show(value){this.current=value;}};
  const {useQojManualStore}=loadModule('web/src/stores/qoj-manual.ts',{'../lib/local-db':db,'../lib/qoj':qoj,'../lib/member-events':{emitMemberMutated(){}}});
  const {useQojSyncStore}=loadModule('web/src/stores/qoj-sync.ts',{
    '../lib/local-db':{...db,recordImportSyncAttempt:async input=>{
      if(state.holdRecord){state.recordEntered=true;await new Promise(r=>{state.releaseRecord=r;});}
      return db.recordImportSyncAttempt(input);
    }},'../lib/qoj':qoj,'../lib/member-events':{emitMemberMutated(){}},
    'vue-router':{useRouter:()=>({push(){}})},'./feedback':{useFeedbackStore:()=>feedback},
    './qoj-manual':{useQojManualStore},'../lib/codeforces':{importCodeforcesMember:async()=>{}},
  });
  let store,manual;
  const payload=(memberId='alice',handle='test',solved=['1'])=>({provider:'qoj',exported_at:new Date().toISOString(),members:[{member_id:memberId,handle,solved,attempted:[]}]});
  const reset=async()=>{
    assert.ok(!store?.busy&&!manual?.busy);store?.$dispose();manual?.$dispose();
    for(const table of localDb.tables)await table.clear();
    Object.assign(state,{mode:'hold',requests:[],held:[],holdHello:false,hellos:[],holdRecord:false,recordEntered:false,releaseRecord:null,catalog:async()=>problems,beforeLock:async()=>{}});
    feedback.current=null;setActivePinia(createPinia());store=useQojSyncStore();manual=useQojManualStore();store.enabled=true;store.useUserscript=true;
    await qoj.importQojUserscriptMembers(payload());
  };
  await localDb.open();await reset();
  return {
    db,localDb,qoj,state,problems,respond,payload,reset,get store(){return store;},get manual(){return manual;},
    bridgeRecords:async()=>(await localDb.syncRecords.toArray()).filter(r=>r.summaryJson.bridge),
    age:()=>localDb.syncRecords.toCollection().modify(r=>{r.startedAt=new Date(Date.parse(r.startedAt)-31*60000).toISOString();}),
    begin:async(manual=false)=>{const count=state.requests.length,pending=store.sync(manual);await until(()=>state.requests.length===count+1,'sync must reach the bridge');return {pending};},
    paused:async()=>{const count=state.requests.length;state.mode='success';await store.setEnabled(true);await until(()=>!store.busy,'enable check must settle');await store.sync(false,undefined,true);assert.equal(state.requests.length,count,'paused target must not retry on enable or focus');},
    close:async()=>{
      state.holdRecord=false;state.releaseRecord?.();store?.cancel();await until(()=>!store?.busy,'cleanup must settle');store?.$dispose();manual?.$dispose();await localDb.delete();
      for(const [key,descriptor] of Object.entries(globals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    },
  };
}
