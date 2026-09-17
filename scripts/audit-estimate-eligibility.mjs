import {readFile} from 'node:fs/promises';
import {readJson,atomicJson,download,parallel,sha256} from './source-import-lib.mjs';
import {preferredAwardGroup} from './rankland-lib.mjs';
const cache=process.argv[2];if(!cache)throw new Error('Provide audit cache');
const offline=process.argv.includes('--offline');
const catalog=await readJson('catalog/default-catalog.min.json');
const targets=catalog.contests.flatMap(c=>['awardCutoffs','estimatedAwardCutoffs'].filter(k=>c[k]&&c[k].source!=='explicit').map(field=>({c,field,value:c[field]})));
const audit=[];
await parallel(targets,async({c,field,value})=>{
  const row={contest_id:c.contestId,title:c.title,field,value};
  try {
    if(value.sourceProvider==='codeforces')throw new Error('Gym CONTESTANT does not establish original onsite official roster');
    let eligible;
    if(value.sourceProvider==='rankland') {
      const source=c.sources.find(s=>s.provider==='rankland'&&s.url===value.sourceUrl);
      const raw=await readFile(`${cache}/${source.provider_contest_id.slice(4)}`);row.sha256=sha256(raw);
      const srk=JSON.parse(raw),group=preferredAwardGroup(srk);row.group=group??'official';
      if(srk.series.filter(s=>s.rule?.preset==='ICPC').length>1&&!group)throw new Error('Unknown highest group');
      eligible=srk.rows.filter(r=>r.user.official===true&&(!group||r.user.markers?.includes(group))).map(r=>String(r.user.id));
    } else if(value.sourceProvider==='xcpcio_board') {
      const url=new URL(value.sourceUrl),path=url.pathname.replace(/^\/+|\/+$/g,'');
      const config=await readJson(`${cache}/board/${c.contestId}/config.json`);
      if(!offline)await download(`https://board.xcpcio.com/data/${path}/team.json`,`${cache}/board/${c.contestId}/eligibility-team.json`);
      const raw=await readFile(`${cache}/board/${c.contestId}/eligibility-team.json`);row.sha256=sha256(raw);
      const data=JSON.parse(raw),teams=Array.isArray(data)?data:Object.entries(data).map(([id,t])=>({id,...t}));
      const invitation=Object.entries(config.group??{}).filter(([,name])=>/邀请|invitational/i.test(String(name)));
      const undergraduate=Object.entries(config.group??{}).filter(([,name])=>/本科|undergraduate/i.test(String(name)));
      const choices=invitation.length?invitation:undergraduate;
      if(choices.length>1 || (!choices.length && /高职|专科|Track|独立学院/i.test(JSON.stringify(config.group??{}))))throw new Error('Highest group is not established');
      const group=choices[0]?.[0]??'official';row.group=group;
      const marked=(t,g)=>t.group?.includes(g)||t[g]===true||t[g]===1;
      eligible=teams.filter(t=>!marked(t,'unofficial')&&t.official!==false&&t.official!==0&&marked(t,'official')&&(group==='official'||marked(t,group))).map(t=>String(t.id??t.team_id));
    } else throw new Error('Unsupported provenance');
    row.official_count=eligible.length;
    if(!eligible.length)throw new Error('No explicitly verified official teams');
    if(value.source.includes('all_teams'))throw new Error('Legacy all-teams estimate is not permitted');
    if(eligible.length!==value.eligibleTeamCount)throw new Error('Stored population differs from verified official population');
    if(!Object.values(value.cutoffs).every(c=>eligible.includes(String(c.teamId))))throw new Error('Cutoff team not in verified official group');
    row.status='verified';
  }catch(e){row.status='blocked';row.reason=e.message;}
  audit.push(row);
},4);
await atomicJson(`${cache}/eligibility-audit.json`,{catalog_sha256:sha256(await readFile('catalog/default-catalog.min.json')),audit});
console.log(JSON.stringify({total:audit.length,verified:audit.filter(r=>r.status==='verified').length,blocked:audit.filter(r=>r.status==='blocked').map(r=>({title:r.title,reason:r.reason}))},null,2));
