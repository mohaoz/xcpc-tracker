import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type BrowserContext, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';

export const repoPath = (relative: string) => fileURLToPath(new URL(relative, new URL('../../../', import.meta.url)));
export const readRepoJson = async <T = any>(relative: string): Promise<T> => JSON.parse(await readFile(repoPath(relative), 'utf8'));
export const readRepoText = (relative: string) => readFile(repoPath(relative), 'utf8');

// Cloudflare Web Analytics beacon injected by index.html. Tests must not send
// regression traffic to analytics nor depend on a live third-party script.
export const analyticsScript = 'https://static.cloudflareinsights.com/beacon.min.js';

export async function stubAnalytics(context: BrowserContext) {
  await context.route('https://static.cloudflareinsights.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
}

/**
 * Abort every request that leaves the app origin (except the stubbed analytics
 * script) and record it, so a test can assert that no remote traffic happened.
 */
export async function blockRemoteRequests(context: BrowserContext, appOrigin: string) {
  const remoteRequests: string[] = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (new URL(url).origin === appOrigin) return route.continue();
    if (url === analyticsScript) return route.fulfill({ contentType: 'application/javascript', body: '' });
    remoteRequests.push(url);
    return route.abort();
  });
  return remoteRequests;
}

/** Closes the one-time "QOJ 支持油猴同步了" startup announcement. */
export async function dismissQojIntro(page: Page) {
  await page.getByRole('dialog', { name: 'QOJ 支持油猴同步了' }).getByRole('button', { name: '关闭', exact: true }).click();
}

export async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

export type CatalogContest = { contestId: string; title: string; problemIds: string[]; notes?: string; estimatedAwardCutoffs?: unknown };
let catalogCache: Promise<{ contests: CatalogContest[] }> | undefined;
export const bundledCatalog = () => (catalogCache ??= readRepoJson('catalog/default-catalog.min.json'));
export async function catalogContest(predicate: string | ((contest: CatalogContest) => boolean)) {
  const match = typeof predicate === 'string' ? (c: CatalogContest) => c.contestId === predicate : predicate;
  const contest = (await bundledCatalog()).contests.find(match);
  expect(contest, 'catalog fixture contest').toBeTruthy();
  return contest!;
}

/**
 * Every test context gets the analytics beacon stubbed. Contexts created by
 * hand through `browser.newContext()` must call `newIsolatedContext` instead.
 */
export const test = base.extend<{ newIsolatedContext: (options?: BrowserContextOptions) => Promise<BrowserContext> }>({
  context: async ({ context }, use) => {
    await stubAnalytics(context);
    await use(context);
  },
  newIsolatedContext: async ({ browser, baseURL }, use) => {
    const created: BrowserContext[] = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({ baseURL, ...options });
      await stubAnalytics(context);
      created.push(context);
      return context;
    });
    await Promise.all(created.map(c => c.close()));
  },
});
export { expect };
