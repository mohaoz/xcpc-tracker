import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { readJson } from './source-import-lib.mjs';

// Uses Vite modules only, an isolated browser profile, and synthetic local data.
// No real OJ connection, login, or user browser storage is touched.
const base = process.env.VP_TEST_URL ?? 'http://127.0.0.1:5173';
const catalog = await readJson('catalog/default-catalog.min.json');
const contest = catalog.contests.find(row => row.contestId === 'fca291f3-d017-5cd3-9298-63a1b624b39e');
assert.ok(contest);
const problemId = contest.problemIds[0];
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext();
const errors = [];
const remoteRequests = [];
await context.route('**/*', route => {
  const url = route.request().url();
  if (new URL(url).origin === new URL(base).origin) return route.continue();
  if (url === 'https://static.cloudflareinsights.com/beacon.min.js') return route.fulfill({ contentType: 'application/javascript', body: '' });
  remoteRequests.push(url);
  return route.abort();
});
const writer = await context.newPage();
const detailPage = await context.newPage();
const memberPage = await context.newPage();
for (const page of [writer, detailPage, memberPage]) page.on('pageerror', error => errors.push(error.message));
const seed = async (displayName = 'Cross-tab Alice') => writer.evaluate(async displayName => {
  const { localDb, upsertMemberBundle } = await import('/src/lib/local-db.ts');
  const at = '2026-09-30T00:00:00.000Z';
  const sourceRecordId = `test:${crypto.randomUUID()}`;
  await upsertMemberBundle({
    member: { memberId: 'detail-test-alice', displayName, createdAt: at, updatedAt: at },
    handles: [{ handleId: 'qoj:detail-test-account', memberId: 'detail-test-alice', provider: 'qoj', handle: 'detail-test-account', displayLabel: null, createdAt: at, updatedAt: at }],
    statuses: [],
    importSource: { sourceRecordId, kind: 'manual_entry', label: 'Isolated browser regression', importedAt: at, rawMetaJson: {} },
    syncRecord: { syncId: sourceRecordId, sourceRecordId, adapter: 'manual', startedAt: at, finishedAt: at, status: 'succeeded', summaryJson: {} },
  });
  return localDb.members.get('detail-test-alice');
}, displayName);
const stat = label => memberPage.locator('.stat-card').filter({ has: memberPage.locator('.stat-card__label', { hasText: label }) }).locator('.stat-card__value');
try {
  await writer.goto(`${base}/members`);
  await writer.evaluate(async () => {
    const { localDb } = await import('/src/lib/local-db.ts');
    await localDb.appSettings.put({ key: 'qoj_script_intro_seen', value: true });
    const { useFeedbackStore } = await import('/src/stores/feedback.ts');
    useFeedbackStore().close();
  });
  const original = await seed();
  await detailPage.goto(`${base}/contests/${contest.contestId}`);
  await memberPage.goto(`${base}/members/detail-test-alice`);
  await expect(detailPage.locator('.coverage-heatmap tbody th')).toHaveText(['Cross-tab Alice']);
  await expect(stat('已做')).toHaveText('0');
  await expect(detailPage.getByRole('switch', { name: '显示剧透信息' })).toHaveAttribute('aria-checked', 'false');

  await writer.evaluate(async problemId => {
    const { localDb } = await import('/src/lib/local-db.ts');
    const at = new Date().toISOString();
    await localDb.memberProblemStatus.put({ statusId: 'cross-tab-provider-status', memberId: 'detail-test-alice', handleId: 'qoj:detail-test-account', problemId, provider: 'qoj', status: 'attempted', firstSeenAt: at, lastSeenAt: at, sourceRecordId: 'browser-regression', matchMethod: 'provider_id' });
  }, problemId);
  await expect(detailPage.locator('.coverage-cell-button--attempted')).toHaveCount(1);
  await expect(stat('尝试过')).toHaveText('1');
  await expect(memberPage.locator('.contest-source-card').getByText('尝试 1', { exact: true })).toBeVisible();
  await expect(detailPage.getByRole('switch', { name: '显示剧透信息' })).toHaveAttribute('aria-checked', 'true');

  await writer.evaluate(async () => {
    const { localDb } = await import('/src/lib/local-db.ts');
    await localDb.memberProblemStatus.update('cross-tab-provider-status', { status: 'solved' });
  });
  await expect(detailPage.locator('.coverage-cell-button--solved')).toHaveCount(1);
  await expect(stat('已做')).toHaveText('1');
  await expect(stat('尝试过')).toHaveText('0');
  await expect(memberPage.locator('.contest-source-card').getByText('已做 1', { exact: true })).toBeVisible();

  await writer.evaluate(async () => {
    const { softDeleteMemberHandle } = await import('/src/lib/local-db.ts');
    await softDeleteMemberHandle('qoj:detail-test-account');
  });
  await expect(detailPage.locator('.coverage-cell-button--solved')).toHaveCount(0);
  await expect(memberPage.locator('.contest-source-card')).toHaveCount(0);
  await expect(stat('已做')).toHaveText('0');
  await expect(detailPage.getByRole('switch', { name: '显示剧透信息' })).toHaveAttribute('aria-checked', 'false');

  await detailPage.getByRole('button', { name: '进入标记模式' }).click();
  const firstCell = detailPage.locator('.coverage-cell-button').first();
  await firstCell.click();
  await expect(firstCell).toHaveClass(/--attempted/);
  await expect(stat('尝试过')).toHaveText('1');
  await firstCell.click();
  await expect(firstCell).toHaveClass(/--solved/);
  await expect(stat('已做')).toHaveText('1');
  await firstCell.click();
  await expect(firstCell).toHaveClass(/--unseen/);
  await expect(stat('已做')).toHaveText('0');

  await writer.evaluate(async () => {
    const { softDeleteMember } = await import('/src/lib/local-db.ts');
    await softDeleteMember('detail-test-alice');
  });
  await expect(detailPage.locator('.coverage-heatmap tbody tr')).toHaveCount(0);
  await expect(memberPage.getByText('member not found', { exact: true })).toBeVisible();
  await expect(memberPage.locator('.stat-card')).toHaveCount(0);
  const replacement = await seed('Replacement Alice');
  assert.notEqual(replacement.identityRevision, original.identityRevision);
  await expect(detailPage.locator('.coverage-heatmap tbody th')).toHaveText(['Replacement Alice']);
  await expect(memberPage.getByRole('heading', { name: 'Replacement Alice', exact: true })).toBeVisible();
  await expect(detailPage.locator('.coverage-cell-button--solved, .coverage-cell-button--attempted')).toHaveCount(0);

  // Invoke the actual click handler with the earlier rendered row identity.
  // This deterministically covers a stale event arriving before liveQuery paints.
  const staleResult = await detailPage.evaluate(async ({ original, problemId }) => {
    let instance = document.querySelector('.coverage-heatmap').__vueParentComponent;
    while (instance && !instance.setupState.applyMarkToCell) instance = instance.parent;
    if (!instance) throw new Error('Contest detail setup not found');
    const state = instance.setupState;
    const { localDb } = await import('/src/lib/local-db.ts');
    const contents = async () => JSON.stringify(await Promise.all(['members', 'memberHandles', 'memberProblemStatus', 'importSources', 'syncRecords'].map(name => localDb[name].toArray())));
    const before = await contents();
    state.markMode = true;
    await state.applyMarkToCell(problemId, original, 'unseen');
    return { before, after: await contents(), error: state.error, busy: state.markSavingCellKey };
  }, { original, problemId });
  assert.equal(staleResult.after, staleResult.before);
  assert.match(staleResult.error, /成员已删除或重新创建/);
  assert.equal(staleResult.busy, '');
  await expect(detailPage.getByText('成员已删除或重新创建，请使用更新后的做题情况重试', { exact: true })).toBeVisible();
  await firstCell.click();
  await expect(firstCell).toHaveClass(/--attempted/);
  await expect(stat('尝试过')).toHaveText('1');
  assert.deepEqual(errors, []);
  assert.deepEqual(remoteRequests, []);
  console.log('PASS real-browser cross-tab member/status/handle refresh, default spoiler updates, manual set/solve/clear, same-name recreation, stale click no-write rejection, and visible error recovery');
} finally {
  await browser.close();
}
