// Offline UI checks; all storage belongs to a disposable browser context.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
const browser=await chromium.launch({headless:true});
const base=process.env.QOJ_TEST_BASE || 'http://localhost:5173';
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  let upstream=0;
  await context.route('https://qoj.ac/**',route=>{upstream++;return route.abort();});
  await page.goto(base+'/manage');
  const intro=page.getByRole('dialog',{name:'QOJ 支持油猴同步了'});
  await intro.waitFor();
  await page.screenshot({path:'/tmp/xcpc-qoj-intro.png',fullPage:true});
  await intro.getByRole('button',{name:'关闭',exact:true}).click();
  const mode=page.getByRole('switch',{name:'使用 QOJ 油猴脚本'});
  await mode.waitFor();
  await expect(mode).toHaveAttribute('aria-checked','false');
  assert.equal(await page.getByRole('switch',{name:'自动同步',exact:true}).isDisabled(),false);
  await expect(page.getByRole('switch',{name:'自动同步',exact:true})).toHaveAttribute('aria-checked','false');
  await page.reload();
  await expect(mode).toHaveAttribute('aria-checked','false');
  await expect(intro).toHaveCount(0);
  assert.equal(await page.locator('main textarea').count(),0,'management must not duplicate the paste form');
  const importBox=await page.getByRole('region',{name:'导入',exact:true}).boundingBox();
  const exportBox=await page.getByRole('region',{name:'导出',exact:true}).boundingBox();
  assert.ok(importBox && exportBox && Math.abs(importBox.y-exportBox.y)<2 && exportBox.x>importBox.x,'import/export must be side by side');
  const importButton=await page.getByRole('button',{name:'选择备份文件'}).boundingBox();
  const exportButton=await page.getByRole('button',{name:'导出备份'}).boundingBox();
  assert.ok(importButton && exportButton && Math.abs(importButton.y-exportButton.y)<2 && Math.abs(importButton.height-exportButton.height)<2,'backup action buttons must align');
  assert.equal(await page.getByRole('button',{name:/QOJ 手动导入|同步 QOJ|油猴使用帮助/}).count(),0,'QOJ actions belong on the members page');
  await page.screenshot({path:'/tmp/xcpc-qoj-settings.png',fullPage:true});
  await page.goto(base+'/members/new');
  await page.locator('#add-member-platform').selectOption('qoj');
  await page.locator('#add-member-id').fill('测试成员');
  await page.locator('#add-member-handle').fill('test');
  await page.getByRole('button',{name:'添加并手动导入 QOJ'}).click();
  const modal=page.getByRole('dialog',{name:'QOJ 手动导入'});
  await modal.waitFor();
  assert.match(page.url(),/\/members$/);
  assert.equal(context.pages().length,1,'opening manual flow must not open QOJ');
  await page.screenshot({path:'/tmp/xcpc-qoj-manual.png',fullPage:true});
  await page.evaluate(async()=>{
    const {localDb}=await import('/src/lib/local-db.ts');
    await localDb.catalogContests.put({contestId:'manual-fixture',title:'Manual fixture',aliases:[],tags:[],sources:[],problemIds:['manual:1','manual:2'],generatedFrom:'manual'});
    await localDb.catalogProblems.bulkPut([1,2].map(id=>({problemId:'manual:'+id,contestId:'manual-fixture',ordinal:String(id),title:'Fixture '+id,aliases:[],sources:[{provider:'qoj',provider_problem_id:String(id)}]})));
  });
  const payload={provider:'qoj',exported_at:new Date().toISOString(),members:[{member_id:'untrusted-id',handle:'test',solved:['1'],attempted:['2']}]};
  await page.locator('#qoj-manual-json').fill(JSON.stringify(payload));
  await modal.getByRole('button',{name:'导入记录'}).click();
  await modal.getByRole('status').filter({hasText:'已导入 1 个账号'}).waitFor();
  async function records(){return page.evaluate(async()=>(await import('/src/lib/local-db.ts')).localDb.memberProblemStatus.toArray());}
  const before=await records();
  assert.ok(before.length>=2);
  assert.ok(before.every(r=>r.memberId==='测试成员'),'import must use local identity');
  for(const invalid of [
    '{',
    {...payload,members:[{handle:'other',solved:[],attempted:[]}]},
    {...payload,members:[{handle:'test',solved:[]}]},
    {...payload,members:[payload.members[0],payload.members[0]]},
  ]) {
    await page.locator('#qoj-manual-json').fill(typeof invalid==='string'?invalid:JSON.stringify(invalid));
    await modal.getByRole('button',{name:'导入记录'}).click();
    await modal.getByRole('alert').waitFor();
    assert.deepEqual(await records(),before);
  }
  await page.locator('#qoj-manual-json').fill(JSON.stringify({provider:'qoj',members:[],fetch_failures:[{handle:'test',error:'not logged in'}]}));
  await modal.getByRole('button',{name:'导入记录'}).click();
  await modal.getByRole('status').filter({hasText:'原记录保留'}).waitFor();
  assert.deepEqual(await records(),before);
  await modal.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.getByRole('button',{name:'同步 QOJ (1)',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'同步全部',exact:true}).click();
  await modal.waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/^同步 QOJ /}).click();
  await modal.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await modal.count(),0);
  assert.equal(upstream,0,'manual mode must not contact QOJ');
  await page.goto(base+'/manage');
  await mode.click();
  await expect(mode).toHaveAttribute('aria-checked','true');
  await page.goto(base+'/members');
  await page.getByRole('button',{name:'手动导出',exact:true}).click();
  await modal.waitFor();
  await page.keyboard.press('Escape');
  await page.screenshot({path:'/tmp/xcpc-qoj-toolbar.png',fullPage:true});
  await page.evaluate(async()=>{
    const {linkQojMember}=await import('/src/lib/qoj.ts');
    let rejected=false;try{await linkQojMember('other','test');}catch{rejected=true;}
    if(!rejected)throw new Error('duplicate binding accepted');
  });
  assert.deepEqual(await records(),before);
  console.log('PASS manual mode persistence, add-member flow, modal-only fallback, local identity, valid import, invalid/failure preservation, duplicate binding, no QOJ requests');
  await page.goto(base+'/manage');
  await mode.click();
  await expect(mode).toHaveAttribute('aria-checked','false');
  await page.goto(base+'/members');
  await page.getByRole('button',{name:/^同步 QOJ /}).click();
  await modal.getByRole('button',{name:'启动自动导入 →'}).click();
  await page.getByRole('dialog',{name:'QOJ 自动同步帮助'}).waitFor();
  await expect(modal).toHaveCount(0);
  const settings=await page.evaluate(async()=>{const s=(await import('/src/stores/qoj-sync.ts')).useQojSyncStore();return {mode:s.useUserscript,auto:s.enabled};});
  assert.deepEqual(settings,{mode:true,auto:false});
  assert.deepEqual(await records(),before);
  console.log('PASS manual-to-userscript handoff: missing script shows help, global mode enabled, periodic sync remains off, records preserved');
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
    const {localDb}=await import('/src/lib/local-db.ts');
    const at=new Date().toISOString();
    await localDb.memberHandles.put({handleId:'codeforces:test',memberId:'测试成员',provider:'codeforces',handle:'test',createdAt:at,updatedAt:at,displayLabel:null});
    await (await import('/src/stores/qoj-sync.ts')).useQojSyncStore().setUseUserscript(false);
  });
  let cfRequests=0, releaseRequest;
  let hold=false;
  await page.route('https://codeforces.com/api/user.status*',async route=>{
    cfRequests++;
    if(hold)await new Promise(resolve=>{releaseRequest=resolve;});
    await route.fulfill({json:{status:'OK',result:[]}});
  });
  await page.reload();
  await expect(page.getByRole('button',{name:'同步 Codeforces (1)',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'同步全部',exact:true}).click();
  await modal.waitFor();
  assert.equal(cfRequests,1,'sync all must request CF before QOJ manual flow');
  await page.keyboard.press('Escape');
  hold=true;
  await page.getByRole('button',{name:'同步全部',exact:true}).click();
  await expect.poll(()=>cfRequests).toBe(2);
  await page.getByRole('button',{name:'停止全部',exact:true}).click();
  releaseRequest();
  await expect(page.getByRole('button',{name:'同步全部',exact:true})).toBeEnabled();
  await expect(modal).toHaveCount(0);
  console.log('PASS sync all: CF then QOJ; stop prevents starting QOJ');
} finally {await browser.close();}
