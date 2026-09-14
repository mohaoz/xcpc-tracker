import {readFile} from 'node:fs/promises';
import {atomicJson,readJson,sha256,normalizeTitle} from './source-import-lib.mjs';
import {calculateBoardAwards} from './xcpcio-gap-awards.mjs';
const cache=process.argv[2];if(!cache)throw new Error('Provide audited cache directory');
const catalog=await readJson('catalog/default-catalog.min.json');
const audit=[];
for(const c of catalog.contests.filter(c=>c.sources.some(s=>s.provider==='xcpcio_board')&&!c.awardCutoffs&&!c.estimatedAwardCutoffs)) {
  const source=c.sources.find(s=>s.provider==='xcpcio_board');
  try {
    const raw=await Promise.all(['config','team','run'].map(k=>readFile(`${cache}/${c.contestId}/${k}.json`)));
    const [config,teams,runs]=raw.map(b=>JSON.parse(b));
    if(![c.title,...c.aliases,source.source_title].some(t=>normalizeTitle(t)===normalizeTitle(config.contest_name)))throw new Error('Contest title mismatch');
    if(config.problems.map(p=>p.label).join()!==c.problemIds.map(id=>catalog.problems.find(p=>p.problemId===id)?.ordinal).join())throw new Error('Problem list mismatch');
    const result=calculateBoardAwards(config,Array.isArray(teams)?teams:Object.values(teams),Array.isArray(runs)?runs:Object.values(runs));
    const {group,penalty_rule,...award}=result;
    const value={...award,sourceProvider:'xcpcio_board',sourceLabel:'XCPCIO Board',sourceUrl:source.url};
    if(result.source==='explicit')c.awardCutoffs=value;else c.estimatedAwardCutoffs=value;
    audit.push({contest_id:c.contestId,title:c.title,status:'applied',group,penalty_rule,source_url:source.url,hashes:Object.fromEntries(['config','team','run'].map((k,i)=>[k,sha256(raw[i])])),result:value});
  } catch(e) {audit.push({contest_id:c.contestId,title:c.title,status:'blocked',reason:e.message});}
}
await atomicJson('fixtures/imports/xcpcio-2026-gap-awards.json',{fetched_at:new Date().toISOString(),audit});
await atomicJson('catalog/default-catalog.min.json',catalog);
console.log(JSON.stringify(audit.map(r=>({title:r.title,status:r.status,reason:r.reason,source:r.result?.source,cutoffs:r.result?.cutoffs})),null,2));
