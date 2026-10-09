// Spoiler gating, coverage, contest search/filters, management settings and
// backup restore. 
// Uses Vite modules only, a fresh browser context, and synthetic local data;
// upstream SRK, Rating or OJ data must never be fetched.
import { analyticsScript, catalogContest, dismissQojIntro, expect, readRepoJson, test } from './helpers/fixtures';
import { database } from './helpers/indexeddb';

const contestId = 'fca291f3-d017-5cd3-9298-63a1b624b39e';

test.describe('contest browsing', () => {
  test('spoiler defaults, coverage, search filters, management settings and backup restore', async ({ page, context, baseURL }) => {
    const contest = await catalogContest(contestId);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const remoteRequests: string[] = [];
    page.on('request', r => { if (r.url() !== analyticsScript && new URL(r.url()).origin !== new URL(baseURL!).origin) remoteRequests.push(r.url()); });
    const toggle = page.getByRole('switch', { name: '显示剧透信息' });
    const awards = page.locator('.award-cutoff-card');

    await test.step('untouched contest defaults to non-spoiler; analytics beacon is configured', async () => {
      await page.goto(`/contests/${contest.contestId}`);
      await dismissQojIntro(page);
      const beacon = page.locator(`script[src="${analyticsScript}"]`);
      await expect(beacon).toHaveCount(1);
      expect(JSON.parse((await beacon.getAttribute('data-cf-beacon'))!)).toEqual({ token: '2023fe69240f4de0a41c271f1fe4aeff' });
      await expect(toggle).toBeVisible();
      await expect(page.locator('[role="switch"]').first()).toBeEnabled();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByRole('link', { name: /查看榜单 ·/ })).toHaveCount(0);
      await expect(awards).toHaveCount(0);
      await expect(page.locator('.problem-tag, .problem-rating')).toHaveCount(0);
      await expect(page.locator('td a[href*="/problem/"]'), 'Whole-contest link interaction must remain unchanged').toHaveCount(0);
    });

    await test.step('spoiler toggle reveals awards/tags/ratings below a fixed coverage card', async () => {
      const heatmapTop = () => page.locator('.coverage-heatmap-card').evaluate(el => el.getBoundingClientRect().top + window.scrollY);
      const heatmapPosition = await heatmapTop();
      await toggle.click();
      await expect(awards).toBeVisible();
      expect(Math.abs(await heatmapTop() - heatmapPosition), 'Spoiler toggle must not move coverage card').toBeLessThan(1);
      expect(await page.locator('.coverage-heatmap-card').evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.award-cutoff-card')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
      expect(await page.locator('.problem-tag').count()).toBeGreaterThan(0);
      expect(await page.locator('.problem-rating').count()).toBeGreaterThan(0);
    });

    await test.step('explicit preference survives reload and overrides attempted status', async () => {
      await page.reload();
      await expect(awards).toBeVisible();
      await toggle.click();
      await database(page, { action: 'member', data: { problemId: contest.problemIds[0] } });
      await page.reload();
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(awards, 'Explicit non-spoiler must override attempted status').toHaveCount(0);
    });

    await test.step('attempt-only touched contest defaults to spoiler; cross-tab preference sync', async () => {
      await database(page, { action: 'clear', data: { contestId: contest.contestId } });
      await page.reload();
      await expect(awards).toBeVisible();
      const other = await context.newPage();
      await other.goto(`/contests/${contest.contestId}`);
      await expect(other.locator('.award-cutoff-card')).toBeVisible();
      await toggle.click();
      await expect(other.locator('.award-cutoff-card')).toHaveCount(0);
      await other.close();
    });

    await test.step('contest list: no spoilers on cards, 未做/已做 filters, no-spoiler medal search', async () => {
      await page.goto('/contests');
      const search = page.getByLabel('搜索', { exact: true });
      await search.fill('2026 深圳');
      const card = page.locator(`a.contest-card[href$="/contests/${contest.contestId}"]`);
      await expect(card).toBeVisible();
      await expect(card.getByRole('button', { name: /剧透/ })).toHaveCount(0);
      await expect(card.getByText(/^\d{4}-\d{2}-\d{2}$/)).toHaveCount(0);
      await expect(card.locator('.contest-award-range')).toHaveCount(0);
      await page.getByRole('button', { name: '未做', exact: true }).click();
      await expect(card).toHaveCount(0);
      await page.getByRole('button', { name: '已做', exact: true }).click();
      await expect(card).toBeVisible();
      await search.fill('2026 深圳 -金牌');
      await expect(card).toHaveCount(0);
      await search.fill('2026 深圳');
      await expect(card).toBeVisible();
      await card.click();
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(awards).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    await test.step('unconfirmed start-time note is not shown', async () => {
      const dateNoteContest = await catalogContest(c => !!c.notes?.includes('具体开赛时刻未确认'));
      await page.goto(`/contests/${dateNoteContest.contestId}`);
      await expect(toggle).toBeVisible();
      await expect(page.getByText(/具体开赛时刻未确认/)).toHaveCount(0);
    });

    await test.step('bulk spoilers on/off and attempted heatmap cell', async () => {
      await page.goto('/manage');
      const allSpoilers = page.getByRole('button', { name: '全部剧透', exact: true });
      const touchedSpoilers = page.getByRole('button', { name: '默认', exact: true });
      await expect(touchedSpoilers).toHaveAttribute('aria-pressed', 'true');
      await allSpoilers.click();
      await expect(allSpoilers).toHaveAttribute('aria-pressed', 'true');
      await page.goto(`/contests/${contest.contestId}`);
      await expect(page.locator('.problem-rating').first()).toBeVisible();
      const attempted = page.locator('.coverage-cell-button--attempted');
      await expect(attempted).toHaveCount(1);
      expect(await attempted.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(214, 69, 69)');
      await expect(page.locator('.coverage-heatmap tbody tr')).toHaveCount(1);
      await expect(page.locator('.coverage-heatmap tbody td:not(.coverage-heatmap__total)')).toHaveCount(contest.problemIds.length);
      await page.goto('/manage');
      await touchedSpoilers.click();
      await expect(touchedSpoilers).toHaveAttribute('aria-pressed', 'true');
      // The touched default shows spoilers for a touched contest.
      await page.goto(`/contests/${contest.contestId}`);
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('.problem-rating').first()).toBeVisible();
    });

    await test.step('manual spoiler choices survive the global default and can be reset', async () => {
      const reset = page.getByRole('button', { name: '恢复默认', exact: true });
      // Earlier steps flipped this contest by hand; reset returns it to the default.
      if (await reset.isVisible()) await reset.click();
      await expect(reset).toHaveCount(0);
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(page.locator('.problem-tag, .problem-rating')).toHaveCount(0);
      await expect(reset).toBeVisible();

      await page.goto('/manage');
      await expect(page.getByText('有 1 场比赛在详情页被单独切换过剧透。')).toBeVisible();
      const allSpoilers = page.getByRole('button', { name: '全部剧透', exact: true });
      await allSpoilers.click();
      await expect(allSpoilers).toHaveAttribute('aria-pressed', 'true');
      await page.goto(`/contests/${contest.contestId}`);
      await expect(toggle, 'a manual off wins over the global default').toHaveAttribute('aria-checked', 'false');

      await reset.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(reset).toHaveCount(0);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(reset).toBeVisible();
      await page.goto('/manage');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: '全部恢复默认' }).click();
      await expect(page.getByText('没有单独切换过剧透的比赛。', { exact: false })).toBeVisible();

      // 全部不剧透: even a touched contest hides spoilers; the list shows ✓.
      const noSpoilers = page.getByRole('button', { name: '全部不剧透', exact: true });
      await noSpoilers.click();
      await expect(noSpoilers).toHaveAttribute('aria-pressed', 'true');
      await page.goto(`/contests/${contest.contestId}`);
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(page.locator('.problem-tag, .problem-rating')).toHaveCount(0);
      await page.goto('/contests');
      await page.getByLabel('搜索', { exact: true }).fill('2026 深圳');
      const card = page.locator(`a.contest-card[href$="/contests/${contest.contestId}"]`);
      await expect(card.locator('.contest-medal-badge')).toHaveText('✓');

      await page.goto('/manage');
      const touchedSpoilers = page.getByRole('button', { name: '默认', exact: true });
      await touchedSpoilers.click();
      await expect(touchedSpoilers).toHaveAttribute('aria-pressed', 'true');
    });

    await test.step('medal estimates default on, persist, and gate estimated cutoffs', async () => {
      await page.goto('/manage');
      const estimates = page.getByRole('switch', { name: '允许比例估算' });
      await expect(estimates).toHaveAttribute('aria-checked', 'true');
      await estimates.click();
      await expect(estimates).toHaveAttribute('aria-checked', 'false');
      await estimates.click();
      await expect(estimates).toHaveAttribute('aria-checked', 'true');
      await page.reload();
      await expect(estimates).toHaveAttribute('aria-checked', 'true');
      const estimatedContest = await catalogContest(c => !!c.estimatedAwardCutoffs);
      await page.goto(`/contests/${estimatedContest.contestId}`);
      await toggle.click();
      await expect(awards).toBeVisible();
      await page.goto('/manage');
      await estimates.click();
      await expect(estimates).toHaveAttribute('aria-checked', 'false');
      await page.goto(`/contests/${estimatedContest.contestId}`);
      await expect(toggle).toBeVisible();
      await expect(awards).toHaveCount(0);
    });

    await test.step('backup UI: explicit replacement warning, cancel/invalid input preservation, confirmed replacement without statuses', async () => {
      await page.goto('/manage');
      await page.getByRole('button', { name: '覆盖', exact: true }).click();
      const importSection = page.getByRole('region', { name: '导入', exact: true });
      await importSection.getByRole('checkbox', { name: '包含题目状态' }).uncheck();
      await expect(importSection.getByText(/恢复后没有题目状态/)).toBeVisible();
      const backup = await readRepoJson('fixtures/imports/member-backup.example.json');
      const upload = (payload: unknown) => importSection.locator('input[type=file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
      const readState = () => page.evaluate(async () => {
        const { exportLocalRuntimeSnapshot } = await import('/src/lib/local-db.ts' as string);
        const snapshot = await exportLocalRuntimeSnapshot();
        delete snapshot.exportedAt;
        return snapshot;
      });
      const beforeRestore = await readState();
      expect(beforeRestore.memberProblemStatus.length).toBeGreaterThan(0);
      let confirmMessage = '';
      page.once('dialog', async dialog => { confirmMessage = dialog.message(); await dialog.dismiss(); });
      await upload(backup);
      await expect(page.getByText('已取消导入，原数据未改变')).toBeVisible();
      expect(confirmMessage).toMatch(/恢复为备份中的 1 名成员、0 条状态/);
      expect(await readState()).toEqual(beforeRestore);
      await upload({ ...backup, schemaVersion: 999 });
      await expect(page.getByText('成员备份格式不正确：schemaVersion / exportKind')).toBeVisible();
      expect(await readState()).toEqual(beforeRestore);
      page.once('dialog', dialog => dialog.accept());
      await upload(backup);
      await expect(page.getByText('已导入 1 名成员、0 条题目状态')).toBeVisible();
      const restored = await readState();
      expect(restored.members).toEqual(backup.members);
      expect(restored.memberProblemStatus).toHaveLength(0);
    });

    expect(errors).toEqual([]);
    expect(remoteRequests, 'VP browsing must not fetch upstream SRK, Rating or OJ data').toEqual([]);
  });
});
