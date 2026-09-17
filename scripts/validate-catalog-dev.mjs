// Regression for regenerating catalog assets while the dev server is running.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium,expect} from '@playwright/test';
const base='http://localhost:5173';
const id='abb72fec-deb3-5d04-9ca3-2b16d6c83ed9';
async function json(path) {
  const r=await fetch(base+path);assert.equal(r.status,200,path);
  assert.match(r.headers.get('content-type'),/application\/json/,path);
  return r.json();
}
const index=await json('/generated/contest-index.json');
for(const c of index.contests)assert.equal((await json(`/generated/contests/${c.id}.json`)).id,c.id);
await Promise.all([
  promisify(execFile)(process.execPath,['scripts/generate-web-catalog-assets.mjs']),
  (async()=>{for(let i=0;i<30;i++)assert.equal((await json(`/generated/contests/${id}.json`)).id,id);})(),
]);
for(const c of index.contests)assert.equal((await json(`/generated/contests/${c.id}.json`)).id,c.id);
const missing=await fetch(base+'/generated/contests/missing.json');assert.equal(missing.status,404);assert.match(missing.headers.get('content-type'),/application\/json/);
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/contests/'+id);
  await page.getByRole('dialog',{name:'QOJ 支持油猴同步了'}).getByRole('button',{name:'关闭',exact:true}).click();
  const title=index.contests.find(c=>c.id===id).title;
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Unexpected token');
  await page.screenshot({path:'/tmp/xcpc-fixed-contest.png',fullPage:true});
  await page.reload();
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);
  console.log(`PASS ${index.contests.length} detail JSON endpoints before/after regeneration; no gaps during regeneration; missing JSON is 404; exact user URL renders and reloads`);
} finally {await browser.close();}
