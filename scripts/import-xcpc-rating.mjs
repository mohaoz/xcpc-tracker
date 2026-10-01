import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atomicJson, readJson, sha256, normalizeTitle, names, problemIdentity, unique, download } from './source-import-lib.mjs';

export const RATING_URL = 'https://hei-maom.github.io/xcpcrating/data/problems-index.json';
const mappingExclusions=JSON.parse(readFileSync(new URL('../fixtures/imports/xcpc-rating/problem-mapping-exclusions.json',import.meta.url),'utf8')).entries;
export function inspectRating(catalog, rows) {
  if (!Array.isArray(rows) || rows.some(r => !r || typeof r.contestSlug !== 'string' || typeof r.alias !== 'string' || !Array.isArray(r.detailTags) || r.detailTags.some(t => typeof t !== 'string'))) throw new Error('Invalid XCPC Rating snapshot');
  const byIdentity = new Map();
  for (const p of catalog.problems) for (const s of p.sources) {
    const key = problemIdentity(s.url);
    if (key) byIdentity.set(key, unique([...(byIdentity.get(key) ?? []), p]));
  }
  const groups = new Map();
  for (const r of rows) groups.set(r.contestSlug, [...(groups.get(r.contestSlug) ?? []), r]);
  const contestMappings = [];
  const matches = [], unresolved = [];
  for (const [slug, group] of groups) {
    const identityHash=sha256(JSON.stringify(group.map(r=>({ordinal:r.alias,identity:problemIdentity(r.problemUrl)})).sort((a,b)=>a.ordinal.localeCompare(b.ordinal))));
    const exclusion=mappingExclusions.find(e=>e.contest_slug===slug&&e.problem_identity_sha256===identityHash);
    if(exclusion) {
      for(const r of group)unresolved.push({contest_slug:slug,ordinal:r.alias,title:r.title,reason:exclusion.reason,blocked_mapping_sha256:identityHash});
      continue;
    }
    // Several matching题名/题号 pairs establish contest identity; a lone common title never does.
    const candidates = catalog.contests.map(c => {
      const ps = catalog.problems.filter(p => p.contestId === c.contestId);
      const exact = group.filter(r => (byIdentity.get(problemIdentity(r.problemUrl)) ?? []).some(p => p.contestId === c.contestId && p.ordinal === r.alias));
      const titles = group.filter(r => r.title && ps.some(p => p.ordinal === r.alias && names(p).includes(normalizeTitle(r.title))));
      return { c, ps, exact: exact.length, titles: titles.length };
    }).filter(x => x.exact >= 2 || x.titles >= 3);
    const compatible = candidates.filter(x => x.ps.length === group.length && group.every(r => {
      const p = x.ps.find(p => p.ordinal === r.alias);
      return p && (!r.title || r.title === r.alias || names(p).includes(normalizeTitle(r.title)) || (byIdentity.get(problemIdentity(r.problemUrl)) ?? []).includes(p));
    }));
    // Joint contests may share all tasks. Preserve every exact target and report ambiguous standings separately.
    for (const x of compatible) contestMappings.push({ contest_slug: slug, contest_id: x.c.contestId, evidence: { exact_problem_ids: x.exact, matching_titles: x.titles, problem_count: group.length } });
    // Some upstream rows expose a numeric rating and exact CF/QOJ IDs, but no title.
    // Require an independently reviewed original-event mapping, matching start time,
    // and a one-to-one COMPLETE provider-ID set before using these numeric rows.
    const originalSourceId=`srk:official/${slug.replaceAll('__','/')}.srk.json`;
    const numericIdentityTargets=compatible.filter(x=>
      x.exact===group.length && new Set(group.map(r=>r.alias)).size===group.length &&
      new Set(group.map(r=>problemIdentity(r.problemUrl))).size===group.length &&
      group.every(r=>!r.title||r.title===r.alias||names(x.ps.find(p=>p.ordinal===r.alias)).includes(normalizeTitle(r.title))) &&
      x.c.sources?.some(s=>s.provider==='rankland'&&s.kind==='standings'&&s.provider_contest_id===originalSourceId) &&
      x.c.startAt && group.every(r=>Number.isFinite(Date.parse(r.startAt))&&Date.parse(r.startAt)===Date.parse(x.c.startAt))
    );
    for (const r of group) {
      if (!r.title || r.title === r.alias) {
        if (!Number.isFinite(r.problemRating)||r.problemRating<0) continue;
        for (const x of numericIdentityTargets) {
          const p=x.ps.find(p=>p.ordinal===r.alias&&(byIdentity.get(problemIdentity(r.problemUrl))??[]).includes(p));
          if (!p) continue;
          matches.push({problem_id:p.problemId,contest_slug:slug,ordinal:r.alias,title:p.title,source_title:r.title??null,tags:[],problem_url:r.problemUrl,confidence:r.confidence,status:r.status,evidence:'complete_provider_ids_and_verified_original_contest',original_source_id:originalSourceId,original_start_at:x.c.startAt});
        }
        continue;
      }
      if (!r.detailTags.length && !problemIdentity(r.problemUrl) && !Number.isFinite(r.problemRating)) continue;
      const identityTargets = byIdentity.get(problemIdentity(r.problemUrl)) ?? [];
      const targets = identityTargets.length ? identityTargets : compatible.flatMap(x => x.ps.filter(p => p.ordinal === r.alias && names(p).includes(normalizeTitle(r.title))));
      if (!targets.length) {
        unresolved.push({ contest_slug: slug, ordinal: r.alias, title: r.title, reason: 'No verified problem identity or complete contest mapping' });
        continue;
      }
      for (const p of targets) {
        if (!names(p).includes(normalizeTitle(r.title))) {
          unresolved.push({ contest_slug: slug, ordinal: r.alias, title: r.title, problem_id: p.problemId, reason: 'Provider ID matched but title conflicts' });
          continue;
        }
        matches.push({ problem_id: p.problemId, contest_slug: slug, ordinal: r.alias, title: r.title, tags: unique(r.detailTags).sort(), problem_url: problemIdentity(r.problemUrl) ? r.problemUrl : null, confidence: r.confidence, status: r.status, evidence: identityTargets.includes(p) ? 'provider_problem_id_and_title' : 'complete_contest_mapping_ordinal_and_title' });
      }
    }
  }
  return { input_count: rows.length, contest_mappings: contestMappings, matches, unresolved };
}
export function applyRating(catalog, report) {
  const out = structuredClone(catalog);
  for (const m of report.matches) {
    const p = out.problems.find(p => p.problemId === m.problem_id);
    if (!p || !names(p).includes(normalizeTitle(m.title))) throw new Error('Stale rating match');
    p.tags = unique([...(p.tags ?? []), ...m.tags]).sort();
    const provenance = { provider: 'xcpc_rating', kind: 'metadata', url: 'https://hei-maom.github.io/xcpcrating/#/problems', provider_problem_id: `${m.contest_slug}:${m.ordinal}`, ...(m.evidence==='complete_provider_ids_and_verified_original_contest' ? {} : {source_title:m.title}), label: m.evidence==='complete_provider_ids_and_verified_original_contest' ? 'XCPC Rating · 题目评分' : 'XCPC Rating · 社区标签' };
    if (!p.sources.some(s => s.provider === provenance.provider && s.provider_problem_id === provenance.provider_problem_id)) p.sources.push(provenance);
  }
  for (const mapping of report.contest_mappings) {
    const c = out.contests.find(c => c.contestId === mapping.contest_id);
    const matches = report.matches.filter(m => m.contest_slug === mapping.contest_slug && c.problemIds.includes(m.problem_id));
    if (new Set(matches.map(m => m.problem_id)).size !== c.problemIds.length) continue;
    const roots = matches.map(m => {
      const key = problemIdentity(m.problem_url);
      if (key?.startsWith('cf:')) return {provider:'codeforces', kind:'contest', url:`https://codeforces.com/gym/${key.split(':')[1]}`, provider_contest_id:key.split(':')[1], label:'Codeforces · XCPC Rating 补充'};
      const match = m.problem_url?.match(/^https:\/\/qoj\.ac\/contest\/(\d+)\/problem\/\d+/);
      return match ? {provider:'qoj', kind:'contest', url:`https://qoj.ac/contest/${match[1]}`, provider_contest_id:match[1], label:'QOJ · XCPC Rating 补充'} : null;
    });
    const root = roots[0];
    if (!root || roots.some(r => r?.url !== root.url)) continue;
    if (!c.sources.some(s => s.provider === root.provider && s.provider_contest_id === root.provider_contest_id && s.kind === 'contest')) c.sources.push(root);
  }
  return out;
}
async function main() {
  const [command = 'inspect', input = 'tmp/sources/rating-problems.json', reportPath = 'tmp/sources/rating-review.json', catalogPath = 'catalog/default-catalog.min.json'] = process.argv.slice(2);
  if (command === 'fetch') return download(RATING_URL, input);
  const bytes = await readFile(input), catalogBytes = await readFile(catalogPath);
  const catalog = JSON.parse(catalogBytes), inspected = inspectRating(catalog, JSON.parse(bytes));
  const report = { source_url: RATING_URL, source_sha256: sha256(bytes), catalog_sha256: sha256(catalogBytes), ...inspected };
  if (command === 'inspect') {
    await atomicJson(reportPath, report);
    console.log(JSON.stringify({ input: report.input_count, matches: report.matches.length, unresolved: report.unresolved.length, contest_mappings: report.contest_mappings.length }));
  } else if (command === 'apply') {
    const approved = await readJson(reportPath);
    if (approved.review?.status !== 'approved' || !approved.review?.reviewed_by || approved.source_sha256 !== report.source_sha256 || approved.catalog_sha256 !== report.catalog_sha256 || JSON.stringify(approved.matches) !== JSON.stringify(report.matches)) throw new Error('Apply requires a reviewed, unchanged snapshot and catalog');
    await atomicJson(catalogPath, applyRating(catalog, approved), false);
  } else throw new Error('Usage: import-xcpc-rating.mjs fetch|inspect|apply [snapshot] [review] [catalog]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exitCode = 1; });
