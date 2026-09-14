import assert from 'node:assert/strict';
import {calculateBoardAwards} from './xcpcio-gap-awards.mjs';
import {readJson} from './source-import-lib.mjs';
const config={start_time:0,end_time:7200000,penalty:1200,problems:[{id:'A'},{id:'B'}],options:{submission_timestamp_unit:'millisecond',calculation_of_penalty:'accumulate_in_seconds_and_finally_to_the_minute'}};
const teams=Array.from({length:10},(_,i)=>({id:String(i),group:['official']}));
teams.push({id:'star',group:['unofficial']});
const runs=[{team_id:'0',problem_id:'A',timestamp:1000,status:'COMPILATION_ERROR'},{team_id:'0',problem_id:'A',timestamp:59000,status:'ACCEPTED'},{team_id:'0',problem_id:'B',timestamp:61000,status:'ACCEPTED'}];
let r=calculateBoardAwards(config,teams,runs);
assert.equal(r.cutoffs.gold.penalty,2);assert.equal(r.eligibleTeamCount,10);assert.equal(r.cutoffs.gold.solved,2);
r=calculateBoardAwards({...config,options:{submission_timestamp_unit:'millisecond'}},teams,runs);assert.equal(r.cutoffs.gold.penalty,1);
assert.throws(()=>calculateBoardAwards(config,teams,[{...runs[0],status:'PENDING'}]));
assert.throws(()=>calculateBoardAwards(config,teams.map(t=>({...t,group:['TrackA']})),runs));
assert.equal(calculateBoardAwards({...config,medal:{official:{gold:1,silver:2,bronze:3}}},teams,runs).source,'explicit');
const catalog=await readJson('catalog/default-catalog.min.json');
const review=await readJson('fixtures/imports/xcpcio-2026-gap-awards.json');
for(const entry of review.audit.filter(r=>r.status==='applied')) {
 const c=catalog.contests.find(c=>c.contestId===entry.contest_id);
 assert.deepEqual(c.awardCutoffs??c.estimatedAwardCutoffs,entry.result);
}
console.log('XCPCIO gap awards: CE exclusion, penalty modes, official eligibility, pending rejection and published evidence passed.');
