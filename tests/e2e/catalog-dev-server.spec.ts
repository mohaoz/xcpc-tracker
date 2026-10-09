// Regression for regenerating catalog assets while the dev server is running.
// Note: this regenerates the
// static catalog assets (scripts/generate-web-catalog-assets.mjs) in place.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { APIRequestContext } from '@playwright/test';
import { attachScreenshot, dismissQojIntro, expect, repoPath, test } from './helpers/fixtures';

const id = 'abb72fec-deb3-5d04-9ca3-2b16d6c83ed9';

async function json(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  expect(response.status(), path).toBe(200);
  expect(response.headers()['content-type'], path).toMatch(/application\/json/);
  return response.json();
}

test.describe('catalog assets on the dev server', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('detail JSON endpoints before/after regeneration; no gaps during regeneration; missing JSON is 404; exact user URL renders and reloads', async ({ page, request }, testInfo) => {
    const index: { contests: Array<{ id: string; title: string }> } = await json(request, '/generated/contest-index.json');
    const checkAll = async () => { for (const c of index.contests) expect((await json(request, `/generated/contests/${c.id}.json`)).id).toBe(c.id); };

    await test.step('every detail JSON endpoint serves its contest', checkAll);

    await test.step('no gaps while assets are regenerated', async () => {
      await Promise.all([
        promisify(execFile)(process.execPath, ['scripts/generate-web-catalog-assets.mjs'], { cwd: repoPath('.') }),
        (async () => { for (let i = 0; i < 30; i++) expect((await json(request, `/generated/contests/${id}.json`)).id).toBe(id); })(),
      ]);
    });

    await test.step('every detail JSON endpoint still serves its contest after regeneration', checkAll);

    await test.step('missing detail JSON is a JSON 404', async () => {
      const missing = await request.get('/generated/contests/missing.json');
      expect(missing.status()).toBe(404);
      expect(missing.headers()['content-type']).toMatch(/application\/json/);
    });

    await test.step('exact user URL renders and reloads without errors', async () => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('/contests/' + id);
      await dismissQojIntro(page);
      const title = index.contests.find(c => c.id === id)!.title;
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.locator('main')).not.toContainText('Unexpected token');
      await attachScreenshot(page, testInfo, 'fixed-contest');
      await page.reload();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});
