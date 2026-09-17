// Live deployed app/assets; isolated browser storage; QOJ transport is simulated.
// This is not a claim of a real Tampermonkey installation or authenticated QOJ session.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
const base='https://mohaoz.github.io/xcpc-tracker/';
const local=process.argv.includes('--local-build');
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('https://static.cloudflareinsights.com/**',route=>route.abort());
  if(local)await context.route(base+'**',async route=>{
    const relative=new URL(route.request().url()).pathname.slice('/xcpc-tracker/'.length)||'index.html';
    try {await route.fulfill({path:resolve('web/dist',relative)});}catch{await route.fulfill({status:404,body:'Not found'});}
  });
  const get=async path=>local ? {status:()=>200,text:()=>readFile(resolve('web/dist',path),'utf8'),json:async()=>JSON.parse(await readFile(resolve('web/dist',path),'utf8'))} : context.request.get(base+path);
  const response=await get('userscripts/qoj-sync.user.js');
  assert.equal(response.status(),200);
  const source=await response.text();
  assert.equal(source,await readFile('scripts/qoj-sync.user.js','utf8'));
  const manifest=await (await get('userscripts/qoj-sync.version.json')).json();
  assert.equal(manifest.version,source.match(/^\/\/ @version\s+(\S+)/m)[1]);
  const catalog=await (await get('generated/contest-index.json')).json();
  assert.equal(catalog.contests.length,247);
  console.log(`PASS ${local?'local Pages build':'live deployment'} script, exact source, version ${manifest.version}, 247 contests`);
  await context.addInitScript(({source,version})=>{
    window.unsafeWindow=window;window.GM_info={script:{version}};
    window.qojProbe={requests:0,login:false};
    window.GM_xmlhttpRequest=options=>{
      window.qojProbe.requests++;
      const handle=new URL(options.url).pathname.split('/').at(-1);
      const timer=setTimeout(()=>options.onload({status:200,finalUrl:window.qojProbe.login?'https://qoj.ac/login':`https://qoj.ac/user/profile/${handle}`,responseText:'<h4 class="list-group-item-heading">Accepted problems: 1</h4><div><a href="/problem/15431">15431</a></div><h4 class="list-group-item-heading">Tried problems: 0</h4><div></div>'}),50);
      return {abort(){clearTimeout(timer);options.onabort();}};
    };
    const sandbox=new Proxy(window,{get(target,key){if(['top','window','self'].includes(String(key)))return sandbox;const value=Reflect.get(target,key,target);return typeof value==='function'&&['addEventListener','postMessage'].includes(String(key))?value.bind(target):value;}});
    new Function('window','unsafeWindow',source)(sandbox,window);
  },{source,version:manifest.version});
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'#/manage');
  await page.getByRole('dialog',{name:'QOJ 支持油猴同步了'}).getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.getByRole('switch',{name:'自动同步',exact:true})).toHaveAttribute('aria-checked','false');
  await page.getByRole('switch',{name:'使用 QOJ 油猴脚本'}).click();
  await page.goto(base+'#/members/new');
  await page.locator('#add-member-platform').selectOption('qoj');
  await page.locator('#add-member-id').fill('线上隔离验收');
  await page.locator('#add-member-handle').fill('xcpc_acceptance');
  await page.getByRole('button',{name:/添加.*QOJ/}).click();
  await page.getByRole('dialog',{name:'QOJ 同步完成'}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.goto(base+'#/members');
  await expect(page.getByRole('button',{name:/^同步 QOJ/})).toHaveAttribute('title','脚本已连接');
  const statuses=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('xcpc_tracker_local');open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result;const request=db.transaction('memberProblemStatus').objectStore('memberProblemStatus').getAll();request.onsuccess=()=>{db.close();resolve(request.result);};request.onerror=()=>reject(request.error);};
  }));
  const before=await statuses();assert.ok(before.length>0);
  await page.evaluate(()=>{window.qojProbe.login=true;});
  await page.getByRole('button',{name:/^同步 QOJ/}).click();
  await page.getByRole('dialog',{name:'请先登录 QOJ'}).waitFor();
  assert.deepEqual(await statuses(),before);
  assert.equal(await page.locator('#feedback-message').innerText(),'请前往 QOJ 登录账号后重试。');
  assert.deepEqual(await page.getByRole('dialog').locator('footer button,footer a').allTextContents(),['关闭','前往 QOJ ↗']);
  await page.screenshot({path:'/tmp/xcpc-online-qoj-auth.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS deployed hash routes, userscript sandbox handshake, import, auth dialog and failure preservation (QOJ transport mocked)');
} finally {await browser.close();}
