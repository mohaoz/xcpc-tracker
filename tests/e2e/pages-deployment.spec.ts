// Production (GitHub Pages) build checks with isolated browser storage and a
// simulated QOJ transport. This is not a real Tampermonkey installation or an
// authenticated QOJ session.
//
// - "@live" runs against the deployed site (network; run with E2E_LIVE=1).
// - The local variant serves web/dist from a `--mode github-pages` build
//   offline, and is skipped when no Pages build is present.
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext } from '@playwright/test';

import { readRepoJson, readRepoText, repoPath } from './helpers/fixtures';

const base = 'https://mohaoz.github.io/xcpc-tracker/';
const dist = repoPath('web/dist');
const hasPagesBuild = existsSync(resolve(dist, 'index.html')) && readFileSync(resolve(dist, 'index.html'), 'utf8').includes('/xcpc-tracker/');

async function prepare(context: BrowserContext, local: boolean) {
  await context.route('https://static.cloudflareinsights.com/**', route => route.abort());
  if (local) {
    await context.route(base + '**', async route => {
      const relative = new URL(route.request().url()).pathname.slice('/xcpc-tracker/'.length) || 'index.html';
      try { await route.fulfill({ path: resolve(dist, relative) }); } catch { await route.fulfill({ status: 404, body: 'Not found' }); }
    });
  }
  const getText = async (path: string) => {
    if (local) return { status: 200, text: await readFile(resolve(dist, path), 'utf8') };
    const response = await context.request.get(base + path);
    return { status: response.status(), text: await response.text() };
  };
  return getText;
}

for (const local of [false, true]) {
  const title = local ? 'local GitHub Pages build' : 'deployed site @live';
  test.describe(title, () => {
    test.skip(local && !hasPagesBuild, 'requires `npm run build --prefix web -- --mode github-pages`');
    test.use({ viewport: { width: 1440, height: 1000 } });

    test('serves the exact userscript, its version manifest and the full contest index', async ({ context }) => {
      const getText = await prepare(context, local);
      const script = await getText('userscripts/qoj-sync.user.js');
      expect(script.status).toBe(200);
      expect(script.text).toBe(await readRepoText('scripts/qoj-sync.user.js'));
      const manifest = JSON.parse((await getText('userscripts/qoj-sync.version.json')).text);
      expect(manifest.version).toBe(script.text.match(/^\/\/ @version\s+(\S+)/m)![1]);
      const index = JSON.parse((await getText('generated/contest-index.json')).text);
      // The deployed release matches the checked-out catalog at publication.
      const catalog = await readRepoJson('catalog/default-catalog.min.json');
      expect(index.contests).toHaveLength(catalog.contests.length);
    });

    test('hash routes, userscript sandbox handshake, import, auth dialog and failure preservation', async ({ context }, testInfo) => {
      const getText = await prepare(context, local);
      const source = (await getText('userscripts/qoj-sync.user.js')).text;
      const version = JSON.parse((await getText('userscripts/qoj-sync.version.json')).text).version;
      await context.addInitScript(({ source, version }) => {
        const w = window as any;
        w.unsafeWindow = window; w.GM_info = { script: { version } };
        w.qojProbe = { requests: 0, login: false };
        w.GM_xmlhttpRequest = (options: any) => {
          w.qojProbe.requests++;
          const handle = new URL(options.url).pathname.split('/').at(-1);
          const timer = setTimeout(() => options.onload({
            status: 200,
            finalUrl: w.qojProbe.login ? 'https://qoj.ac/login' : `https://qoj.ac/user/profile/${handle}`,
            responseText: '<h4 class="list-group-item-heading">Accepted problems: 1</h4><div><a href="/problem/15431">15431</a></div><h4 class="list-group-item-heading">Tried problems: 0</h4><div></div>',
          }), 50);
          return { abort() { clearTimeout(timer); options.onabort(); } };
        };
        const sandbox: any = new Proxy(window, {
          get(target, key) {
            if (['top', 'window', 'self'].includes(String(key))) return sandbox;
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' && ['addEventListener', 'postMessage'].includes(String(key)) ? value.bind(target) : value;
          },
        });
        new Function('window', 'unsafeWindow', source)(sandbox, window);
      }, { source, version });

      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '#/manage');
      await page.getByRole('dialog', { name: 'QOJ 支持油猴同步了' }).getByRole('button', { name: '关闭', exact: true }).click();
      await expect(page.getByRole('switch', { name: '自动同步', exact: true })).toHaveAttribute('aria-checked', 'false');
      await page.getByRole('switch', { name: '使用 QOJ 油猴脚本' }).click();
      await page.goto(base + '#/members/new');
      await page.locator('#add-member-platform').selectOption('qoj');
      await page.locator('#add-member-id').fill('线上隔离验收');
      await page.locator('#add-member-handle').fill('xcpc_acceptance');
      await page.getByRole('button', { name: /添加.*QOJ/ }).click();
      await page.getByRole('dialog', { name: 'QOJ 同步完成' }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      await page.goto(base + '#/members');
      await expect(page.getByRole('button', { name: /^同步 QOJ/ })).toHaveAttribute('title', '脚本已连接');

      const statuses = () => page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('xcpc_tracker_local');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('memberProblemStatus').objectStore('memberProblemStatus').getAll();
          request.onsuccess = () => { db.close(); resolve(request.result); };
          request.onerror = () => reject(request.error);
        };
      }));
      const before = await statuses();
      expect(before.length).toBeGreaterThan(0);

      await page.evaluate(() => { (window as any).qojProbe.login = true; });
      await page.getByRole('button', { name: /^同步 QOJ/ }).click();
      await page.getByRole('dialog', { name: '请先登录 QOJ' }).waitFor();
      expect(await statuses()).toEqual(before);
      await expect(page.locator('#feedback-message')).toHaveText('请前往 QOJ 登录账号后重试。');
      expect(await page.getByRole('dialog').locator('footer button,footer a').allTextContents()).toEqual(['关闭', '前往 QOJ ↗']);
      await testInfo.attach('qoj-auth', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      expect(errors).toEqual([]);
    });
  });
}
