import type { Page } from '@playwright/test';

import { catalogContest, dismissQojIntro, expect, test } from './helpers/fixtures';

const picker = (page: Page) => page.getByRole('group', { name: '成员筛选' });
const memberChip = (page: Page, name: string) => picker(page).getByRole('button', { name, exact: true });
const heatmapRows = (page: Page) => page.locator('.coverage-heatmap tbody th');

/** Two active members without statuses; the startup intro is marked as seen. */
async function seedMembers(page: Page) {
  await page.evaluate(async () => {
    const { localDb } = await import('/src/lib/local-db.ts');
    const now = '2026-10-09T00:00:00.000Z';
    await localDb.transaction('rw', localDb.members, localDb.memberHandles, localDb.appSettings, async () => {
      for (const id of ['alice', 'bob']) {
        await localDb.members.put({ memberId: id, displayName: id === 'alice' ? 'Alice' : 'Bob', createdAt: now, updatedAt: now, identityRevision: id } as never);
        await localDb.memberHandles.put({ handleId: `manual:${id}`, memberId: id, provider: 'manual', handle: id, createdAt: now, updatedAt: now, identityRevision: id } as never);
      }
      await localDb.appSettings.put({ key: 'qoj_script_intro_seen', value: true });
    });
  });
}

test.describe('shared member selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/contests');
    await dismissQojIntro(page);
    await seedMembers(page);
    await page.goto('/contests');
    await page.locator('.contest-card').first().waitFor();
  });

  test('the list mirrors a subset to the URL and carries it into detail links', async ({ page }) => {
    await memberChip(page, 'Bob').click();
    await expect(page).toHaveURL(/[?&]members=alice(&|$)/);
    await expect(page.locator('a.contest-card').first()).toHaveAttribute('href', /members=alice/);
  });

  test('detail edits the same selection, and browser back keeps it', async ({ page }) => {
    await memberChip(page, 'Bob').click();
    await page.locator('a.contest-card').first().click();
    await expect(heatmapRows(page)).toHaveText(['Alice']);

    await memberChip(page, 'Bob').click();
    await expect(heatmapRows(page)).toHaveText(['Alice', 'Bob']);
    await expect(page).not.toHaveURL(/members=/);

    await page.goBack();
    await expect(memberChip(page, 'Bob')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).not.toHaveURL(/members=/);
  });

  test('a detail URL with members selects them on a fresh load', async ({ page }) => {
    const contest = await catalogContest(c => c.problemIds.length >= 12);
    await page.goto(`/contests/${contest.contestId}?members=bob`);
    await expect(heatmapRows(page)).toHaveText(['Bob']);
    await expect(memberChip(page, 'Alice')).toHaveAttribute('aria-pressed', 'false');
  });

  test('member detail links to that member’s contests and to adding an account', async ({ page }) => {
    await page.goto('/members/alice');
    await page.getByRole('link', { name: '查看 TA 的比赛' }).click();
    await expect(memberChip(page, 'Alice')).toHaveAttribute('aria-pressed', 'true');
    await expect(memberChip(page, 'Bob')).toHaveAttribute('aria-pressed', 'false');

    await page.goto('/members/alice');
    await page.getByRole('link', { name: '添加账号' }).click();
    await expect(page.getByRole('heading', { name: '为 alice 添加账号' })).toBeVisible();
    await expect(page.locator('#add-member-id')).toHaveValue('alice');
  });

  test('an empty selection explains that nothing is placed', async ({ page }) => {
    await picker(page).getByRole('button', { name: '全选' }).click();
    await expect(page.getByRole('status').filter({ hasText: '未选择成员' })).toBeVisible();
  });
});
