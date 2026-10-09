// Periodic CF/QOJ synchronization scheduling. Real stores/importers + isolated IndexedDB;
// the CF API is routed and the QOJ userscript bridge is simulated in-page.
import type { Page, Route } from '@playwright/test';
import { attachScreenshot, dismissQojIntro, expect, test } from './helpers/fixtures';

test.use({ viewport: { width: 1440, height: 1000 } });

const nanchang = 'd505e000-4947-579c-8d9b-99e31160839f';

test.describe('automatic sync', () => {
  test('CF and QOJ scheduling, failure isolation, pause/cancel semantics', async ({ context, page }, testInfo) => {
    let cfRequests = 0, cfFailure = false, holdCf = false;
    let releaseCf: (() => void) | undefined;
    await context.route('https://codeforces.com/api/**', async (route: Route) => {
      cfRequests++;
      // Hold CF until QOJ starts: proves platform scheduling is concurrent.
      if (cfRequests === 1 || holdCf) await new Promise<void>(resolve => { releaseCf = resolve; });
      await route.fulfill({ status: cfFailure ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ status: 'OK', result: [] }) }).catch(() => {});
    });
    await context.addInitScript(() => {
      const w = window as any;
      w.qojRequests = 0; w.qojFailure = false;
      window.addEventListener('message', event => {
        const m = event.data; if (m?.protocol !== 'xcpc-sync' || m.direction !== 'request') return;
        let result, error;
        if (m.method === 'hello') result = { version: 1, connected: true, script_version: '1.0.6' };
        else if (m.method === 'syncMember') {
          w.qojRequests++;
          if (w.qojFailure) error = { code: 'AUTH_REQUIRED' };
          else result = { provider: 'qoj', handle: m.params.handle, fetched_at: new Date().toISOString(), snapshot: { scope: 'profile_visible', solved: [], attempted: [] } };
        } else return;
        window.postMessage({ protocol: 'xcpc-sync', version: 1, direction: 'response', request_id: m.request_id, result, error }, location.origin);
      });
    });
    const qojRequests = () => page.evaluate(() => (window as any).qojRequests as number);
    const successes = () => page.evaluate(async () => (await (window as any).db.syncRecords.toArray()).filter((r: any) => r.status === 'succeeded').map((r: any) => r.adapter as string));
    const age = () => page.evaluate(async () => {
      await (window as any).db.syncRecords.toCollection().modify((r: any) => { r.startedAt = new Date(Date.parse(r.startedAt) - 3600000).toISOString(); r.finishedAt = new Date(Date.parse(r.finishedAt) - 3600000).toISOString(); });
    });
    let failedCount = 0;

    await test.step('simultaneous CF/QOJ scheduling and fresh-record deduplication', async () => {
      await page.goto('/manage');
      await dismissQojIntro(page);
      await page.evaluate(async () => {
        const w = window as any;
        const { localDb } = await import('/src/lib/local-db.ts' as string); w.db = localDb;
        w.store = (await import('/src/stores/qoj-sync.ts' as string)).useQojSyncStore();
        const at = new Date().toISOString();
        await localDb.members.put({ memberId: 'auto', displayName: 'Auto', createdAt: at, updatedAt: at });
        await localDb.memberHandles.bulkPut(['qoj', 'codeforces'].map(provider => ({ handleId: provider + ':test', memberId: 'auto', handle: 'test', provider, createdAt: at, updatedAt: at })));
      });
      await page.getByRole('switch', { name: '自动同步', exact: true }).click();
      await expect(page.getByRole('switch', { name: '使用 QOJ 油猴脚本' })).toHaveAttribute('aria-checked', 'true');
      await expect.poll(qojRequests).toBe(1);
      await expect.poll(() => cfRequests).toBe(1);
      releaseCf!();
      await expect.poll(successes).toContain('codeforces_api');
      await expect.poll(successes).toContain('qoj_userscript');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(2200);
      expect(cfRequests).toBe(1);
      expect(await qojRequests()).toBe(1);
    });

    await test.step('QOJ login failure does not block CF', async () => {
      await age();
      await page.evaluate(() => { (window as any).qojFailure = true; window.dispatchEvent(new Event('focus')); });
      await expect.poll(() => cfRequests).toBe(2);
      await expect(page.getByRole('dialog', { name: '请先登录 QOJ' })).toBeVisible();
      await expect.poll(async () => (await successes()).filter(a => a === 'codeforces_api').length).toBe(2);
    });

    await test.step('manual CF failure remains paused', async () => {
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      await page.evaluate(() => (window as any).store.setEnabled(false));
      cfFailure = true;
      await page.evaluate(async () => { try { await (await import('/src/lib/codeforces.ts' as string)).importCodeforcesMember({ memberId: 'auto', handle: 'test' }); } catch { /* expected */ } });
      failedCount = cfRequests;
      await age();
      await page.evaluate(async () => { const s = (window as any).store; await s.setUseUserscript(false); await s.setEnabled(true); });
      await page.waitForTimeout(2200);
      expect(cfRequests, 'manual CF failure must not be retried automatically').toBe(failedCount);
    });

    await test.step('enabling automatic sync enables both providers; unified off switch', async () => {
      cfFailure = false;
      await page.evaluate(async () => { const w = window as any; await w.store.setEnabled(false); w.qojFailure = false; await w.db.syncRecords.clear(); await w.store.setEnabled(true); });
      await expect.poll(() => cfRequests).toBe(failedCount + 1);
      await expect.poll(successes).toContain('codeforces_api');
      await expect.poll(qojRequests, { message: 'enabling automatic sync also enables QOJ script mode' }).toBe(3);
      await page.evaluate(() => (window as any).store.setEnabled(false));
      await age();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(2200);
      expect(cfRequests).toBe(failedCount + 1);
    });

    await test.step('automatic CF failure does not block QOJ', async () => {
      cfFailure = true;
      await page.evaluate(async () => { const w = window as any; w.qojFailure = false; await w.db.syncRecords.clear(); await w.store.setUseUserscript(true); await w.store.setEnabled(true); });
      await expect.poll(successes).toContain('qoj_userscript');
      await expect.poll(() => page.evaluate(async () => (await (window as any).db.syncRecords.toArray()).some((r: any) => r.adapter === 'codeforces_api' && r.status === 'failed' && r.summaryJson.manual === false))).toBe(true);
    });

    await test.step('disabling auto-sync cancels in-flight CF without saving a success', async () => {
      await page.evaluate(() => (window as any).store.setEnabled(false));
      cfFailure = false; holdCf = true; const beforeCancel = cfRequests;
      await page.evaluate(async () => { const w = window as any; await w.db.syncRecords.clear(); await w.store.setUseUserscript(false); await w.store.setEnabled(true); });
      await expect.poll(() => cfRequests).toBe(beforeCancel + 1);
      await page.evaluate(() => (window as any).store.setEnabled(false));
      await expect.poll(() => page.evaluate(async () => (await (window as any).db.syncRecords.toArray()).some((r: any) => r.adapter === 'codeforces_api' && r.status === 'failed'))).toBe(true);
      releaseCf!(); holdCf = false;
      expect((await successes()).filter(a => a === 'codeforces_api')).toHaveLength(0);
      await page.evaluate(() => (window as any).store.setUseUserscript(false));
      expect(await page.evaluate(() => (window as any).store.enabled)).toBe(false);
      await attachScreenshot(page, testInfo, 'auto-sync-settings');
    });
  });

  test('saved auto-only settings: first QOJ import uses script; missing script opens help with working help-page link', async ({ page, baseURL }, testInfo) => {
    await page.goto('/manage');
    await dismissQojIntro(page);
    await page.evaluate(async () => { const { localDb } = await import('/src/lib/local-db.ts' as string); await localDb.appSettings.bulkPut([{ key: 'auto_sync', value: true }, { key: 'qoj_use_userscript', value: false }]); });
    await page.reload();
    await expect(page.getByRole('switch', { name: '使用 QOJ 油猴脚本' })).toHaveAttribute('aria-checked', 'true');
    await page.goto('/members/new');
    await page.locator('#add-member-platform').selectOption('qoj');
    await page.locator('#add-member-id').fill('First');
    await page.locator('#add-member-handle').fill('first');
    await page.getByRole('button', { name: '添加并同步 QOJ', exact: true }).click();
    const help = page.getByRole('dialog', { name: '未连接 QOJ 同步脚本' });
    await expect(help).toBeVisible();
    await attachScreenshot(page, testInfo, 'qoj-help-manage');
    await expect(page.getByRole('dialog', { name: 'QOJ 手动导入' })).toHaveCount(0);
    await help.getByRole('button', { name: '查看帮助' }).click();
    await expect(page).toHaveURL(baseURL + '/help/qoj#userscript');
    await expect(help).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'QOJ 做题记录同步' })).toBeVisible();
  });

  test('Nanchang detail renders official awards when estimates are off', async ({ page }, testInfo) => {
    await page.goto('/manage');
    await dismissQojIntro(page);
    await page.evaluate(async contestId => {
      const { localDb } = await import('/src/lib/local-db.ts' as string);
      await localDb.appSettings.put({ key: 'allow_medal_estimates', value: false });
      await localDb.contestPreferences.put({ contest_id: contestId, spoiler_mode: 'spoiler' });
    }, nanchang);
    await page.goto(`/contests/${nanchang}`);
    await expectOfficialAwards(page);
    await attachScreenshot(page, testInfo, 'nanchang-official');
  });
});

async function expectOfficialAwards(page: Page) {
  const main = page.locator('main');
  await expect(main).toContainText('RankLand');
  for (const rank of [26, 78, 156]) await expect(main).toContainText(`第 ${rank} 名`);
  await expect(main).not.toContainText('比例估算');
}
