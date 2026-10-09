// Cross-tab member/status refresh and manual marking on the contest detail
// page. 
// Uses Vite modules only, a fresh browser context and synthetic local data.
// No real OJ connection, login, or user browser storage is touched; every
// remote request (other than the stubbed analytics beacon) is aborted.
import type { Page } from '@playwright/test';
import { blockRemoteRequests, catalogContest, expect, test } from './helpers/fixtures';

const contestId = 'fca291f3-d017-5cd3-9298-63a1b624b39e';

const seedMember = (writer: Page, displayName = 'Cross-tab Alice') => writer.evaluate(async displayName => {
  const { localDb, upsertMemberBundle } = await import('/src/lib/local-db.ts' as string);
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

test.describe('contest detail cross-tab refresh', () => {
  test('member/status/handle refresh, default spoiler updates, manual set/solve/clear, same-name recreation, stale click rejection and recovery', async ({ context, baseURL }) => {
    const contest = await catalogContest(contestId);
    const problemId = contest.problemIds[0];
    const remoteRequests = await blockRemoteRequests(context, new URL(baseURL!).origin);
    const errors: string[] = [];
    const writer = await context.newPage();
    const detailPage = await context.newPage();
    const memberPage = await context.newPage();
    for (const page of [writer, detailPage, memberPage]) page.on('pageerror', error => errors.push(error.message));
    const stat = (label: string) => memberPage.locator('.stat-card').filter({ has: memberPage.locator('.stat-card__label', { hasText: label }) }).locator('.stat-card__value');
    const spoilerSwitch = detailPage.getByRole('switch', { name: '显示剧透信息' });
    const firstCell = detailPage.locator('.coverage-cell-button').first();
    let original: any;

    await test.step('seed a member in a writer tab; detail and member tabs render it', async () => {
      await writer.goto('/members');
      await writer.evaluate(async () => {
        const { localDb } = await import('/src/lib/local-db.ts' as string);
        await localDb.appSettings.put({ key: 'qoj_script_intro_seen', value: true });
        const { useFeedbackStore } = await import('/src/stores/feedback.ts' as string);
        useFeedbackStore().close();
      });
      original = await seedMember(writer);
      await detailPage.goto(`/contests/${contest.contestId}`);
      await memberPage.goto('/members/detail-test-alice');
      await expect(detailPage.locator('.coverage-heatmap tbody th')).toHaveText(['Cross-tab Alice']);
      await expect(stat('已做')).toHaveText('0');
      await expect(spoilerSwitch).toHaveAttribute('aria-checked', 'false');
    });

    await test.step('provider attempt in another tab refreshes coverage, stats and default spoiler', async () => {
      await writer.evaluate(async problemId => {
        const { localDb } = await import('/src/lib/local-db.ts' as string);
        const at = new Date().toISOString();
        await localDb.memberProblemStatus.put({ statusId: 'cross-tab-provider-status', memberId: 'detail-test-alice', handleId: 'qoj:detail-test-account', problemId, provider: 'qoj', status: 'attempted', firstSeenAt: at, lastSeenAt: at, sourceRecordId: 'browser-regression', matchMethod: 'provider_id' });
      }, problemId);
      await expect(detailPage.locator('.coverage-cell-button--attempted')).toHaveCount(1);
      await expect(stat('尝试过')).toHaveText('1');
      await expect(memberPage.locator('.contest-source-card').getByText('尝试 1', { exact: true })).toBeVisible();
      await expect(spoilerSwitch).toHaveAttribute('aria-checked', 'true');
    });

    await test.step('attempt upgraded to solved', async () => {
      await writer.evaluate(async () => {
        const { localDb } = await import('/src/lib/local-db.ts' as string);
        await localDb.memberProblemStatus.update('cross-tab-provider-status', { status: 'solved' });
      });
      await expect(detailPage.locator('.coverage-cell-button--solved')).toHaveCount(1);
      await expect(stat('已做')).toHaveText('1');
      await expect(stat('尝试过')).toHaveText('0');
      await expect(memberPage.locator('.contest-source-card').getByText('已做 1', { exact: true })).toBeVisible();
    });

    await test.step('soft-deleting the handle removes its statuses and restores the non-spoiler default', async () => {
      await writer.evaluate(async () => {
        const { softDeleteMemberHandle } = await import('/src/lib/local-db.ts' as string);
        await softDeleteMemberHandle('qoj:detail-test-account');
      });
      await expect(detailPage.locator('.coverage-cell-button--solved')).toHaveCount(0);
      await expect(memberPage.locator('.contest-source-card')).toHaveCount(0);
      await expect(stat('已做')).toHaveText('0');
      await expect(spoilerSwitch).toHaveAttribute('aria-checked', 'false');
    });

    await test.step('manual mark mode cycles attempted -> solved -> unseen', async () => {
      await detailPage.getByRole('button', { name: '进入标记模式' }).click();
      await firstCell.click();
      await expect(firstCell).toHaveClass(/--attempted/);
      await expect(stat('尝试过')).toHaveText('1');
      await firstCell.click();
      await expect(firstCell).toHaveClass(/--solved/);
      await expect(stat('已做')).toHaveText('1');
      await firstCell.click();
      await expect(firstCell).toHaveClass(/--unseen/);
      await expect(stat('已做')).toHaveText('0');
    });

    await test.step('member deletion and same-name recreation', async () => {
      await writer.evaluate(async () => {
        const { softDeleteMember } = await import('/src/lib/local-db.ts' as string);
        await softDeleteMember('detail-test-alice');
      });
      await expect(detailPage.locator('.coverage-heatmap tbody tr')).toHaveCount(0);
      await expect(memberPage.getByText('member not found', { exact: true })).toBeVisible();
      await expect(memberPage.locator('.stat-card')).toHaveCount(0);
      const replacement = await seedMember(writer, 'Replacement Alice');
      expect(replacement.identityRevision).not.toBe(original.identityRevision);
      await expect(detailPage.locator('.coverage-heatmap tbody th')).toHaveText(['Replacement Alice']);
      await expect(memberPage.getByRole('heading', { name: 'Replacement Alice', exact: true })).toBeVisible();
      await expect(detailPage.locator('.coverage-cell-button--solved, .coverage-cell-button--attempted')).toHaveCount(0);
    });

    await test.step('stale click is rejected without writes, with a visible error and recovery', async () => {
      // Invoke the actual click handler with the earlier rendered row identity.
      // This deterministically covers a stale event arriving before liveQuery paints.
      const staleResult = await detailPage.evaluate(async ({ original, problemId }) => {
        let instance = (document.querySelector('.coverage-heatmap') as any).__vueParentComponent;
        while (instance && !instance.setupState.applyMarkToCell) instance = instance.parent;
        if (!instance) throw new Error('Contest detail setup not found');
        const state = instance.setupState;
        const { localDb } = await import('/src/lib/local-db.ts' as string);
        const contents = async () => JSON.stringify(await Promise.all(['members', 'memberHandles', 'memberProblemStatus', 'importSources', 'syncRecords'].map(name => localDb[name].toArray())));
        const before = await contents();
        state.markMode = true;
        await state.applyMarkToCell(problemId, original, 'unseen');
        return { before, after: await contents(), error: state.error as string, busy: state.markSavingCellKey as string };
      }, { original, problemId });
      expect(staleResult.after).toBe(staleResult.before);
      expect(staleResult.error).toMatch(/成员已删除或重新创建/);
      expect(staleResult.busy).toBe('');
      await expect(detailPage.getByText('成员已删除或重新创建，请使用更新后的做题情况重试', { exact: true })).toBeVisible();
      await firstCell.click();
      await expect(firstCell).toHaveClass(/--attempted/);
      await expect(stat('尝试过')).toHaveText('1');
    });

    expect(errors).toEqual([]);
    expect(remoteRequests).toEqual([]);
  });
});
