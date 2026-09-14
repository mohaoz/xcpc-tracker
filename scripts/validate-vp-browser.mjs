import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readJson } from './source-import-lib.mjs';
const base = process.env.VP_TEST_URL ?? 'http://127.0.0.1:5173';
const catalog = await readJson('catalog/default-catalog.min.json');
const contest = catalog.contests.find(c => c.contestId === 'fca291f3-d017-5cd3-9298-63a1b624b39e');
const browser = await chromium.launch({headless:true});
const context = await browser.newContext();
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const remoteRequests = [];
page.on('request', r => {if(new URL(r.url()).origin !== new URL(base).origin) remoteRequests.push(r.url());});
async function database(page, action, data) {
  return page.evaluate(async ({action,data}) => {
    const db = await new Promise((resolve,reject) => {const r=indexedDB.open('xcpc_tracker_local');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const names = action === 'member' ? ['members','memberHandles','memberProblemStatus','syncRecords'] : ['contestPreferences'];
    await new Promise((resolve,reject) => {
      const tx=db.transaction(names,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
      if(action==='member') {
        tx.objectStore('members').put({memberId:'test-member',displayName:'Test member',createdAt:'2026-09-14',updatedAt:'2026-09-14'});
        tx.objectStore('memberHandles').put({handleId:'manual:test',memberId:'test-member',provider:'manual',handle:'test',createdAt:'2026-09-14',updatedAt:'2026-09-14'});
        tx.objectStore('memberProblemStatus').put({statusId:'test-status',memberId:'test-member',problemId:data.problemId,provider:'manual',status:'attempted',firstSeenAt:'2026-09-14',lastSeenAt:'2026-09-14',sourceRecordId:'manual',matchMethod:'manual'});
      } else if(action==='clear') tx.objectStore('contestPreferences').delete(data.contestId);
      else tx.objectStore('contestPreferences').put({contest_id:data.contestId,spoiler_mode:data.mode});
    });db.close();
  }, {action,data});
}
try {
  const before = Date.now();
  await page.goto(`${base}/contests/${contest.contestId}`);
  const toggle = page.getByRole('button', {name:'非剧透 · 显示牌线、奖牌和题目标签'});
  await toggle.waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b=>b.textContent.includes('非剧透 ·'))?.disabled);
  assert.equal(await page.locator('.award-cutoff-card').count(),0);
  assert.equal(await page.getByText('查看题目标签（可能剧透）',{exact:true}).count(),0);
  assert.equal(await page.locator('td a[href*="/problem/"]').count(),0, 'Whole-contest link interaction must remain unchanged');
  await toggle.click();await page.locator('.award-cutoff-card').waitFor();
  assert.ok(await page.getByText('查看题目标签（可能剧透）',{exact:true}).count()>0);
  await page.reload();await page.locator('.award-cutoff-card').waitFor();
  await page.getByRole('button',{name:'剧透 · 切换为非剧透'}).click();
  await database(page,'member',{problemId:contest.problemIds[0]});await page.reload();
  await toggle.waitFor();assert.equal(await page.locator('.award-cutoff-card').count(),0,'Explicit non-spoiler must override attempted status');
  await database(page,'clear',{contestId:contest.contestId});await page.reload();await page.locator('.award-cutoff-card').waitFor();
  const other=await context.newPage();await other.goto(`${base}/contests/${contest.contestId}`);await other.locator('.award-cutoff-card').waitFor();
  await page.getByRole('button',{name:'剧透 · 切换为非剧透'}).click();await other.locator('.award-cutoff-card').waitFor({state:'detached'});
  await page.goto(`${base}/contests`);
  const search=page.getByPlaceholder('可搜索标签、标题、平台、奖牌；用-排除，用|表示或');
  await search.fill('2026 深圳');
  const card=page.locator(`a.contest-card[href$="/contests/${contest.contestId}"]`);await card.waitFor();
  assert.equal(await card.getByRole('button',{name:'非剧透',exact:true}).count(),1);
  assert.equal(await card.locator('.contest-award-range').count(),0);
  await page.getByRole('button',{name:'未做',exact:true}).click();await card.waitFor({state:'detached'});
  await page.getByRole('button',{name:'已做',exact:true}).click();await card.waitFor();
  await search.fill('2026 深圳 -金牌');await card.waitFor({state:'detached'});
  await search.fill('2026 深圳');await card.waitFor();
  await card.getByRole('button',{name:'非剧透',exact:true}).click();
  await card.getByRole('button',{name:'剧透',exact:true}).waitFor();
  await card.click();await page.locator('.award-cutoff-card').waitFor();
  assert.deepEqual(errors,[]);
  assert.deepEqual(remoteRequests,[], 'VP browsing must not fetch upstream SRK, Rating or OJ data');
  console.log(`VP browser checks passed: untouched default, tags/awards gating, manual override, attempt-only touched, reload/navigation, cross-tab sync, no-spoiler search and whole-contest links (${Date.now()-before}ms).`);
} finally {await browser.close();}
