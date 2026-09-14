import { readFile, access, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicJson, readJson, sha256, download, parallel, normalizeTitle, unique } from './source-import-lib.mjs';
import { parseIndex, verifyPage, calculateAwards, awardResult, preferredAwardGroup } from './rankland-lib.mjs';
import { validateSchema } from './validate-source-schemas.mjs';

export const SRK_COMMIT = 'a820e48181a28a1a30bfbcf965b320606e337e15';
const base = `https://raw.githubusercontent.com/algoux/srk-collection/${SRK_COMMIT}`;
const repository = 'https://github.com/algoux/srk-collection';

export function candidatesFor(catalog, index, rating) {
  return index.map(entry => {
    const slug = entry.srk_path.replace(/^official\//, '').replace(/\.srk\.json$/, '').replaceAll('/', '__');
    const candidates = rating.contest_mappings.filter(m => m.contest_slug === slug);
    return { ...entry, candidates };
  });
}
async function cached(url, path) {
  try { await access(path); } catch { await download(url, path); }
}
export async function inspectRankland(cache, ratingPath, catalogPath) {
  const [catalogBytes, indexBytes, collectionBytes, rating] = await Promise.all([
    readFile(catalogPath), readFile(resolve(cache, 'config.yaml')), readFile(resolve(cache, 'collection.json')), readJson(ratingPath),
  ]);
  const catalog = JSON.parse(catalogBytes), collection = JSON.parse(collectionBytes);
  const entries = [], failures = [], differences = [];
  const indexed = candidatesFor(catalog, parseIndex(indexBytes.toString()), rating);
  for (const item of indexed.filter(i => i.candidates.length)) {
    try {
      const bytes = await readFile(resolve(cache, item.srk_path));
      const srk = JSON.parse(bytes);
      const info = await readJson(resolve(cache, `${item.srk_path}.info.json`));
      const page = verifyPage(item, collection, info, srk);
      const source = {
        provider: 'rankland', collection: 'official', provider_contest_id: `srk:${item.srk_path}`, srk_path: item.srk_path,
        repository_url: repository, commit_sha: SRK_COMMIT, content_sha256: sha256(bytes), index_sha256: sha256(indexBytes),
        srk_version: srk.version, fetched_at: (await stat(resolve(cache, item.srk_path))).mtime.toISOString(), page_url: page, page_verified_at: (await stat(resolve(cache, `${item.srk_path}.info.json`))).mtime.toISOString(),
        source_title: srk.contest.title['zh-CN'] ?? srk.contest.title.fallback ?? Object.values(srk.contest.title)[0],
        attribution: { name: 'algoUX / srk-collection; ' + (srk.contributors ?? []).join('; '), license_url: `${repository}/blob/${SRK_COMMIT}/LICENSE` },
      };
      const candidateIds = item.candidates.map(m => m.contest_id);
      const entry = { entry_id: source.provider_contest_id, status: candidateIds.length === 1 ? 'pending' : 'conflict', source, candidate_contest_ids: candidateIds, evidence: item.candidates.map(m => `${m.contest_id}: ${JSON.stringify(m.evidence)}`) };
      for (const id of candidateIds) {
        const c = catalog.contests.find(c => c.contestId === id);
        const reasons = [];
        if (c.problemIds.length !== srk.problems.length) reasons.push('problem_count_conflict');
        if (c.startAt && c.startAt.slice(0,10) !== srk.contest.startAt.slice(0,10)) reasons.push('date_conflict');
        // For city/province shared tasks, a matching task list alone is insufficient.
        const category = item.srk_path.split('/')[1];
        const title = normalizeTitle(c.title);
        if (category === 'icpc' && title.includes('ccpc') && !title.includes('icpc')) reasons.push('ICPC_CCPC_identity_conflict');
        if (category === 'ccpc' && title.includes('icpc') && !title.includes('ccpc')) reasons.push('ICPC_CCPC_identity_conflict');
        if (reasons.length) entry.evidence.push(`${id}: ${reasons.join(',')}`);
        let awards;
        try { awards = calculateAwards(srk, preferredAwardGroup(srk)); } catch (e) { awards = { status: 'blocked', reason: e.message }; }
        differences.push({ entry_id: entry.entry_id, contest_id: id, source_title: source.source_title, metadata_conflicts: reasons, previous: c.awardCutoffs ?? null, proposed: awards });
      }
      entries.push(entry);
    } catch (e) { failures.push({ srk_path: item.srk_path, reason: e.message }); }
  }
  return {
    review: { schema_version: 1, export_kind: 'rankland_mapping_review', synthetic: false, catalog_sha256: sha256(catalogBytes), entries },
    audit: { commit_sha: SRK_COMMIT, index_sha256: sha256(indexBytes), collection_sha256: sha256(collectionBytes), differences, failures,
      catalog_status: catalog.contests.map(c => ({ contest_id: c.contestId, title: c.title, candidates: entries.filter(e => e.candidate_contest_ids.includes(c.contestId)).map(e => e.entry_id), status: entries.some(e => e.candidate_contest_ids.includes(c.contestId)) ? 'pending' : 'fallback_no_verified_mapping' })),
      uncurated_candidates: indexed.filter(i => !i.candidates.length).map(i => ({ srk_path: i.srk_path, title: i.labels.join(' / '), status: 'not_published_no_verified_catalog_mapping' })),
    },
  };
}
export async function applyRankland(catalog, review, cache, awardApprovals) {
  await validateSchema('rankland-review', review);
  await validateSchema('rankland-award-review', awardApprovals);
  if (awardApprovals.synthetic || awardApprovals.catalog_sha256 !== review.catalog_sha256) throw new Error('Invalid award review catalog binding');
  if (new Set(review.entries.map(e => e.entry_id)).size !== review.entries.length || new Set(awardApprovals.entries.map(e => e.mapping_entry_id)).size !== awardApprovals.entries.length) throw new Error('Duplicate review entries');
  for (const a of awardApprovals.entries) {
    const m = review.entries.find(e => e.entry_id === a.mapping_entry_id);
    if (!m || m.status !== 'approved' || m.selection.contest_id !== a.contest_id || m.source.content_sha256 !== a.source_content_sha256) throw new Error('Award mapping binding mismatch');
  }
  if (review.synthetic || review.export_kind !== 'rankland_mapping_review') throw new Error('Synthetic or invalid review');
  const out = structuredClone(catalog), seen = new Set(), defaults = new Set();
  const indexBytes = await readFile(resolve(cache, 'config.yaml'));
  const collection = await readJson(resolve(cache, 'collection.json'));
  const index = parseIndex(indexBytes.toString());
  for (const entry of review.entries) {
    if (entry.status !== 'approved') continue;
    if (!entry.review?.reviewed_by || !entry.review?.reason || !entry.candidate_contest_ids.includes(entry.selection?.contest_id)) throw new Error('Missing review');
    const s = entry.source;
    if (seen.has(s.provider_contest_id) || s.provider_contest_id !== `srk:${s.srk_path}` || s.commit_sha !== SRK_COMMIT || sha256(indexBytes) !== s.index_sha256) throw new Error('Duplicate or stale source');
    seen.add(s.provider_contest_id);
    const indexed = index.find(i => i.srk_path === s.srk_path);
    if (!indexed) throw new Error('Source is absent from index');
    const bytes = await readFile(resolve(cache, indexed.srk_path));
    if (sha256(bytes) !== s.content_sha256) throw new Error('SRK hash changed');
    const srk = JSON.parse(bytes);
    const page = verifyPage(indexed, collection, await readJson(resolve(cache, `${indexed.srk_path}.info.json`)), srk);
    if (page !== s.page_url) throw new Error('Page verification changed');
    const c = out.contests.find(c => c.contestId === entry.selection.contest_id);
    if (!c || !c.problemIds.length || c.problemIds.length !== srk.problems.length || c.curationStatus === 'contest_stub') throw new Error('Invalid target or problem count conflict');
    const ordinals = out.problems.filter(p => p.contestId === c.contestId).map(p => p.ordinal).sort();
    if (JSON.stringify(ordinals) !== JSON.stringify(srk.problems.map(p => p.alias).sort())) throw new Error('Problem ordinal conflict');
    if (c.startAt && c.startAt.slice(0,10) !== srk.contest.startAt.slice(0,10)) throw new Error('Date conflict');
    if (entry.selection.make_default && defaults.has(c.contestId)) throw new Error('Multiple default sources');
    if (entry.selection.make_default) defaults.add(c.contestId);
    const existingDefault = c.sources.find(source => source.is_default && source.provider !== 'rankland');
    const source = { provider: 'rankland', kind: 'standings', url: page, provider_contest_id: s.provider_contest_id, source_title: s.source_title, label: 'RankLand', is_default: entry.selection.make_default && !existingDefault };
    c.sources = [...c.sources.filter(source => !(source.provider === 'rankland' && source.provider_contest_id === s.provider_contest_id)), source];
    c.aliases = unique([...c.aliases, ...(s.source_title === c.title ? [] : [s.source_title])]);
    const approval = awardApprovals.entries.find(a => a.mapping_entry_id === entry.entry_id && a.contest_id === c.contestId);
    if (approval?.status === 'approved') {
      if (approval.source_content_sha256 !== s.content_sha256) throw new Error('Invalid award approval');
      const group = approval.result.group.source_group_ids?.[0];
      if (group !== preferredAwardGroup(srk)) throw new Error('Award group must use the highest supported competition group');
      const result = calculateAwards(srk, group);
      if (result.status !== 'proposed' || JSON.stringify(awardResult(srk, result, group)) !== JSON.stringify(approval.result)) throw new Error('Award evidence changed');
      c.awardCutoffs = { source: 'explicit', sourceProvider: 'rankland', sourceLabel: 'RankLand / algoUX · 官方奖项配置' + (group ? ` · ${approval.result.group.label}` : ''), sourceUrl: page, eligibleTeamCount: result.eligible_team_count, cutoffs: result.cutoffs };
    }
  }
  return out;
}
async function main() {
  const [command = 'inspect', cache = 'tmp/sources/srk', ratingPath = 'tmp/sources/rating-review.json', reviewPath = 'tmp/sources/rankland-review.json', catalogPath = 'catalog/default-catalog.min.json'] = process.argv.slice(2);
  if (command === 'fetch') {
    await cached(`${base}/official/config.yaml`, resolve(cache, 'config.yaml'));
    await cached('https://rl.algoux.cn/api/v2/public/collections/official', resolve(cache, 'collection.json'));
    const collection = await readJson(resolve(cache, 'collection.json'));
    const leaves = [];
    function walk(node, labels = []) { const next = node.name ? [...labels, node.name] : labels; if (node.type === 1) leaves.push({ ...node, labels: next }); for (const c of node.children ?? []) walk(c, next); }
    walk(collection.data.content.root);
    const items = candidatesFor(await readJson(catalogPath), parseIndex(await readFile(resolve(cache, 'config.yaml'), 'utf8')), await readJson(ratingPath)).filter(i => i.candidates.length);
    const failures = [];
    await parallel(items, async item => {
      try {
        const leaf = leaves.filter(l => JSON.stringify(l.labels) === JSON.stringify(item.labels));
        if (leaf.length !== 1) throw new Error('Collection identity ambiguous or absent');
        await cached(`${base}/${item.srk_path}`, resolve(cache, item.srk_path));
        await cached(`https://rl.algoux.cn/api/v2/public/contests/${encodeURIComponent(leaf[0].uniqueKey)}`, resolve(cache, `${item.srk_path}.info.json`));
      } catch (e) { failures.push({ srk_path: item.srk_path, reason: e.message }); }
    });
    await atomicJson(resolve(cache, 'fetch-report.json'), { commit_sha: SRK_COMMIT, attempted: items.length, failures });
    console.log(JSON.stringify({ attempted: items.length, failures: failures.length }));
  } else if (command === 'inspect') {
    const { review, audit } = await inspectRankland(cache, ratingPath, catalogPath);
    await atomicJson(reviewPath, review);
    await atomicJson(`${reviewPath}.audit.json`, audit);
    console.log(JSON.stringify({ verified: review.entries.length, failures: audit.failures.length, awards: audit.differences.filter(d => d.proposed.status === 'proposed').length }));
  } else if (command === 'apply') {
    const bytes = await readFile(catalogPath), review = await readJson(reviewPath);
    if (sha256(bytes) !== review.catalog_sha256) throw new Error('Catalog hash changed; regenerate and review');
    const approvals = await readJson(`${reviewPath}.awards.json`);
    await atomicJson(catalogPath, await applyRankland(JSON.parse(bytes), review, cache, approvals), false);
  } else throw new Error('Usage: import-rankland-standings.mjs fetch|inspect|apply [cache] [rating-review] [review] [catalog]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exitCode = 1; });
