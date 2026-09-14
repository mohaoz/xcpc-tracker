import YAML from 'yaml';
import { normalizeTitle } from './source-import-lib.mjs';

export function parseIndex(text) {
  const output = [];
  function walk(node, paths, names) {
    if (node.path && !/^[a-zA-Z0-9_.-]+$/.test(node.path)) throw new Error('Unsafe SRK path');
    const next = node.path ? [...paths, node.path] : paths;
    const labels = node.name ? [...names, node.name] : names;
    if (node.format) {
      if (node.format !== 'srk.json') return;
      output.push({ srk_path: `${next.join('/')}.srk.json`, labels, name: node.name });
    }
    for (const child of node.children ?? []) walk(child, next, labels);
  }
  walk(YAML.parse(text).root, ['official'], []);
  return output;
}
export function verifyPage(indexEntry, collection, info, srk) {
  const leaves = [];
  function walk(node, labels = []) {
    const next = node.name ? [...labels, node.name] : labels;
    if (node.type === 1) leaves.push({ ...node, labels: next });
    for (const c of node.children ?? []) walk(c, next);
  }
  if (!collection.success || !collection.data?.content?.root) throw new Error('Invalid collection response');
  walk(collection.data.content.root);
  const candidates = leaves.filter(l => JSON.stringify(l.labels) === JSON.stringify(indexEntry.labels));
  if (candidates.length !== 1) throw new Error('Collection path absent or ambiguous');
  const leaf = candidates[0];
  if (!info.success || info.data?.uk !== leaf.uniqueKey || !info.data.srkFileID || info.data.redirectUK) throw new Error('RankLand contest identity not verified');
  const titles = Object.values(srk.contest.title ?? {}).map(normalizeTitle);
  if (!titles.includes(normalizeTitle(info.data.name)) || Date.parse(info.data.startAt) !== Date.parse(srk.contest.startAt)) throw new Error('Page and SRK title/date disagree');
  return `https://rl.algoux.cn/collection/official?rankId=${encodeURIComponent(leaf.uniqueKey)}`;
}
export function minutes(time) {
  const multipliers = { ms: 1 / 60000, s: 1 / 60, min: 1, h: 60, d: 1440 };
  if (!Array.isArray(time) || time.length !== 2 || !Number.isFinite(time[0]) || time[0] < 0 || !(time[1] in multipliers)) throw new Error('Unknown or invalid time unit');
  return time[0] * multipliers[time[1]];
}
export function preferredAwardGroup(srk) {
  const series = (srk.series ?? []).filter(s => s.rule?.preset === 'ICPC');
  if (series.length <= 1) return series[0]?.rule.options?.filter?.byMarker;
  for (const pattern of [/邀请|invitational/i, /本科|undergraduate/i]) {
    const preferred = series.filter(s => pattern.test(typeof s.title === 'string' ? s.title : Object.values(s.title ?? {}).join(' ')));
    if (preferred.length === 1 && typeof preferred[0].rule.options?.filter?.byMarker === 'string') return preferred[0].rule.options.filter.byMarker;
  }
  return undefined;
}
export function calculateAwards(srk, selectedGroup) {
  const blocked = reason => ({ status: 'blocked', reason });
  if (!/^0\.3\.\d+$/.test(srk.version) || srk.type !== 'general' || srk.sorter?.algorithm !== 'ICPC') return blocked('Unsupported SRK version/type/sorter');
  if (!srk.contest?.frozenDuration || minutes(srk.contest.frozenDuration) !== 0) return blocked('Frozen or unknown final state');
  if (!Array.isArray(srk.rows) || !srk.rows.length || !Array.isArray(srk.problems) || !srk.problems.length) return blocked('Empty standings');
  if (srk.rows.some(r => typeof r.user?.official !== 'boolean' || r.statuses?.length !== srk.problems.length || r.statuses.some(s => ['?', 'U', 'PD', 'PENDING', 'FROZEN'].includes(s.result)))) return blocked('Incomplete rows, pending results or unknown eligibility');
  if (srk.rows.some(r => r.statuses.some(s => ![undefined, null, 'AC', 'FB', 'RJ'].includes(s.result)) || r.statuses.filter(s => ['AC', 'FB'].includes(s.result)).length !== r.score?.value)) return blocked('Unknown final problem result or solved total conflict');
  // A group-specific series requires a separately audited adapter; never merge groups.
  const series = (srk.series ?? []).filter(s => s.rule?.preset === 'ICPC' && (!selectedGroup || s.rule.options?.filter?.byMarker === selectedGroup));
  if (selectedGroup && !srk.markers?.some(m => m.id === selectedGroup)) return blocked('Selected group does not exist');
  if (series.length !== 1 || (!selectedGroup && series[0].rule.options?.filter)) return blocked('Multiple or unsupported eligible groups');
  const config = series[0].rule.options;
  if (config?.ratio || Object.keys(config ?? {}).some(k => !['count', 'filter'].includes(k)) || (config?.filter && (Object.keys(config.filter).length !== 1 || config.filter.byMarker !== selectedGroup))) return blocked('Combined or unsupported medal rules');
  const counts = config?.count?.value;
  if (!Array.isArray(counts) || counts.length !== 3 || counts.some(n => !Number.isInteger(n) || n <= 0) || config.count.type && config.count.type !== 'normal') return blocked('No explicit supported medal counts');
  if (JSON.stringify((series[0].segments ?? []).map(s => s.style)) !== JSON.stringify(['gold', 'silver', 'bronze'])) return blocked('Medal meaning is not explicit');
  const eligible = srk.rows.filter(r => r.user.official === true && (!selectedGroup || r.user.markers?.includes(selectedGroup))).map(r => ({ teamId: r.user.id, solved: r.score?.value, penalty: minutes(r.score?.time) }));
  if (eligible.some(r => typeof r.teamId !== 'string' || !Number.isInteger(r.solved) || r.solved < 0 || r.solved > srk.problems.length) || new Set(eligible.map(r => r.teamId)).size !== eligible.length) return blocked('Invalid score or duplicate team identity');
  eligible.sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || a.teamId.localeCompare(b.teamId));
  let rank = 0;
  const cutoffs = {};
  for (const [i, medal] of ['gold', 'silver', 'bronze'].entries()) {
    rank += counts[i];
    if (rank > eligible.length) return blocked('Medal counts exceed eligible teams');
    const row = eligible[rank - 1], next = eligible[rank];
    if (next && next.solved === row.solved && next.penalty === row.penalty) return blocked('Tied medal boundary requires explicit review');
    cutoffs[medal] = { rank, ...row };
  }
  return { status: 'proposed', eligible_team_count: eligible.length, cutoffs, evidence: { group: selectedGroup ?? 'user.official === true', series_index: srk.series.indexOf(series[0]), medal_counts: counts, penalty_unit: 'minutes', source_penalty_units: [...new Set(srk.rows.map(r => r.score.time[1]))], ties: 'No tied medal boundary', final: 'frozenDuration=0; complete statuses; no pending results' } };
}

export function awardResult(srk, calculation, selectedGroup) {
  if (calculation.status !== 'proposed') throw new Error('Awards blocked');
  const units = calculation.evidence.source_penalty_units;
  if (units.length !== 1 || !['s', 'ms', 'min'].includes(units[0])) throw new Error('Mixed/unsupported penalty units');
  return {
    standings_state: 'final', method: 'official_medal_config',
    group: { scope: selectedGroup ? 'selected' : 'all_eligible', ...(selectedGroup ? { source_group_ids: [selectedGroup] } : {}), label: selectedGroup ? String(srk.series[calculation.evidence.series_index].title).replaceAll('#', '') : '正式参赛队伍', eligibility_rule: 'user.official === true' + (selectedGroup ? ` AND user.markers includes ${selectedGroup}` : ''), exclusion_rule: 'Exclude unofficial users and users outside selected group', tie_policy: calculation.evidence.ties, evidence: [`series[${calculation.evidence.series_index}].rule.options`, JSON.stringify(calculation.evidence.medal_counts)] },
    eligible_team_count: calculation.eligible_team_count, problem_count: srk.problems.length, source_penalty_unit: { s: 'seconds', ms: 'milliseconds', min: 'minutes' }[units[0]], penalty_unit: 'minutes', normalization_notes: 'Convert each score.time tuple to minutes before sorting; no rounding',
    method_evidence: [calculation.evidence.final, `series[${calculation.evidence.series_index}].segments = gold/silver/bronze`, `counts=${JSON.stringify(calculation.evidence.medal_counts)}`],
    cutoffs: Object.fromEntries(Object.entries(calculation.cutoffs).map(([medal, c]) => [medal, { rank: c.rank, solved: c.solved, penalty: c.penalty, team_id: c.teamId }])),
  };
}
