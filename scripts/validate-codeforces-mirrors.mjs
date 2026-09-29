import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'xcpc-cf-mirrors-'));
const catalogPath = join(dir, 'catalog.json');
const inputPath = join(dir, 'input.json');
const source = (id, ordinal) => ({ provider: 'codeforces', kind: ordinal ? 'problem' : 'contest',
  url: `https://codeforces.com/gym/${id}${ordinal ? `/problem/${ordinal}` : ''}`,
  [ordinal ? 'provider_problem_id' : 'provider_contest_id']: ordinal ? `${id}:${ordinal}` : id });
const original = { contests: [{ contestId: 'stable', title: 'Curated title', aliases: [], tags: [],
  curationStatus: 'problem_listed', problemIds: ['stable:A', 'stable:B'], sources: [source('100001')] }],
  problems: ['A', 'B'].map(ordinal => ({ problemId: `stable:${ordinal}`, contestId: 'stable', ordinal,
    title: `Problem ${ordinal}`, aliases: [], sources: [source('100001', ordinal)] })) };
const mirror = { title: 'Official mirror', url: 'https://codeforces.com/gym/100002',
  target_contest_ids: ['stable'], problems: ['A', 'B'].map(ordinal => ({ ordinal, title: `Problem ${ordinal}`,
    url: source('100002', ordinal).url, provider_problem_id: `100002:${ordinal}` })) };
function run(input, check = false) {
  writeFileSync(inputPath, JSON.stringify([input]));
  return execFileSync(process.execPath, ['scripts/import-codeforces-problems-export.mjs', inputPath,
    catalogPath, catalogPath, ...(check ? ['--check'] : [])], { encoding: 'utf8', stdio: 'pipe' });
}
writeFileSync(catalogPath, JSON.stringify(original));
run(mirror);
const mergedBytes = readFileSync(catalogPath, 'utf8');
const merged = JSON.parse(mergedBytes);
assert.equal(merged.contests[0].title, original.contests[0].title);
assert.deepEqual(merged.contests[0].problemIds, original.contests[0].problemIds);
assert.deepEqual(merged.problems.map(p => p.problemId), original.problems.map(p => p.problemId));
for (const p of merged.problems) {
  assert.deepEqual(p.sources[0], source('100001', p.ordinal));
  assert.equal(p.sources[1].provider_problem_id, `100002:${p.ordinal}`);
}
run(mirror, true);
assert.equal(readFileSync(catalogPath, 'utf8'), mergedBytes);
const implicitMirror = structuredClone(mirror);
delete implicitMirror.target_contest_ids;
assert.throws(() => run(implicitMirror));
assert.equal(readFileSync(catalogPath, 'utf8'), mergedBytes);
for (const mutate of [
  input => { delete input.target_contest_ids; },
  input => { input.problems[0].title = 'Different task'; },
  input => { input.problems.pop(); },
  input => { [input.problems[0].title, input.problems[1].title] = [input.problems[1].title, input.problems[0].title]; },
]) {
  writeFileSync(catalogPath, JSON.stringify(original));
  const before = readFileSync(catalogPath, 'utf8');
  const invalid = structuredClone(mirror); mutate(invalid);
  // Without explicit targeting this URL is unrelated and must not be merged.
  if (!invalid.target_contest_ids) run(invalid);
  else assert.throws(() => run(invalid));
  assert.equal(readFileSync(catalogPath, 'utf8'), before);
}
execFileSync(process.execPath, ['scripts/import-codeforces-problems-export.mjs',
  'fixtures/imports/codeforces/2026-09-28-problem-lists.json', '--check'], { stdio: 'pipe' });
console.log('CF mirrors: explicit complete-list identity, source/ID preservation, conflict atomicity and release fixture idempotence.');
