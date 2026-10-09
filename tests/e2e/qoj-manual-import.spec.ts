// QOJ manual import mode and the management/members UI around it. Offline;
// all storage belongs to a disposable browser context and QOJ is never
// contacted. 
import type { BrowserContext, Page } from '@playwright/test';
import { attachScreenshot, expect, test } from './helpers/fixtures';

test.use({ viewport: { width: 1440, height: 1000 } });

const statuses = (page: Page) => page.evaluate(async () => (await import('/src/lib/local-db.ts' as string)).localDb.memberProblemStatus.toArray());
const manualPayload = () => ({ provider: 'qoj', exported_at: new Date().toISOString(), members: [{ member_id: 'untrusted-id', handle: 'test', solved: ['1'], attempted: ['2'] }] });

async function countQojRequests(context: BrowserContext) {
  const counter = { upstream: 0 };
  await context.route('https://qoj.ac/**', route => { counter.upstream++; return route.abort(); });
  return counter;
}

/** Adds member 测试成员 (QOJ handle `test`) through the add-member form, which opens the manual dialog. */
async function addManualQojMember(page: Page) {
  await page.goto('/members/new');
  await page.locator('#add-member-platform').selectOption('qoj');
  await page.locator('#add-member-id').fill('测试成员');
  await page.locator('#add-member-handle').fill('test');
  await page.getByRole('button', { name: '添加并手动导入 QOJ' }).click();
}

async function seedManualFixtureCatalog(page: Page) {
  await page.evaluate(async () => {
    const { localDb } = await import('/src/lib/local-db.ts' as string);
    await localDb.catalogContests.put({ contestId: 'manual-fixture', title: 'Manual fixture', aliases: [], tags: [], sources: [], problemIds: ['manual:1', 'manual:2'], generatedFrom: 'manual' });
    await localDb.catalogProblems.bulkPut([1, 2].map(id => ({ problemId: 'manual:' + id, contestId: 'manual-fixture', ordinal: String(id), title: 'Fixture ' + id, aliases: [], sources: [{ provider: 'qoj', provider_problem_id: String(id) }] })));
  });
}

test.describe('QOJ manual import', () => {
  test('manual mode persistence, add-member flow, modal-only fallback, import validation and sync-all ordering', async ({ context, page }, testInfo) => {
    const counter = await countQojRequests(context);
    const intro = page.getByRole('dialog', { name: 'QOJ 支持油猴同步了' });
    const mode = page.getByRole('switch', { name: '使用 QOJ 油猴脚本' });
    const modal = page.getByRole('dialog', { name: 'QOJ 手动导入' });
    let before: unknown[] = [];

    await test.step('manual mode persistence, add-member flow, modal-only fallback, local identity, valid import, invalid/failure preservation, duplicate binding, no QOJ requests', async () => {
      await page.goto('/manage');
      await expect(intro).toBeVisible();
      await attachScreenshot(page, testInfo, 'qoj-intro');
      await intro.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(mode).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByRole('switch', { name: '自动同步', exact: true })).toBeEnabled();
      await expect(page.getByRole('switch', { name: '自动同步', exact: true })).toHaveAttribute('aria-checked', 'false');
      await page.reload();
      await expect(mode).toHaveAttribute('aria-checked', 'false');
      await expect(intro).toHaveCount(0);
      await expect(page.locator('main textarea'), 'management must not duplicate the paste form').toHaveCount(0);
      const importBox = await page.getByRole('region', { name: '导入', exact: true }).boundingBox();
      const exportBox = await page.getByRole('region', { name: '导出', exact: true }).boundingBox();
      expect(!!(importBox && exportBox && Math.abs(importBox.y - exportBox.y) < 2 && exportBox.x > importBox.x), 'import/export must be side by side').toBe(true);
      const importButton = await page.getByRole('button', { name: '选择备份文件' }).boundingBox();
      const exportButton = await page.getByRole('button', { name: '导出备份' }).boundingBox();
      expect(!!(importButton && exportButton && Math.abs(importButton.y - exportButton.y) < 2 && Math.abs(importButton.height - exportButton.height) < 2), 'backup action buttons must align').toBe(true);
      await expect(page.getByRole('button', { name: /QOJ 手动导入|同步 QOJ|油猴使用帮助/ }), 'QOJ actions belong on the members page').toHaveCount(0);
      await attachScreenshot(page, testInfo, 'qoj-settings');

      await addManualQojMember(page);
      await expect(modal).toBeVisible();
      expect(page.url()).toMatch(/\/members$/);
      expect(context.pages(), 'opening manual flow must not open QOJ').toHaveLength(1);
      await attachScreenshot(page, testInfo, 'qoj-manual');
      await seedManualFixtureCatalog(page);
      const payload = manualPayload();
      await page.locator('#qoj-manual-json').fill(JSON.stringify(payload));
      await modal.getByRole('button', { name: '导入记录' }).click();
      await expect(modal.getByRole('status').filter({ hasText: '已导入 1 个账号' })).toBeVisible();
      before = await statuses(page);
      expect(before.length).toBeGreaterThanOrEqual(2);
      expect(before.every((r: any) => r.memberId === '测试成员'), 'import must use local identity').toBe(true);
      for (const invalid of [
        '{',
        { ...payload, members: [{ handle: 'other', solved: [], attempted: [] }] },
        { ...payload, members: [{ handle: 'test', solved: [] }] },
        { ...payload, members: [payload.members[0], payload.members[0]] },
      ]) {
        await page.locator('#qoj-manual-json').fill(typeof invalid === 'string' ? invalid : JSON.stringify(invalid));
        await modal.getByRole('button', { name: '导入记录' }).click();
        await expect(modal.getByRole('alert')).toBeVisible();
        expect(await statuses(page)).toEqual(before);
      }
      await page.locator('#qoj-manual-json').fill(JSON.stringify({ provider: 'qoj', members: [], fetch_failures: [{ handle: 'test', error: 'not logged in' }] }));
      await modal.getByRole('button', { name: '导入记录' }).click();
      await expect(modal.getByRole('status').filter({ hasText: '原记录保留' })).toBeVisible();
      expect(await statuses(page)).toEqual(before);
      await modal.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(page.getByRole('button', { name: '同步 QOJ (1)', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '同步全部', exact: true }).click();
      await expect(modal).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^同步 QOJ / }).click();
      await expect(modal).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0);
      expect(counter.upstream, 'manual mode must not contact QOJ').toBe(0);
      await page.goto('/manage');
      await mode.click();
      await expect(mode).toHaveAttribute('aria-checked', 'true');
      await page.goto('/members');
      await page.getByRole('button', { name: '手动导出', exact: true }).click();
      await expect(modal).toBeVisible();
      await page.keyboard.press('Escape');
      await attachScreenshot(page, testInfo, 'qoj-toolbar');
      await page.evaluate(async () => {
        const { linkQojMember } = await import('/src/lib/qoj.ts' as string);
        let rejected = false; try { await linkQojMember('other', 'test'); } catch { rejected = true; }
        if (!rejected) throw new Error('duplicate binding accepted');
      });
      expect(await statuses(page)).toEqual(before);
      // Restore manual mode for the following steps.
      await page.goto('/manage');
      await mode.click();
      await expect(mode).toHaveAttribute('aria-checked', 'false');
    });

    await test.step('sync all: CF then QOJ; stop prevents starting QOJ', async () => {
      await page.goto('/members');
      await page.evaluate(async () => {
        const { localDb } = await import('/src/lib/local-db.ts' as string);
        const at = new Date().toISOString();
        await localDb.memberHandles.put({ handleId: 'codeforces:test', memberId: '测试成员', provider: 'codeforces', handle: 'test', createdAt: at, updatedAt: at, displayLabel: null });
        await (await import('/src/stores/qoj-sync.ts' as string)).useQojSyncStore().setUseUserscript(false);
      });
      let cfRequests = 0, hold = false;
      let releaseRequest: (() => void) | undefined;
      await page.route('https://codeforces.com/api/user.status*', async route => {
        cfRequests++;
        if (hold) await new Promise<void>(resolve => { releaseRequest = resolve; });
        await route.fulfill({ json: { status: 'OK', result: [] } });
      });
      await page.reload();
      await expect(page.getByRole('button', { name: '同步 Codeforces (1)', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: '同步全部', exact: true }).click();
      await expect(modal).toBeVisible();
      expect(cfRequests, 'sync all must request CF before QOJ manual flow').toBe(1);
      await page.keyboard.press('Escape');
      hold = true;
      await page.getByRole('button', { name: '同步全部', exact: true }).click();
      await expect.poll(() => cfRequests).toBe(2);
      await page.getByRole('button', { name: '停止全部', exact: true }).click();
      releaseRequest!();
      await expect(page.getByRole('button', { name: '同步全部', exact: true })).toBeEnabled();
      await expect(modal).toHaveCount(0);
    });
  });

  test('manual-to-userscript handoff: missing script shows help, global mode enabled, periodic sync remains off, records preserved', async ({ context, page }) => {
    const counter = await countQojRequests(context);
    const modal = page.getByRole('dialog', { name: 'QOJ 手动导入' });
    await page.goto('/manage');
    await page.getByRole('dialog', { name: 'QOJ 支持油猴同步了' }).getByRole('button', { name: '关闭', exact: true }).click();
    await addManualQojMember(page);
    await expect(modal).toBeVisible();
    await seedManualFixtureCatalog(page);
    await page.locator('#qoj-manual-json').fill(JSON.stringify(manualPayload()));
    await modal.getByRole('button', { name: '导入记录' }).click();
    await expect(modal.getByRole('status').filter({ hasText: '已导入 1 个账号' })).toBeVisible();
    const before = await statuses(page);
    expect(before.length).toBeGreaterThanOrEqual(2);
    await modal.getByRole('button', { name: '关闭', exact: true }).click();

    await page.getByRole('button', { name: /^同步 QOJ / }).click();
    await modal.getByRole('button', { name: '启动自动导入 →' }).click();
    await expect(page.getByRole('dialog', { name: '未连接 QOJ 同步脚本' })).toBeVisible();
    await expect(modal).toHaveCount(0);
    const settings = await page.evaluate(async () => { const s = (await import('/src/stores/qoj-sync.ts' as string)).useQojSyncStore(); return { mode: s.useUserscript, auto: s.enabled }; });
    expect(settings).toEqual({ mode: true, auto: false });
    expect(await statuses(page)).toEqual(before);
    expect(counter.upstream).toBe(0);
  });
});
