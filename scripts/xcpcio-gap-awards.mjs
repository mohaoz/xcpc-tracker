import assert from 'node:assert/strict';
// Mirrors XCPCIO core team/problem penalty rules, not the legacy 20-minute-only adapter.
// Timestamp/status compatibility reviewed against xcpcio/xcpcio at
// 90f8432e58965cba5a33801819e12861f34446b6, packages/libs/core/src/utils/dayjs.ts
// and packages/libs/core/src/submission-status.ts. Unknown/pending results still fail closed.
function epochMilliseconds(value) {
  const result=typeof value==='number' ? (String(value).length===10 ? value*1000 : value) : Date.parse(value);
  assert.ok(Number.isFinite(result), 'Invalid contest timestamp');
  return result;
}
export function calculateBoardAwards(config, teams, runs) {
  assert.ok(Array.isArray(teams) && Array.isArray(runs), 'Unsupported standings shape');
  const start=epochMilliseconds(config.start_time),end=epochMilliseconds(config.end_time);
  assert.ok(end>start && end<Date.now(), 'Contest has not finished or duration is invalid');
  const groups = Object.entries(config.group ?? {});
  const invitational = groups.filter(([,name])=>/邀请|invitational/i.test(String(name)));
  const undergraduate = groups.filter(([,name])=>/本科|undergraduate/i.test(String(name)));
  assert.ok(invitational.length<=1, 'Ambiguous highest invitational group');
  assert.ok(invitational.length || undergraduate.length<=1, 'Ambiguous highest undergraduate group');
  const group = invitational[0]?.[0] ?? undergraduate[0]?.[0] ?? 'official';
  assert.ok(group!=='official' || !groups.some(([,name])=>/专科|高职|vocational|junior|独立学院|track|甲组|乙组/i.test(String(name))), 'Highest group is not explicit; do not merge divisions');
  const unofficial = new Set(['unofficial', ...groups.filter(([,name])=>/打星|非正式|unofficial|guest|exhibition/i.test(String(name))).map(([key])=>key)]);
  const marked=(team,key)=>(Array.isArray(team.group)&&team.group.includes(key)) || team[key]===true || team[key]===1;
  const eligible = teams.filter(t=>marked(t,group) && t.official!==false && t.official!==0 && ![...unofficial].some(g=>marked(t,g)));
  assert.ok(eligible.length, 'No verified official/highest group; do not merge unknown groups');
  const lowerAcademicGroups=groups.filter(([,name])=>/专科|高职|vocational|junior/i.test(String(name))).map(([key])=>key);
  assert.ok(!undergraduate.some(([key])=>key===group)||!eligible.some(t=>lowerAcademicGroups.some(key=>marked(t,key))), 'Ambiguous overlapping undergraduate/vocational membership');
  const divisor = {millisecond:1000,second:1,minute:1/60}[config.options?.submission_timestamp_unit ?? 'second'];
  assert.ok(divisor && Number.isFinite(config.penalty), 'Unknown timestamp or penalty unit');
  const mode = config.options?.calculation_of_penalty ?? 'in_minutes';
  assert.ok(['in_minutes','accumulate_in_seconds_and_finally_to_the_minute','in_seconds'].includes(mode), 'Unsupported penalty rule');
  const problemIds = new Set(config.problems.map(p=>String(p.id)));
  const allTeams = new Set(teams.map(t=>String(t.id ?? t.team_id)));
  assert.equal(allTeams.size, teams.length, 'Duplicate teams');
  const ranked = new Map(eligible.map(t=>[String(t.id ?? t.team_id),{id:String(t.id ?? t.team_id),solved:0,seconds:0,last:0,problems:new Map()}]));
  const accepted = new Set(['ACCEPTED','CORRECT','OK','AC']);
  const rejected = new Set(['WRONG_ANSWER','REJECTED','NO_OUTPUT','RUNTIME_ERROR','TIME_LIMIT_EXCEEDED','MEMORY_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED','IDLENESS_LIMIT_EXCEEDED','JUDGEMENT_FAILED','HACKED','WA','RJ','INCORRECT','NO','RT','RE','RTE','TL','TLE','ML','MLE','OL','OLE','IL','ILE','JE']);
  const ignored = new Set(['COMPILATION_ERROR','PRESENTATION_ERROR','CONFIGURATION_ERROR','SYSTEM_ERROR','CANCELED','SKIPPED','CE','PE','SE']);
  const statusOf=run=>String(run.status).toUpperCase().replace(' ','_');
  const ordered=[...runs].sort((a,b)=>a.timestamp-b.timestamp||(String(a.team_id)===String(b.team_id)?Number(accepted.has(statusOf(b)))-Number(accepted.has(statusOf(a))):0)||String(a.id??a.submission_id??'').localeCompare(String(b.id??b.submission_id??'')));
  for(const run of ordered) {
    const status = statusOf(run), rawTime = run.timestamp/divisor;
    const time=(config.options?.submission_timestamp_unit==='millisecond')?Math.floor(rawTime):rawTime;
    assert.ok(accepted.has(status)||rejected.has(status)||ignored.has(status), `Unknown/pending result: ${status}`);
    assert.ok(Number.isFinite(time)&&time>=0&&time<=(end-start)/1000, 'Submission outside contest');
    assert.ok(problemIds.has(String(run.problem_id))&&allTeams.has(String(run.team_id)), 'Unmapped submission');
    const team=ranked.get(String(run.team_id));if(!team||run.is_ignore)continue;
    const p=team.problems.get(String(run.problem_id))??{wrong:0,solved:false};team.problems.set(String(run.problem_id),p);
    if(p.solved)continue;
    if(accepted.has(status)) {p.solved=true;team.solved++;team.last=Math.max(team.last,Math.floor(time/60));team.seconds+=(mode==='in_minutes'?Math.floor(time/60)*60:time)+p.wrong*config.penalty;}
    else if(rejected.has(status))p.wrong++;
  }
  const rows=[...ranked.values()].map(t=>({...t,penalty:mode==='in_seconds'?t.seconds/60:Math.floor(t.seconds/60)})).sort((a,b)=>b.solved-a.solved||a.penalty-b.penalty||a.last-b.last||a.id.localeCompare(b.id));
  const medal=config.medal?.[group];
  const ccpcPreset=config.medal==='ccpc';
  assert.ok(config.medal==null || ccpcPreset || (typeof config.medal==='object'&&!Array.isArray(config.medal)), 'Unsupported medal preset; do not treat it as missing configuration');
  assert.ok(!ccpcPreset || (group==='official'&&!Object.keys(config.group??{}).some(k=>!['official','unofficial','girl','girls','provincial','ai'].includes(k))), 'CCPC preset highest-group semantics are not verified');
  const explicit=ccpcPreset || (medal && ['gold','silver','bronze'].every(k=>Number.isInteger(medal[k])&&medal[k]>0));
  const hasConfiguredAwards=Object.values(config.medal??{}).some(m=>['gold','silver','bronze'].some(k=>Number(m?.[k])>0));
  assert.ok(!hasConfiguredAwards || explicit, 'Award configuration does not establish all highest-group medal counts');
  const counts=ccpcPreset?null:explicit?[medal.gold,medal.silver,medal.bronze]:[.1,.2,.3].map(r=>Math.floor(rows.length*r));
  const scored=rows.filter(r=>r.solved>0).length;
  const ranks=ccpcPreset?[1,3,6].map(n=>Math.ceil(scored*n/10)):counts.map((_,i)=>counts.slice(0,i+1).reduce((sum,n)=>sum+n,0));
  assert.ok(ranks.every(r=>r>0&&r<=rows.length),'Invalid medal ranks');
  for (const rank of ranks) {
    const boundary=rows[rank-1], next=rows[rank];
    assert.ok(!next || boundary.solved!==next.solved || boundary.penalty!==next.penalty, 'Unreviewed tied medal boundary');
  }
  const cutoffs=Object.fromEntries(['gold','silver','bronze'].map((key,i)=>{const row=rows[ranks[i]-1];return [key,{rank:ranks[i],solved:row.solved,penalty:row.penalty,teamId:row.id}];}));
  return {source:explicit?'explicit':'inferred_official_medal_ratio_10_20_30',eligibleTeamCount:rows.length,cutoffs,group,penalty_rule:mode};
}
