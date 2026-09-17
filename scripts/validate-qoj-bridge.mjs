// Offline tests: real userscript and app code, mocked QOJ transport, disposable browser storage.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.QOJ_TEST_BASE || 'http://localhost:5173';
const scriptResponse = await fetch(base + '/userscripts/qoj-sync.user.js');
assert.ok(scriptResponse.ok);
const source = await scriptResponse.text();
const browser = await chromium.launch({headless:true});
const html = '<h4 class="list-group-item-heading">Accepted problems: 1</h4><div><a href="/problem/1">1</a></div><h4 class="list-group-item-heading">Tried problems: 1</h4><div><a href="/problem/2">2</a></div>';
const good = {status:200,finalUrl:'https://qoj.ac/user/profile/test',responseText:html};
try {
  const context = await browser.newContext();
  let updateRequests=0;
  context.on('request',request=>{if(request.url().endsWith('/userscripts/qoj-sync.version.json')) updateRequests++;});
  await context.addInitScript(version => {
    window.GM_info = {script:{version}};
    window.unsafeWindow = window;
    window.probeRequests = 0;
    window.confirm = () => { throw new Error('Installed script must not ask for additional authorization'); };
    window.GM_xmlhttpRequest = options => {
      window.probeRequests++;
      const fixture = window.probeFixture;
      const timer = setTimeout(() => {
        if (fixture.callback) options[fixture.callback](); else options.onload(fixture);
      }, fixture.delay || 0);
      return {abort() {clearTimeout(timer); options.onabort();}};
    };
  },source.match(/^\/\/ @version\s+(\S+)/m)[1]);
  await context.addInitScript(source => {
    // Reproduce the key Tampermonkey boundary: sandbox window !== page window.
    const sandboxWindow = new Proxy(window, {
      get(target, key) {
        if (['top', 'window', 'self'].includes(String(key))) return sandboxWindow;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' && ['addEventListener', 'postMessage'].includes(String(key)) ? value.bind(target) : value;
      },
    });
    new Function('window', 'unsafeWindow', source)(sandboxWindow, window);
  }, source);
  const page = await context.newPage();
  await page.goto(base + '/members');
  await page.getByRole('dialog',{name:'QOJ 支持油猴同步了'}).getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(async()=>{await (await import('/src/stores/qoj-sync.ts')).useQojSyncStore().setUseUserscript(true);});
  async function rpc(method, params = {}) {
    return page.evaluate(({method,params}) => new Promise((resolve,reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {window.removeEventListener('message',listener); reject(new Error('rpc timeout'));},5000);
      function listener(e) {
        if(e.data?.direction === 'response' && e.data.request_id === id) {
          clearTimeout(timer);window.removeEventListener('message',listener);resolve(e.data);
        }
      }
      window.addEventListener('message',listener);
      window.postMessage({protocol:'xcpc-sync',version:1,direction:'request',request_id:id,method,params},location.origin);
    }),{method,params});
  }
  assert.equal((await rpc('hello')).result.connected,true);
  assert.equal(await page.evaluate(()=>window.probeRequests),0,'hello must not contact QOJ');
  const cases = [
    ['normal',good,null],
    ['zero counts',{...good,responseText:html.replaceAll(': 1',': 0').replace(/<a[^>]*>.*?<\/a>/g,'')},null],
    ['login',{...good,finalUrl:'https://qoj.ac/login'},'AUTH_REQUIRED'],
    ['403',{...good,status:403},'CHALLENGE_REQUIRED'],
    ['429',{...good,status:429,responseHeaders:'Retry-After: 600'},'RATE_LIMITED'],
    ['404',{...good,status:404},'USER_NOT_FOUND'],
    ['challenge 200',{...good,responseText:'<title>Just a moment...</title>'},'CHALLENGE_REQUIRED'],
    ['missing tried',{...good,responseText:html.split('<h4')[0]},'PARSE_ERROR'],
    ['wrong count',{...good,responseText:html.replace(': 1',': 2')},'PARSE_ERROR'],
    ['wrong profile',{...good,finalUrl:'https://qoj.ac/user/profile/other'},'PARSE_ERROR'],
    ['network',{callback:'onerror'},'NETWORK_ERROR'],
    ['timeout',{callback:'ontimeout'},'TIMEOUT'],
  ];
  for (const [name,fixture,error] of cases) {
    await page.evaluate(f=>{window.probeFixture=f;},fixture);
    const response=await rpc('syncMember',{provider:'qoj',handle:'test',interactive:true});
    assert.equal(response.error?.code || null,error,name);
    if (name==='normal') assert.deepEqual(response.result.snapshot,{scope:'profile_visible',solved:['1'],attempted:['2']});
    if (name==='zero counts') assert.deepEqual(response.result.snapshot.solved,[]);
    if (name==='429') assert.equal(response.error.retry_after_ms,600000);
    console.log('PASS userscript: '+name);
  }
  await page.evaluate(f=>{window.probeFixture=f;},good);
  assert.ok((await rpc('syncMember',{provider:'qoj',handle:'test'})).result);
  assert.equal((await rpc('syncMember',{provider:'qoj',handle:'../login'})).error.code,'INVALID_REQUEST');
  console.log('PASS installation authorizes requests without confirm/storage grants; URL restriction preserved');
  await page.evaluate(f=>{window.probeFixture={...f,delay:1000};},good);
  const cancelled = await page.evaluate(() => new Promise(resolve => {
    const id=crypto.randomUUID();
    function receive(e) {
      if(e.data?.direction==='response' && e.data.request_id===id) {
        window.removeEventListener('message',receive);resolve(e.data);
      }
    }
    window.addEventListener('message',receive);
    const send=(request_id,method,params)=>window.postMessage({protocol:'xcpc-sync',version:1,direction:'request',request_id,method,params},location.origin);
    send(id,'syncMember',{provider:'qoj',handle:'test'});
    setTimeout(()=>send(crypto.randomUUID(),'cancel',{request_id:id}),100);
  }));
  assert.equal(cancelled.error.code,'CANCELLED');
  await page.evaluate(f=>{window.probeFixture=f;},good);
  console.log('PASS userscript cancellation, including queued requests');

  // Use the actual Vue store/importer and browser IndexedDB, not a fake success handler.
  await page.evaluate(async () => {
    const {localDb}=await import('/src/lib/local-db.ts');
    const at = new Date().toISOString();
    await localDb.members.put({memberId:'test',displayName:'Test',createdAt:at,updatedAt:at});
    await localDb.memberHandles.put({handleId:'qoj:test',memberId:'test',provider:'qoj',handle:'test',createdAt:at,updatedAt:at});
    await localDb.catalogContests.put({contestId:'bridge-fixture',title:'Bridge fixture',aliases:[],tags:[],sources:[],problemIds:['bridge:1','bridge:2'],generatedFrom:'manual'});
    await localDb.catalogProblems.bulkPut([1,2].map(id=>({problemId:`bridge:${id}`,contestId:'bridge-fixture',ordinal:String(id),title:`Fixture ${id}`,aliases:[],sources:[{provider:'qoj',provider_problem_id:String(id)}]})));
    const {useQojSyncStore}=await import('/src/stores/qoj-sync.ts');
    window.syncStore=useQojSyncStore();
    const {validateQojSnapshot}=await import('/src/stores/qoj-sync.ts');
    let rejected=false;
    try {validateQojSnapshot({provider:'qoj',handle:'test',fetched_at:at,snapshot:{scope:'profile_visible',solved:[]}},'test');} catch {rejected=true;}
    if(!rejected) throw new Error('Incomplete snapshot accepted');
  });
  await page.evaluate(()=>window.syncStore.sync(true));
  let records = await page.evaluate(async()=>{const {localDb}=await import('/src/lib/local-db.ts');return localDb.syncRecords.toArray();});
  assert.ok(records.some(r=>r.summaryJson.bridge && r.status==='succeeded'));
  const before = await page.evaluate(async()=>{const {localDb}=await import('/src/lib/local-db.ts');return localDb.memberProblemStatus.toArray();});
  assert.ok(before.length >= 2,'failure preservation must exercise nonempty status records');
  await page.evaluate(f=>{window.probeFixture=f;},{...good,finalUrl:'https://qoj.ac/login'});
  await page.evaluate(()=>window.syncStore.sync(true));
  assert.match(await page.evaluate(()=>window.syncStore.message),/登录/);
  await page.getByRole('dialog',{name:'请先登录 QOJ'}).waitFor();
  assert.equal(await page.locator('#feedback-message').innerText(),'请前往 QOJ 登录账号后重试。');
  assert.equal(await page.getByRole('dialog').locator('details').count(),0);
  assert.deepEqual(await page.getByRole('dialog').locator('footer button, footer a').allTextContents(),['关闭','前往 QOJ ↗']);
  await page.evaluate(()=>window.syncStore.check());
  await page.getByRole('dialog',{name:'请先登录 QOJ'}).waitFor();
  assert.deepEqual(await page.evaluate(async()=>{const {localDb}=await import('/src/lib/local-db.ts');return localDb.memberProblemStatus.toArray();}),before);
  await page.evaluate(f=>{window.probeFixture=f;},good);
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:/^同步 QOJ /}).click();
  await page.waitForFunction(()=>!window.syncStore.busy);
  assert.match(await page.evaluate(()=>window.syncStore.message),/已同步 1/);
  await page.getByRole('dialog',{name:'QOJ 同步完成'}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0);
  console.log('PASS store: successful import, auth failure preserves records, manual recovery');
  await page.evaluate(f=>{window.probeFixture=f;},{...good,finalUrl:'https://qoj.ac/login'});
  await page.evaluate(()=>window.syncStore.sync(true));
  const pausedCount=await page.evaluate(()=>window.probeRequests);
  await page.evaluate(async()=>{window.syncStore.enabled=true;await window.syncStore.sync(false);});
  assert.equal(await page.evaluate(()=>window.probeRequests),pausedCount,'auth failure must pause interval retries');
  await page.evaluate(f=>{window.probeFixture=f;},good);
  await page.bringToFront();
  await page.evaluate(()=>window.syncStore.sync(false,undefined,true));
  assert.equal(await page.evaluate(()=>window.probeRequests),pausedCount,'manual failure must not retry on return even when auto sync is enabled');
  await page.evaluate(()=>{window.syncStore.enabled=false;});
  console.log('PASS manual failure is not retried by automatic scheduler or return');
  await page.evaluate(f=>{window.probeFixture=f;},{...good,finalUrl:'https://qoj.ac/login'});
  await page.evaluate(()=>window.syncStore.sync(true));
  const manualRecoveryCount=await page.evaluate(()=>window.probeRequests);
  await page.evaluate(f=>{window.probeFixture=f;window.dispatchEvent(new Event('focus'));},good);
  await page.waitForFunction(()=>!window.syncStore.busy);
  assert.equal(await page.evaluate(()=>window.probeRequests),manualRecoveryCount);
  assert.equal(await page.evaluate(()=>window.syncStore.enabled),false);
  console.log('PASS manual login failure never retries on focus');

  await page.evaluate(f=>{window.probeFixture=f;},{...good,status:429,responseHeaders:'Retry-After: 600'});
  await page.evaluate(()=>window.syncStore.sync(true));
  const count=await page.evaluate(()=>window.probeRequests);
  await page.evaluate(()=>window.syncStore.sync(true));
  assert.equal(await page.evaluate(()=>window.probeRequests),count,'manual requests must respect 429 backoff');
  console.log('PASS store: persisted rate limit blocks manual retries');

  // Remove only test records in this disposable context to isolate lock behaviour.
  await page.evaluate(async()=>{const {localDb}=await import('/src/lib/local-db.ts');await localDb.syncRecords.clear();});
  const second=await context.newPage();
  await second.goto(base+'/members');
  await second.evaluate(async()=>{window.syncStore=(await import('/src/stores/qoj-sync.ts')).useQojSyncStore();});
  for(const p of [page,second]) await p.evaluate(f=>{window.probeFixture={...f,delay:500};window.probeRequests=0;},good);
  await Promise.all([page,second].map(p=>p.evaluate(()=>window.syncStore.sync(true))));
  assert.equal((await page.evaluate(()=>window.probeRequests))+(await second.evaluate(()=>window.probeRequests)),1);
  console.log('PASS actual Web Locks: two tabs, one upstream request');
  await page.evaluate(async()=>{window.syncStore.enabled=true;await window.syncStore.sync(false);});
  assert.equal((await page.evaluate(()=>window.probeRequests))+(await second.evaluate(()=>window.probeRequests)),1);
  console.log('PASS fresh data suppresses automatic requests');
  await page.evaluate(async()=>{(await import('/src/stores/feedback.ts')).useFeedbackStore().close();});
  const initialUpdateRequests=updateRequests;
  await page.evaluate(async()=>{window.syncStore.enabled=false;window.GM_info.script.version='1.0.2';await window.syncStore.check();});
  await page.getByRole('dialog',{name:'QOJ 脚本有更新'}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>window.syncStore.check());
  assert.equal(await page.getByRole('dialog').count(),0,'same update must not repeatedly prompt');
  assert.equal(await page.evaluate(()=>window.syncStore.updateRequired),true);
  const oldRequests=await page.evaluate(()=>window.probeRequests);
  await page.evaluate(()=>window.syncStore.sync(true));
  assert.equal(await page.evaluate(()=>window.probeRequests),oldRequests,'unsupported script must not request QOJ');
  await page.getByRole('dialog',{name:'QOJ 脚本有更新'}).waitFor();
  await page.getByRole('dialog').getByRole('link',{name:'更新脚本',exact:false}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(async()=>{window.GM_info.script.version='1.0.3';await window.syncStore.check();});
  assert.equal(await page.evaluate(()=>window.syncStore.updateRequired),false);
  assert.equal(await page.evaluate(()=>window.syncStore.updateAvailable),true);
  await page.getByRole('dialog',{name:'QOJ 脚本有更新'}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(async()=>{window.GM_info.script.version='1.0.10';await window.syncStore.check();});
  assert.equal(await page.evaluate(()=>window.syncStore.updateAvailable),false,'newer installs must not be downgraded');
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(updateRequests,initialUpdateRequests,'repeated hello must not refetch the version manifest within six hours');
  const download=await (await page.request.get(base+'/userscripts/qoj-sync.user.js')).text();
  assert.ok(download.includes('// @downloadURL  none'));
  assert.ok(!download.includes('@updateURL'));
  const manifest=await (await page.request.get(base+'/userscripts/qoj-sync.version.json')).json();
  assert.equal(manifest.version,source.match(/^\/\/ @version\s+(\S+)/m)[1]);
  console.log('PASS site update dialogs: old versions auto-prompt, dismissal dedup, newer/absent scripts do not prompt, manager auto-update disabled');
  await context.close();
  const absent=await browser.newContext();
  const missing=await absent.newPage();await missing.goto(base+'/members');
  await missing.getByRole('dialog',{name:'QOJ 支持油猴同步了'}).getByRole('button',{name:'关闭',exact:true}).click();
  await missing.evaluate(async()=>{await (await import('/src/stores/qoj-sync.ts')).useQojSyncStore().setUseUserscript(true);});
  await missing.waitForFunction(async()=>{const {useQojSyncStore}=await import('/src/stores/qoj-sync.ts');return !useQojSyncStore().checking;});
  assert.equal(await missing.getByRole('dialog').count(),0,'opening members must not show setup');
  const card=missing.getByRole('region',{name:'同步做题记录'});
  const cfBox=await card.getByRole('button',{name:/同步 Codeforces/}).boundingBox();
  const qojBox=await card.getByRole('button',{name:/^同步 QOJ /}).boundingBox();
  assert.ok(cfBox && qojBox && Math.abs(cfBox.y-qojBox.y)<2,'CF and QOJ must be side by side in the same card');
  await missing.getByRole('button',{name:/^同步 QOJ /}).click();
  await missing.getByRole('dialog',{name:'QOJ 自动同步帮助'}).waitFor();
  await missing.getByRole('button',{name:'关闭',exact:true}).click();
  assert.equal(await missing.getByRole('button',{name:'检测连接',exact:true}).count(),0);
  assert.equal(await missing.getByRole('switch',{name:'自动同步',exact:true}).count(),0);
  assert.equal(await missing.getByRole('button',{name:/^同步 QOJ /}).getAttribute('title'),'脚本未连接');
  await missing.reload();
  await missing.waitForFunction(async()=>{const {useQojSyncStore}=await import('/src/stores/qoj-sync.ts');return !useQojSyncStore().checking;});
  assert.equal(await missing.getByRole('dialog').count(),0);
  assert.equal(await missing.locator('.qoj-sync-group').getByRole('button',{name:'QOJ 自动同步帮助'}).count(),1);
  await missing.getByRole('button',{name:'QOJ 自动同步帮助'}).click();
  await missing.getByRole('dialog',{name:'QOJ 自动同步帮助'}).waitFor();
  await missing.getByRole('button',{name:'关闭',exact:true}).click();
  await missing.goto(base+'/manage');
  await missing.getByRole('switch',{name:'自动同步',exact:true}).waitFor();
  console.log('PASS compact UI: no unsolicited setup, click-only help, shared sync card, button status, management settings');
  await absent.close();
} finally {await browser.close();}
