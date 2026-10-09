// QOJ userscript bridge: real userscript and app code, mocked QOJ transport,
// disposable browser storage. 
import type { Page } from '@playwright/test';
import { dismissQojIntro, expect, test } from './helpers/fixtures';

const html = '<h4 class="list-group-item-heading">Accepted problems: 1</h4><div><a href="/problem/1">1</a></div><h4 class="list-group-item-heading">Tried problems: 1</h4><div><a href="/problem/2">2</a></div>';
const good = { status: 200, finalUrl: 'https://qoj.ac/user/profile/test', responseText: html };

async function rpc(page: Page, method: string, params: object = {}) {
  return page.evaluate(({ method, params }) => new Promise<any>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('rpc timeout')); }, 5000);
    function listener(e: MessageEvent) {
      if (e.data?.direction === 'response' && e.data.request_id === id) {
        clearTimeout(timer); window.removeEventListener('message', listener); resolve(e.data);
      }
    }
    window.addEventListener('message', listener);
    window.postMessage({ protocol: 'xcpc-sync', version: 1, direction: 'request', request_id: id, method, params }, location.origin);
  }), { method, params });
}
const setFixture = (page: Page, fixture: object) => page.evaluate(f => { (window as any).probeFixture = f; }, fixture);
const probeRequests = (page: Page) => page.evaluate(() => (window as any).probeRequests as number);
const store = (page: Page) => page.evaluate(() => { const s = (window as any).syncStore; return { message: s.message as string, enabled: s.enabled as boolean, updateRequired: s.updateRequired as boolean, updateAvailable: s.updateAvailable as boolean }; });
const statuses = (page: Page) => page.evaluate(async () => { const { localDb } = await import('/src/lib/local-db.ts' as string); return localDb.memberProblemStatus.toArray(); });

test.describe('QOJ userscript bridge', () => {
  test('installed userscript: protocol, store integration, scheduling, locks and update prompts', async ({ context, request }) => {
    const scriptResponse = await request.get('/userscripts/qoj-sync.user.js');
    expect(scriptResponse.ok()).toBe(true);
    const source = await scriptResponse.text();
    const scriptVersion = source.match(/^\/\/ @version\s+(\S+)/m)![1];
    let updateRequests = 0;
    context.on('request', r => { if (r.url().endsWith('/userscripts/qoj-sync.version.json')) updateRequests++; });
    await context.addInitScript(version => {
      const w = window as any;
      w.GM_info = { script: { version } };
      w.unsafeWindow = window;
      w.probeRequests = 0;
      window.confirm = () => { throw new Error('Installed script must not ask for additional authorization'); };
      w.GM_xmlhttpRequest = (options: any) => {
        w.probeRequests++;
        const fixture = w.probeFixture;
        const timer = setTimeout(() => {
          if (fixture.callback) options[fixture.callback](); else options.onload(fixture);
        }, fixture.delay || 0);
        return { abort() { clearTimeout(timer); options.onabort(); } };
      };
    }, scriptVersion);
    await context.addInitScript(source => {
      // Reproduce the key Tampermonkey boundary: sandbox window !== page window.
      const sandboxWindow: any = new Proxy(window, {
        get(target, key) {
          if (['top', 'window', 'self'].includes(String(key))) return sandboxWindow;
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' && ['addEventListener', 'postMessage'].includes(String(key)) ? value.bind(target) : value;
        },
      });
      new Function('window', 'unsafeWindow', source)(sandboxWindow, window);
    }, source);
    const page = await context.newPage();
    await page.goto('/members');
    await dismissQojIntro(page);
    await page.evaluate(async () => { await (await import('/src/stores/qoj-sync.ts' as string)).useQojSyncStore().setUseUserscript(true); });

    await test.step('hello does not contact QOJ', async () => {
      expect((await rpc(page, 'hello')).result.connected).toBe(true);
      expect(await probeRequests(page), 'hello must not contact QOJ').toBe(0);
    });

    const cases: Array<[string, object, string | null]> = [
      ['normal', good, null],
      ['zero counts', { ...good, responseText: html.replaceAll(': 1', ': 0').replace(/<a[^>]*>.*?<\/a>/g, '') }, null],
      ['login', { ...good, finalUrl: 'https://qoj.ac/login' }, 'AUTH_REQUIRED'],
      ['403', { ...good, status: 403 }, 'CHALLENGE_REQUIRED'],
      ['429', { ...good, status: 429, responseHeaders: 'Retry-After: 600' }, 'RATE_LIMITED'],
      ['404', { ...good, status: 404 }, 'USER_NOT_FOUND'],
      ['challenge 200', { ...good, responseText: '<title>Just a moment...</title>' }, 'CHALLENGE_REQUIRED'],
      ['missing tried', { ...good, responseText: html.split('<h4')[0] }, 'PARSE_ERROR'],
      ['wrong count', { ...good, responseText: html.replace(': 1', ': 2') }, 'PARSE_ERROR'],
      ['wrong profile', { ...good, finalUrl: 'https://qoj.ac/user/profile/other' }, 'PARSE_ERROR'],
      ['network', { callback: 'onerror' }, 'NETWORK_ERROR'],
      ['timeout', { callback: 'ontimeout' }, 'TIMEOUT'],
    ];
    for (const [name, fixture, error] of cases) {
      await test.step(`userscript: ${name}`, async () => {
        await setFixture(page, fixture);
        const response = await rpc(page, 'syncMember', { provider: 'qoj', handle: 'test', interactive: true });
        expect(response.error?.code || null, name).toBe(error);
        if (name === 'normal') expect(response.result.snapshot).toEqual({ scope: 'profile_visible', solved: ['1'], attempted: ['2'] });
        if (name === 'zero counts') expect(response.result.snapshot.solved).toEqual([]);
        if (name === '429') expect(response.error.retry_after_ms).toBe(600000);
      });
    }

    await test.step('installation authorizes requests without confirm/storage grants; URL restriction preserved', async () => {
      await setFixture(page, good);
      expect((await rpc(page, 'syncMember', { provider: 'qoj', handle: 'test' })).result).toBeTruthy();
      expect((await rpc(page, 'syncMember', { provider: 'qoj', handle: '../login' })).error.code).toBe('INVALID_REQUEST');
    });

    await test.step('userscript cancellation, including queued requests', async () => {
      await setFixture(page, { ...good, delay: 1000 });
      const cancelled = await page.evaluate(() => new Promise<any>(resolve => {
        const id = crypto.randomUUID();
        function receive(e: MessageEvent) {
          if (e.data?.direction === 'response' && e.data.request_id === id) {
            window.removeEventListener('message', receive); resolve(e.data);
          }
        }
        window.addEventListener('message', receive);
        const send = (request_id: string, method: string, params: object) => window.postMessage({ protocol: 'xcpc-sync', version: 1, direction: 'request', request_id, method, params }, location.origin);
        send(id, 'syncMember', { provider: 'qoj', handle: 'test' });
        setTimeout(() => send(crypto.randomUUID(), 'cancel', { request_id: id }), 100);
      }));
      expect(cancelled.error.code).toBe('CANCELLED');
      await setFixture(page, good);
    });

    await test.step('store: successful import, auth failure preserves records, manual recovery', async () => {
      // Use the actual Vue store/importer and browser IndexedDB, not a fake success handler.
      await page.evaluate(async () => {
        const { localDb } = await import('/src/lib/local-db.ts' as string);
        const at = new Date().toISOString();
        await localDb.members.put({ memberId: 'test', displayName: 'Test', createdAt: at, updatedAt: at });
        await localDb.memberHandles.put({ handleId: 'qoj:test', memberId: 'test', provider: 'qoj', handle: 'test', createdAt: at, updatedAt: at });
        await localDb.catalogContests.put({ contestId: 'bridge-fixture', title: 'Bridge fixture', aliases: [], tags: [], sources: [], problemIds: ['bridge:1', 'bridge:2'], generatedFrom: 'manual' });
        await localDb.catalogProblems.bulkPut([1, 2].map(id => ({ problemId: `bridge:${id}`, contestId: 'bridge-fixture', ordinal: String(id), title: `Fixture ${id}`, aliases: [], sources: [{ provider: 'qoj', provider_problem_id: String(id) }] })));
        const { useQojSyncStore, validateQojSnapshot } = await import('/src/stores/qoj-sync.ts' as string);
        (window as any).syncStore = useQojSyncStore();
        let rejected = false;
        try { validateQojSnapshot({ provider: 'qoj', handle: 'test', fetched_at: at, snapshot: { scope: 'profile_visible', solved: [] } }, 'test'); } catch { rejected = true; }
        if (!rejected) throw new Error('Incomplete snapshot accepted');
      });
      await page.evaluate(() => (window as any).syncStore.sync(true));
      const records = await page.evaluate(async () => { const { localDb } = await import('/src/lib/local-db.ts' as string); return localDb.syncRecords.toArray(); });
      expect(records.some((r: any) => r.summaryJson.bridge && r.status === 'succeeded')).toBe(true);
      const before = await statuses(page);
      expect(before.length, 'failure preservation must exercise nonempty status records').toBeGreaterThanOrEqual(2);
      await setFixture(page, { ...good, finalUrl: 'https://qoj.ac/login' });
      await page.evaluate(() => (window as any).syncStore.sync(true));
      expect((await store(page)).message).toMatch(/登录/);
      await expect(page.getByRole('dialog', { name: '请先登录 QOJ' })).toBeVisible();
      await expect(page.locator('#feedback-message')).toHaveText('请前往 QOJ 登录账号后重试。');
      await expect(page.getByRole('dialog').locator('details')).toHaveCount(0);
      await expect(page.getByRole('dialog').locator('footer button, footer a')).toHaveText(['关闭', '前往 QOJ ↗']);
      await page.evaluate(() => (window as any).syncStore.check());
      await expect(page.getByRole('dialog', { name: '请先登录 QOJ' })).toBeVisible();
      expect(await statuses(page)).toEqual(before);
      await setFixture(page, good);
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('button', { name: /^同步 QOJ / }).click();
      await page.waitForFunction(() => !(window as any).syncStore.busy);
      expect((await store(page)).message).toMatch(/已同步 1/);
      await expect(page.getByRole('dialog', { name: 'QOJ 同步完成' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    await test.step('manual failure is not retried by automatic scheduler or return', async () => {
      await setFixture(page, { ...good, finalUrl: 'https://qoj.ac/login' });
      await page.evaluate(() => (window as any).syncStore.sync(true));
      const pausedCount = await probeRequests(page);
      await page.evaluate(async () => { const s = (window as any).syncStore; s.enabled = true; await s.sync(false); });
      expect(await probeRequests(page), 'auth failure must pause interval retries').toBe(pausedCount);
      await setFixture(page, good);
      await page.bringToFront();
      await page.evaluate(() => (window as any).syncStore.sync(false, undefined, true));
      expect(await probeRequests(page), 'manual failure must not retry on return even when auto sync is enabled').toBe(pausedCount);
      await page.evaluate(() => { (window as any).syncStore.enabled = false; });
    });

    await test.step('manual login failure never retries on focus', async () => {
      await setFixture(page, { ...good, finalUrl: 'https://qoj.ac/login' });
      await page.evaluate(() => (window as any).syncStore.sync(true));
      const manualRecoveryCount = await probeRequests(page);
      await page.evaluate(f => { (window as any).probeFixture = f; window.dispatchEvent(new Event('focus')); }, good);
      await page.waitForFunction(() => !(window as any).syncStore.busy);
      expect(await probeRequests(page)).toBe(manualRecoveryCount);
      expect((await store(page)).enabled).toBe(false);
    });

    await test.step('store: persisted rate limit blocks manual retries', async () => {
      await setFixture(page, { ...good, status: 429, responseHeaders: 'Retry-After: 600' });
      await page.evaluate(() => (window as any).syncStore.sync(true));
      const count = await probeRequests(page);
      await page.evaluate(() => (window as any).syncStore.sync(true));
      expect(await probeRequests(page), 'manual requests must respect 429 backoff').toBe(count);
    });

    let second: Page;
    const totalProbes = async () => (await probeRequests(page)) + (await probeRequests(second));
    await test.step('actual Web Locks: two tabs, one upstream request', async () => {
      // Remove only test records in this disposable context to isolate lock behaviour.
      await page.evaluate(async () => { const { localDb } = await import('/src/lib/local-db.ts' as string); await localDb.syncRecords.clear(); });
      second = await context.newPage();
      await second.goto('/members');
      await second.evaluate(async () => { (window as any).syncStore = (await import('/src/stores/qoj-sync.ts' as string)).useQojSyncStore(); });
      for (const p of [page, second]) await p.evaluate(f => { (window as any).probeFixture = { ...f, delay: 500 }; (window as any).probeRequests = 0; }, good);
      await Promise.all([page, second].map(p => p.evaluate(() => (window as any).syncStore.sync(true))));
      expect(await totalProbes()).toBe(1);
    });

    await test.step('fresh data suppresses automatic requests', async () => {
      await page.evaluate(async () => { const s = (window as any).syncStore; s.enabled = true; await s.sync(false); });
      expect(await totalProbes()).toBe(1);
    });

    await test.step('site update dialogs: old versions auto-prompt, dismissal dedup, newer/absent scripts do not prompt, manager auto-update disabled', async () => {
      const updateDialog = page.getByRole('dialog', { name: 'QOJ 脚本有更新' });
      await page.evaluate(async () => { (await import('/src/stores/feedback.ts' as string)).useFeedbackStore().close(); });
      const initialUpdateRequests = updateRequests;
      await page.evaluate(async () => { const w = window as any; w.syncStore.enabled = false; w.GM_info.script.version = '1.0.2'; await w.syncStore.check(); });
      await expect(updateDialog).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      await page.evaluate(() => (window as any).syncStore.check());
      await expect(page.getByRole('dialog'), 'same update must not repeatedly prompt').toHaveCount(0);
      expect((await store(page)).updateRequired).toBe(true);
      const oldRequests = await probeRequests(page);
      await page.evaluate(() => (window as any).syncStore.sync(true));
      expect(await probeRequests(page), 'unsupported script must not request QOJ').toBe(oldRequests);
      await expect(updateDialog).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('link', { name: '更新脚本', exact: false })).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      await page.evaluate(async () => { const w = window as any; w.GM_info.script.version = '1.0.3'; await w.syncStore.check(); });
      expect((await store(page)).updateRequired).toBe(false);
      expect((await store(page)).updateAvailable).toBe(true);
      await expect(updateDialog).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      await page.evaluate(async () => { const w = window as any; w.GM_info.script.version = '1.0.10'; await w.syncStore.check(); });
      expect((await store(page)).updateAvailable, 'newer installs must not be downgraded').toBe(false);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(updateRequests, 'repeated hello must not refetch the version manifest within six hours').toBe(initialUpdateRequests);
      const download = await (await page.request.get('/userscripts/qoj-sync.user.js')).text();
      expect(download).toContain('// @downloadURL  none');
      expect(download).not.toContain('@updateURL');
      const manifest = await (await page.request.get('/userscripts/qoj-sync.version.json')).json();
      expect(manifest.version).toBe(scriptVersion);
    });
  });

  test('compact UI without a script: no unsolicited setup, click-only help, shared sync card, button status, management settings', async ({ page }) => {
    const storeIdle = () => page.waitForFunction(async () => { const { useQojSyncStore } = await import('/src/stores/qoj-sync.ts' as string); return !useQojSyncStore().checking; });
    await page.goto('/members');
    await dismissQojIntro(page);
    await page.evaluate(async () => { await (await import('/src/stores/qoj-sync.ts' as string)).useQojSyncStore().setUseUserscript(true); });
    await storeIdle();
    await expect(page.getByRole('dialog'), 'opening members must not show setup').toHaveCount(0);
    const card = page.getByRole('region', { name: '同步做题记录' });
    const cfBox = await card.getByRole('button', { name: /同步 Codeforces/ }).boundingBox();
    const qojBox = await card.getByRole('button', { name: /^同步 QOJ / }).boundingBox();
    expect(cfBox && qojBox && Math.abs(cfBox.y - qojBox.y) < 2, 'CF and QOJ must be side by side in the same card').toBe(true);
    await page.getByRole('button', { name: /^同步 QOJ / }).click();
    await expect(page.getByRole('dialog', { name: '未连接 QOJ 同步脚本' })).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('button', { name: '检测连接', exact: true })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: '自动同步', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^同步 QOJ / })).toHaveAttribute('title', '脚本未连接');
    await page.reload();
    await storeIdle();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.qoj-sync-group').getByRole('button', { name: 'QOJ 同步帮助' })).toHaveCount(1);
    await page.getByRole('button', { name: 'QOJ 同步帮助' }).click();
    await page.waitForURL(url => url.pathname.endsWith('/help/qoj') && url.hash === '#userscript');
    await expect(page.getByRole('heading', { name: 'QOJ 做题记录同步' })).toBeVisible();
    await expect(page.getByRole('dialog'), 'help is a page, not a dialog').toHaveCount(0);
    await page.goto('/manage');
    await expect(page.getByRole('switch', { name: '自动同步', exact: true })).toBeVisible();
  });
});
