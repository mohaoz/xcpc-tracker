import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readJson, sha256, problemIdentity } from '../../scripts/source-import-lib.mjs';

const catalog = await readJson('catalog/default-catalog.min.json');
const standings = await readJson('fixtures/imports/rankland/2026-11-09-additions.json');
const receipt = await readJson('fixtures/imports/catalog-completion/2026-11-09-additions.json');
const qoj = await readJson('fixtures/imports/qoj/2026-11-09-chengdu-ladies-reviewed.json');
const cf = await readJson('fixtures/imports/codeforces/2026-11-09-hunan-reviewed.json');
const ratingPath = 'fixtures/imports/xcpc-rating/2026-11-09-additions-rows.json';
const ratings = await readJson(ratingPath);
const ratingReview = await readJson('fixtures/imports/xcpc-rating/2026-11-09-additions-review.json');

describe('November 2026 Chengdu, CCPC women and Hunan additions', () => {
  it('binds source reviews and preserves all previously published entities', async () => {
    expect(qoj.review.raw_sha256).toBe(sha256(await readFile('fixtures/imports/qoj/2026-11-09-chengdu-ladies-browser-export.json')));
    expect(ratingReview.source_sha256).toBe(sha256(await readFile(ratingPath)));
    expect(standings.rating_reviewed_subset_sha256).toBe(ratingReview.source_sha256);
    expect(standings.contests[2].browser_export.sha256).toBe(sha256(await readFile('fixtures/imports/codeforces/2026-11-09-hunan-browser-export.json')));
    expect(ratingReview.matches).toHaveLength(36);
    expect(ratingReview.unresolved).toEqual([]);
    const ids = new Set(receipt.added_contests);
    const existing = {
      contests: catalog.contests.filter((c: any) => !ids.has(c.contestId)),
      problems: catalog.problems.filter((p: any) => !ids.has(p.contestId)),
    };
    expect(existing.contests).toHaveLength(receipt.existing_entities_unchanged.contests);
    expect(existing.problems).toHaveLength(receipt.existing_entities_unchanged.problems);
    expect(sha256(JSON.stringify(existing))).toBe(receipt.existing_entities_sha256);
  });

  it('publishes complete browser-verified lists with unique owners and original-event dates', () => {
    for (const entry of [...qoj.contests, ...cf]) {
      const target = entry.target_contest ?? entry.target_contests[0];
      const contest = catalog.contests.find((c: any) => c.contestId === target.contest_id);
      const source = standings.contests.find((c: any) => c.contest_id === contest.contestId);
      expect(source.page_verified).toBe(true);
      expect(contest.title).toBe(source.source_title);
      expect(contest.startAt).toBe(new Date(source.start_at).toISOString());
      expect(contest.problemIds).toHaveLength(entry.problems.length);
      expect(contest.sources.find((s: any) => s.is_default)?.url).toBe(source.page_url);
      expect(entry.problems).toStrictEqual(source.problems);
      entry.problems.forEach((p: any, i: number) => {
        expect(p.ordinal).toBe(String.fromCharCode(65 + i));
        const owners = catalog.problems.filter((p2: any) => p2.sources.some((s: any) => problemIdentity(s.url) === problemIdentity(p.url)));
        expect(owners).toHaveLength(1);
        expect(owners[0].contestId).toBe(contest.contestId);
        expect(owners[0].title).toBe(p.title);
        const rating = ratings.find((r: any) => r.problemUrl === p.url);
        expect(rating.title).toBe(p.title);
        expect(Date.parse(rating.startAt)).toBe(Date.parse(contest.startAt));
        expect(owners[0].rating).toBe(rating.problemRating);
        expect(owners[0].tags).toEqual([]);
      });
    }
    const chengdu = catalog.contests.find((c: any) => c.contestId === receipt.added_contests[0]);
    expect(chengdu.title).toContain('成都站');
    expect(chengdu.sources.find((s: any) => s.provider === 'qoj').source_title).toContain('Universal Cup');
    expect(chengdu.startAt).toBe('2026-10-25T01:10:00.000Z');
  });

  it('keeps audited award boundaries and leaves the unsupported women rule unset', () => {
    const expected = [[6, 5, 3], null, [5, 3, 1]];
    standings.contests.forEach((evidence: any, i: number) => {
      const contest = catalog.contests.find((c: any) => c.contestId === evidence.contest_id);
      if (expected[i]) {
        expect(contest.awardCutoffs).toStrictEqual(evidence.award_decision.value);
        expect(['gold', 'silver', 'bronze'].map(m => contest.awardCutoffs.cutoffs[m].solved)).toEqual(expected[i]);
        expect(evidence.award_decision.evidence.ties).toBe('No tied medal boundary');
      } else {
        expect(evidence.award_decision.rule.options.ratio.denominator).toBe('submitted');
        expect(contest.awardCutoffs).toBeUndefined();
      }
      expect(contest.estimatedAwardCutoffs).toBeUndefined();
    });
  });
});
