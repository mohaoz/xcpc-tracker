import assert from 'node:assert/strict';
// Mirrors XCPCIO core team/problem penalty rules, not the legacy 20-minute-only adapter.
export function calculateBoardAwards(config, teams, runs) {
  assert.ok(Array.isArray(teams) && Array.isArray(runs), 'Unsupported standings shape');
  assert.ok(config.end_time < Date.now(), 'Contest has not finished');
  const invitational = Object.entries(config.group ?? {}).filter(([,name])=>/邀请|invitational/i.test(String(name)));
  const group = invitational.length === 1 ? invitational[0][0] : 'official';
  const eligible = teams.filter(t=>t.group?.includes(group) && !t.group?.includes('unofficial'));
  assert.ok(eligible.length, 'No verified official/highest group; do not merge unknown groups');
  const divisor = {millisecond:1000,second:1,minute:1/60}[config.options?.submission_timestamp_unit ?? 'second'];
  assert.ok(divisor && Number.isFinite(config.penalty), 'Unknown timestamp or penalty unit');
  const mode = config.options?.calculation_of_penalty ?? 'in_minutes';
  assert.ok(['in_minutes','accumulate_in_seconds_and_finally_to_the_minute','in_seconds'].includes(mode), 'Unsupported penalty rule');
  const problemIds = new Set(config.problems.map(p=>String(p.id)));
  const allTeams = new Set(teams.map(t=>String(t.id ?? t.team_id)));
  assert.equal(allTeams.size, teams.length, 'Duplicate teams');
  const ranked = new Map(eligible.map(t=>[String(t.id ?? t.team_id),{id:String(t.id ?? t.team_id),solved:0,seconds:0,last:0,problems:new Map()}]));
  const accepted = new Set(['ACCEPTED','CORRECT','OK','AC']);
  const rejected = new Set(['WRONG_ANSWER','REJECTED','NO_OUTPUT','RUNTIME_ERROR','TIME_LIMIT_EXCEEDED','MEMORY_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED','IDLENESS_LIMIT_EXCEEDED','JUDGEMENT_FAILED','HACKED']);
  const ignored = new Set(['COMPILATION_ERROR','PRESENTATION_ERROR','CONFIGURATION_ERROR','SYSTEM_ERROR','CANCELED','SKIPPED']);
  for(const run of [...runs].sort((a,b)=>a.timestamp-b.timestamp)) {
    const status = String(run.status).toUpperCase(), time = run.timestamp/divisor;
    assert.ok(accepted.has(status)||rejected.has(status)||ignored.has(status), `Unknown/pending result: ${status}`);
    assert.ok(Number.isFinite(time)&&time>=0&&time<=(config.end_time-config.start_time)/1000, 'Submission outside contest');
    assert.ok(problemIds.has(String(run.problem_id))&&allTeams.has(String(run.team_id)), 'Unmapped submission');
    const team=ranked.get(String(run.team_id));if(!team)continue;
    const p=team.problems.get(String(run.problem_id))??{wrong:0,solved:false};team.problems.set(String(run.problem_id),p);
    if(p.solved)continue;
    if(accepted.has(status)) {p.solved=true;team.solved++;team.last=Math.max(team.last,Math.floor(time/60));team.seconds+=(mode==='in_minutes'?Math.floor(time/60)*60:time)+p.wrong*config.penalty;}
    else if(rejected.has(status))p.wrong++;
  }
  const rows=[...ranked.values()].map(t=>({...t,penalty:mode==='in_seconds'?t.seconds/60:Math.floor(t.seconds/60)})).sort((a,b)=>b.solved-a.solved||a.penalty-b.penalty||a.last-b.last||a.id.localeCompare(b.id));
  const medal=config.medal?.[group];
  const explicit=medal && ['gold','silver','bronze'].every(k=>Number.isInteger(medal[k])&&medal[k]>0);
  const ranks=explicit?[medal.gold,medal.gold+medal.silver,medal.gold+medal.silver+medal.bronze]:[.1,.3,.6].map(r=>Math.floor(rows.length*r));
  assert.ok(ranks.every(r=>r>0&&r<=rows.length),'Invalid medal ranks');
  const cutoffs=Object.fromEntries(['gold','silver','bronze'].map((key,i)=>{const row=rows[ranks[i]-1];return [key,{rank:ranks[i],solved:row.solved,penalty:row.penalty,teamId:row.id}];}));
  return {source:explicit?'explicit':'inferred_official_medal_ratio_10_20_30',eligibleTeamCount:rows.length,cutoffs,group,penalty_rule:mode};
}
