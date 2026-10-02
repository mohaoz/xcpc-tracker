import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256 } from './source-import-lib.mjs';
import { loadModule } from './validate-coverage.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const catalog = read('catalog/default-catalog.min.json');
const review = read('fixtures/imports/codeforces/2026-10-02-historical-mapping-review.json');
const lists = read('fixtures/imports/codeforces/2026-10-02-historical-problem-lists.json');
const byId = new Map(catalog.problems.map(problem => [problem.problemId, problem]));
const normalizedTitle = title => title.normalize('NFKC').replaceAll('’', "'").replace(/\s+/g, ' ').trim();
const owners = (snapshot, sourceId) => snapshot.problems.filter(problem =>
  problem.sources.some(source => source.provider === 'codeforces' && source.provider_problem_id === sourceId));
assert.deepEqual(review.counts, { source_withdrawals: 11, source_reassignments: 7, false_alias_removals: 18, affected_problems: 18 });
assert.equal(review.before_problems.length, 18);
assert.equal(review.after_problems.length, 18);
for (const after of review.after_problems) assert.deepEqual(byId.get(after.problemId), after);
for (const before of review.before_problems) {
  const after = byId.get(before.problemId);
  for (const key of Object.keys(before).filter(key => !['sources', 'aliases'].includes(key))) {
    assert.deepEqual(after[key], before[key], `${before.problemId}: preserve ${key}`);
  }
  assert.deepEqual(after.sources.filter(source => source.provider !== 'codeforces'),
    before.sources.filter(source => source.provider !== 'codeforces'));
}

const cases = [];
for (const contest of review.original_identity) {
  const list = lists.find(list => list.url === `https://codeforces.com/gym/${contest.cf_contest_id}`);
  assert.equal(list.problems.length, contest.problem_count);
  assert.equal(contest.problems.length, contest.problem_count);
  assert.equal(new Set(list.problems.map(problem => problem.provider_problem_id)).size, contest.problem_count);
  assert.match(contest.original_booklet.sha256, /^[a-f0-9]{64}$/);
  for (const proof of contest.problems) {
    const problem = byId.get(proof.problem_id);
    assert.equal(problem.title, proof.title);
    assert.equal(problem.ordinal, proof.original_ordinal);
    assert.ok(Number.isInteger(proof.original_pdf_page) && proof.original_pdf_page > 0);
    assert.ok(problem.sources.some(source => source.provider === 'qoj'
      && source.provider_problem_id === proof.qoj_problem.provider_problem_id));
    const exported = list.problems.find(row => row.provider_problem_id === proof.cf_problem.providerProblemId);
    assert.equal(exported.url, proof.cf_problem.url);
    assert.equal(exported.title, proof.cf_problem.title);
    assert.equal(normalizedTitle(exported.title), normalizedTitle(proof.title));
    assert.deepEqual(owners(catalog, exported.provider_problem_id).map(owner => owner.problemId), [proof.problem_id]);
    cases.push({ sourceId: exported.provider_problem_id, expected: proof.problem_id });
  }
}
for (const withdrawal of review.withdrawals) {
  const problem = byId.get(withdrawal.removeFrom);
  assert.ok(!problem.aliases.includes(withdrawal.removeFalseAlias));
  assert.deepEqual(owners(catalog, withdrawal.wrongSource.provider_problem_id).map(owner => owner.problemId), [withdrawal.retainOwner]);
  assert.ok(problem.sources.some(source => JSON.stringify(source) === JSON.stringify(withdrawal.retainCorrectSource)));
  cases.push({ sourceId: withdrawal.wrongSource.provider_problem_id, expected: withdrawal.retainOwner });
}
for (const reassignment of review.reassignments) {
  assert.ok(!byId.get(reassignment.from_problem_id).aliases.includes(reassignment.removed_false_alias));
  assert.deepEqual(owners(catalog, reassignment.provider_problem_id).map(owner => owner.problemId), [reassignment.to_problem_id]);
}
assert.equal(cases.length, 49);

if (process.argv.includes('--generated')) {
  const lookup = read('catalog/generated/problem-lookup.json');
  assert.deepEqual(lookup.problems, catalog.problems, 'Generated lookup must retain exact reviewed provider ownership');
  assert.equal(lookup.generated_at, catalog.exportedAt);
  for (const contest of review.original_identity) {
    const detail = read(`catalog/generated/contests/${contest.contest_id}.json`);
    for (const problem of detail.problems) {
      assert.deepEqual(problem.sources, byId.get(problem.id).sources);
    }
  }
  console.log('Generated CF lookup/details: exact reviewed provider IDs, source ownership and generation timestamp verified.');
} else {
  // Exercise the real member adapter with synthetic API replies and in-memory writes.
  // A corrected catalog changes future matches; no historical status migration runs.
  let snapshot = catalog, upstream, written;
  const cf = loadModule('web/src/lib/codeforces.ts', {
    './catalog-runtime': { listRuntimeCatalogProblemsForImport: async () => snapshot.problems },
    './codeforces-auth': { loadCodeforcesApiCredentials: () => null },
    './local-db': {
      localDb: { syncRecords: { toArray: async () => [] } },
      captureMemberSyncGuard: async () => ({}), validateMemberSyncGuard: async () => {},
      upsertMemberBundle: async bundle => { written = bundle; },
    },
  });
  const previousFetch = globalThis.fetch;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const before = structuredClone(catalog);
  for (const row of review.before_problems) before.problems[before.problems.findIndex(problem => problem.problemId === row.problemId)] = row;
  const originalBytes = sha256(JSON.stringify(catalog));
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
    globalThis.fetch = async url => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://codeforces.com');
      assert.equal(parsed.pathname, '/api/user.status');
      assert.equal(parsed.searchParams.get('handle'), 'synthetic_validation_account');
      assert.ok(!parsed.searchParams.has('apiKey'));
      return { ok: true, json: async () => ({ status: 'OK', result: [{ id: 1, verdict: 'OK', problem: upstream }] }) };
    };
    let priorWrong = 0;
    for (const test of cases) {
      const [contestId, index] = test.sourceId.split(':');
      upstream = { contestId: Number(contestId), index };
      for (const candidate of [catalog, before]) {
        snapshot = candidate; written = null;
        await cf.importCodeforcesMember({ memberId: 'synthetic-member', handle: 'synthetic_validation_account' });
        const actual = written.statuses.map(status => status.problemId).sort();
        if (candidate === catalog) assert.deepEqual(actual, [test.expected], test.sourceId);
        else if (JSON.stringify(actual) !== JSON.stringify([test.expected])) priorWrong++;
      }
    }
    assert.equal(priorWrong, 18, 'Negative control must reproduce all 18 historical mapping failures');
    assert.equal(sha256(JSON.stringify(catalog)), originalBytes);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
  console.log('CF historical repairs: 38 original/mirror identities and 11 online identities pass; all 18 failures reproduce in the before-state negative control.');
}
