// Refresh existing verified mappings only. Fetch/audit never writes the catalog.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {atomicJson,readJson,download,parallel,sha256,normalizeTitle} from './source-import-lib.mjs';
import {parseIndex,verifyPage,calculateAwards,preferredAwardGroup} from './rankland-lib.mjs';
import {calculateBoardAwards} from './xcpcio-gap-awards.mjs';
const cache=process.argv[2];
const offline=process.argv.includes('--offline');
if(!cache)throw new Error('Provide a fresh cache directory');
const catalog=await readJson('catalog/default-catalog.min.json');
const review=await readJson('fixtures/imports/rankland/2026-09-review.json');
async function get(url,path){const target=resolve(cache,path);if(!offline)await download(url,target);return readJson(target);}
const head=await get('https://api.github.com/repos/algoux/srk-collection/commits/HEAD','head.json');
if(!/^[a-f0-9]{40}$/.test(head.sha))throw new Error('Invalid upstream revision');
if(!offline)await download(`https://raw.githubusercontent.com/algoux/srk-collection/${head.sha}/official/config.yaml`,resolve(cache,'config.yaml'));
const index=parseIndex(await readFile(resolve(cache,'config.yaml'),'utf8'));
const collection=await get('https://rl.algoux.cn/api/v2/public/collections/official','collection.json');
await get('https://board.xcpcio.com/data/index/contest_list.json','board-index.json');
const audit=[];
const boardConfigs=new Map();
function boardConfig(c,source) {
  if(!boardConfigs.has(c.contestId)) {
    const path=new URL(source.url).pathname.replace(/^\/+|\/+$/g,'');
    boardConfigs.set(c.contestId,get(`https://board.xcpcio.com/data/${path}/config.json`,`board/${c.contestId}/config.json`));
  }
  return boardConfigs.get(c.contestId);
}
const tasks=catalog.contests.flatMap(c=>c.sources.filter(s=>['rankland','xcpcio_board'].includes(s.provider)).map(source=>({c,source})));
await parallel(tasks,async({c,source})=>{
  const row={contest_id:c.contestId,title:c.title,provider:source.provider,url:source.url,has_awards:!!c.awardCutoffs,has_estimates:!!c.estimatedAwardCutoffs};
  try {
    if(source.provider==='rankland') {
      const path=source.provider_contest_id.replace(/^srk:/,'');
      const entry=index.find(e=>e.srk_path===path);if(!entry)throw new Error('Previously mapped path absent upstream');
      const srk=await get(`https://raw.githubusercontent.com/algoux/srk-collection/${head.sha}/${path}`,path);
      const info=await get(`https://rl.algoux.cn/api/v2/public/contests/${encodeURIComponent(new URL(source.url).searchParams.get('rankId'))}`,path+'.info.json');
      if(verifyPage(entry,collection,info,srk)!==source.url)throw new Error('Page mapping changed');
      const old=review.entries.find(e=>e.status==='approved'&&e.selection.contest_id===c.contestId&&e.source.srk_path===path);
      if(!old)throw new Error('No approved mapping');
      const bytes=await readFile(resolve(cache,path));row.sha256=sha256(bytes);row.changed=row.sha256!==old.source.content_sha256;
      if(srk.problems.map(p=>p.alias).join()!==c.problemIds.map(id=>catalog.problems.find(p=>p.problemId===id)?.ordinal).join())throw new Error('Problem ordinals changed');
      if(c.startAt&&c.startAt.slice(0,10)!==srk.contest.startAt.slice(0,10))throw new Error('Contest date mismatch');
      const group=preferredAwardGroup(srk);row.group=group??null;
      row.official=calculateAwards(srk,group);
      const series=(srk.series??[]).filter(s=>s.rule?.preset==='ICPC');
      const selected=series.find(s=>!group||s.rule.options?.filter?.byMarker===group);
      const boardSource=c.sources.find(s=>s.provider==='xcpcio_board');
      const knownGroups=boardSource ? (await boardConfig(c,boardSource)).group : {};
      const ambiguousGroup=!group && /本科|专科|高职|邀请|invitational|undergraduate|vocational|Track|独立学院/i.test(JSON.stringify(knownGroups??{}));
      if(series.length>1&&!group)row.estimate={status:'blocked',reason:'Unknown highest group'};
      else if(ambiguousGroup)row.estimate={status:'blocked',reason:'Board exposes separate eligible groups but SRK does not establish highest-group membership'};
      else if(selected?.rule.options?.count?.value?.some(n=>n>0)||selected?.rule.options?.ratio)row.estimate={status:'blocked',reason:'Existing award configuration; official result must be resolved first'};
      else {
        const eligible=srk.rows.filter(r=>r.user?.official===true&&(!group||r.user.markers?.includes(group))).length;
        const copy=structuredClone(srk);
        copy.series=[{rule:{preset:'ICPC',options:{count:{value:[.1,.2,.3].map(r=>Math.floor(eligible*r)),type:'normal'},...(group?{filter:{byMarker:group}}:{})}},segments:['gold','silver','bronze'].map(style=>({style}))}];
        row.estimate=calculateAwards(copy,group);
      }
    } else {
      const path=new URL(source.url).pathname.replace(/^\/+|\/+$/g,'');
      const config=await boardConfig(c,source);
      if(![c.title,...c.aliases,source.source_title].some(t=>normalizeTitle(t)===normalizeTitle(config.contest_name)))throw new Error('Contest title mismatch');
      if(config.problems.map(p=>p.label).join()!==c.problemIds.map(id=>catalog.problems.find(p=>p.problemId===id)?.ordinal).join())throw new Error('Problem ordinals mismatch');
      // RankLand remains the preferred source after migration. Board is a gap fallback.
      if(!c.awardCutoffs&&!c.estimatedAwardCutoffs) {
        const [teams,runs]=await Promise.all(['team','run'].map(k=>get(`https://board.xcpcio.com/data/${path}/${k}.json`,`board/${c.contestId}/${k}.json`)));
        row.board=calculateBoardAwards(config,Array.isArray(teams)?teams:Object.values(teams),Array.isArray(runs)?runs:Object.values(runs));
      }
    }
    row.status='checked';
  }catch(e){row.status='blocked';row.reason=e.message;}
  audit.push(row);
  if(audit.length%20===0)console.log(`Checked ${audit.length}/${tasks.length}`);
},4);
audit.sort((a,b)=>a.contest_id.localeCompare(b.contest_id)||a.provider.localeCompare(b.provider));
await atomicJson(resolve(cache,'audit.json'),{fetched_at:new Date().toISOString(),commit_sha:head.sha,catalog_sha256:sha256(await readFile('catalog/default-catalog.min.json')),audit});
console.log(JSON.stringify({total:audit.length,blocked:audit.filter(r=>r.status==='blocked').length,changed_rankland:audit.filter(r=>r.changed).length,gap_candidates:audit.filter(r=>!r.has_awards&&!r.has_estimates&&(r.official?.status==='proposed'||r.estimate?.status==='proposed'||r.board)).map(r=>({title:r.title,provider:r.provider}))},null,2));
