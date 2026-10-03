import {readFile, writeFile, mkdir, realpath} from 'node:fs/promises';
import {resolve, dirname, relative, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseIndex} from './rankland-lib.mjs';
import {sha256, atomicJson, normalizeTitle, problemIdentity} from './source-import-lib.mjs';
import {RATING_URL} from './import-xcpc-rating.mjs';

export const SOURCE_URLS = {
  rating: RATING_URL,
  board: 'https://board.xcpcio.com/data/index/contest_list.json',
  rankland: 'https://api.github.com/repos/algoux/srk-collection/commits/HEAD',
};
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, canonical(value[key])]));
  return value;
}
const fingerprint = value => sha256(JSON.stringify(canonical(value)));
function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}`);
  return value;
}
function uniqueEntries(entries) {
  if (!entries.length) throw new Error('Empty source snapshot; previous observations retained');
  const keys = new Set();
  for (const entry of entries) {
    if (keys.has(entry.id)) throw new Error(`Duplicate source identity: ${entry.id}`);
    keys.add(entry.id);
  }
  return entries.sort((a,b) => compare(a.id,b.id));
}

export function normalizeSource(provider, raw) {
  if (provider === 'rating') {
    if (!Array.isArray(raw)) throw new Error('Invalid Rating snapshot');
    const groups = new Map();
    const keys = new Set();
    for (const row of raw) {
      nonempty(row?.contestSlug,'contestSlug'); nonempty(row.alias,'alias');
      for(const field of ['title','contestTitle','problemUrl'])if(row[field]!=null && typeof row[field]!=='string')throw new Error(`Invalid Rating ${field}`);
      if (!Array.isArray(row.detailTags) || row.detailTags.some(tag=>typeof tag!=='string')) throw new Error('Invalid Rating tags');
      if (row.problemRating != null && (typeof row.problemRating !== 'number' || !Number.isFinite(row.problemRating) || row.problemRating < 0)) throw new Error('Invalid Rating value');
      const key=JSON.stringify([row.contestSlug,row.alias]);
      if(keys.has(key)) throw new Error(`Duplicate Rating problem: ${key}`);
      keys.add(key);
      const group=groups.get(row.contestSlug) ?? [];
      group.push({alias:row.alias,title:row.title ?? null,problem_url:row.problemUrl ?? null,tags:[...new Set(row.detailTags)].sort(compare),rating:row.problemRating ?? null});
      groups.set(row.contestSlug,group);
    }
    return uniqueEntries([...groups].map(([slug,problems])=>({
      id:slug,title:raw.find(row=>row.contestSlug===slug).contestTitle || slug,
      url:'https://hei-maom.github.io/xcpcrating/#/problems',
      problems:problems.sort((a,b)=>compare(a.alias,b.alias)),
    })));
  }
  if (provider === 'board') {
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('Invalid Board index');
    const entries=[];
    function walk(node) {
      if (!node || typeof node!=='object') return;
      if ('board_link' in node) {
        const path=nonempty(node.board_link,'board_link');
        if(!/^\/[a-zA-Z0-9_/-]+$/.test(path) || path.includes('//')) throw new Error('Unsafe Board path');
        entries.push({id:path.replace(/\/$/,''),title:nonempty(node.config?.contest_name,'contest_name'),url:`https://board.xcpcio.com${path}`,config:node.config});
        return;
      }
      for(const child of Object.values(node))walk(child);
    }
    walk(raw);return uniqueEntries(entries);
  }
  if (provider === 'rankland') {
    if (!/^[a-f0-9]{40}$/.test(raw?.revision) || raw.tree?.truncated !== false || !Array.isArray(raw.tree.tree)) throw new Error('Invalid or truncated SRK tree');
    const blobs=new Map(raw.tree.tree.filter(row=>row.type==='blob').map(row=>[row.path,row.sha]));
    return uniqueEntries(parseIndex(raw.config).map(entry=>{
      const blob=blobs.get(entry.srk_path);
      if(!/^[a-f0-9]{40}$/.test(blob))throw new Error(`Missing SRK blob: ${entry.srk_path}`);
      return {id:entry.srk_path,title:entry.labels.join(' / '),url:`https://github.com/algoux/srk-collection/blob/${raw.revision}/${entry.srk_path}`,blob_sha:blob};
    }));
  }
  throw new Error('Unknown discovery provider');
}

function observationFingerprint(provider,entry) {
  // A different repository commit does not itself mean every SRK changed.
  return fingerprint(provider==='rankland' ? {id:entry.id,title:entry.title,blob_sha:entry.blob_sha} : entry);
}

export function compareSource(provider, entries, previous, now) {
  const history=structuredClone(previous?.history ?? {});
  const changes=[];
  const current=new Set(entries.map(entry=>entry.id));
  for(const entry of entries) {
    const old=Object.hasOwn(history,entry.id) ? history[entry.id] : undefined, hash=observationFingerprint(provider,entry);
    const change=!old ? 'first_seen' : !old.present ? 'reappeared' : old.fingerprint!==hash ? 'changed' : null;
    if(change) changes.push({change,entry,previous_fingerprint:old?.fingerprint ?? null});
    Object.defineProperty(history,entry.id,{value:{fingerprint:hash,first_seen:old?.first_seen ?? now,last_seen:now,present:true,entry},enumerable:true,writable:true,configurable:true});
  }
  for(const [id,old] of Object.entries(history)) {
    if(old.present && !current.has(id)) {
      changes.push({change:'missing_upstream',entry:old.entry,previous_fingerprint:old.fingerprint});
      old.present=false;
    }
  }
  return {history,changes};
}

function indexProblems(catalog) {
  const rating=new Map(), identity=new Map();
  function add(map,key,problem) {
    if(!key)return;
    const bucket=map.get(key) ?? new Set();bucket.add(problem);map.set(key,bucket);
  }
  for(const problem of catalog.problems)for(const source of problem.sources) {
    if(source.provider==='xcpc_rating')add(rating,source.provider_problem_id,problem);
    add(identity,problemIdentity(source.url),problem);
  }
  return {rating,identity};
}
function relate(catalog,provider,entry,lookup) {
  const matches=new Set(), hints=new Set(), differences=[];
  for(const contest of catalog.contests) {
    if(provider==='rankland' && contest.sources.some(s=>s.provider==='rankland' && s.provider_contest_id?.replace(/^srk:/,'')===entry.id))matches.add(contest.contestId);
    if(provider==='board' && contest.sources.some(s=>{
      try{return s.provider==='xcpcio_board' && decodeURIComponent(new URL(s.url).pathname).replace(/\/$/,'')===entry.id;}catch{return false;}
    }))matches.add(contest.contestId);
    if([contest.title,...(contest.aliases ?? [])].some(title=>normalizeTitle(title)===normalizeTitle(entry.title)))hints.add(contest.contestId);
  }
  if(provider==='rating') {
    for(const row of entry.problems) {
      for(const problem of lookup.identity.get(problemIdentity(row.problem_url)) ?? [])matches.add(problem.contestId);
      for(const problem of lookup.rating.get(`${entry.id}:${row.alias}`) ?? []) {
        matches.add(problem.contestId);
        if(row.rating!==(problem.rating ?? null) || fingerprint(row.tags)!==fingerprint([...(problem.tags ?? [])].sort(compare)) || (row.title && row.title!==problem.title && !(problem.aliases ?? []).includes(row.title))) {
          differences.push({problem_id:problem.problemId,ordinal:row.alias,before:{title:problem.title,rating:problem.rating ?? null,tags:problem.tags ?? []},observed:row});
        }
      }
    }
  }
  return {catalog_contest_ids:[...matches].sort(compare),title_only_candidates:[...hints].filter(id=>!matches.has(id)).sort(compare),metadata_differences:differences};
}

async function fetchText(url,fetcher) {
  const response=await fetcher(url,{signal:AbortSignal.timeout(45000),headers:{'User-Agent':'xcpc-tracker-discovery','Accept':'application/json, text/plain, */*'}});
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);
  const text=await response.text();
  if(Buffer.byteLength(text)>32*1024*1024)throw new Error('Source exceeds 32 MiB');
  return text;
}
async function fetchSource(provider,fetcher) {
  if(provider!=='rankland')return JSON.parse(await fetchText(SOURCE_URLS[provider],fetcher));
  const head=JSON.parse(await fetchText(SOURCE_URLS.rankland,fetcher));
  if(!/^[a-f0-9]{40}$/.test(head.sha))throw new Error('Invalid upstream revision');
  const tree=JSON.parse(await fetchText(`https://api.github.com/repos/algoux/srk-collection/git/trees/${head.sha}?recursive=1`,fetcher));
  const config=await fetchText(`https://raw.githubusercontent.com/algoux/srk-collection/${head.sha}/official/config.yaml`,fetcher);
  return {revision:head.sha,tree,config};
}

export async function discover({catalog,previous={schema_version:1,sources:{}},fetcher=fetch,now=new Date().toISOString(),offline=false}) {
  if(previous.schema_version!==1 || !previous.sources || typeof previous.sources!=='object')throw new Error('Invalid discovery state');
  const state=structuredClone(previous), sources=[], observations=[];
  const lookup=indexProblems(catalog);
  for(const provider of Object.keys(SOURCE_URLS)) {
    const old=previous.sources[provider];
    try {
      const raw=offline ? old?.raw : await fetchSource(provider,fetcher);
      const entries=normalizeSource(provider,raw);
      const {history,changes}=compareSource(provider,entries,old,offline ? old.last_success : now);
      const changeById=new Map(changes.map(change=>[change.entry.id,change.change]));
      state.sources[provider]={raw,history,last_success:offline ? old.last_success : now,source_sha256:fingerprint(raw)};
      sources.push({provider,url:SOURCE_URLS[provider],status:offline?'offline':'succeeded',source_sha256:fingerprint(raw),last_success:state.sources[provider].last_success,changes:changes.length});
      for(const entry of entries)observations.push({provider,entry,change:changeById.get(entry.id) ?? null,stale:false,...relate(catalog,provider,entry,lookup)});
      for(const change of changes.filter(c=>c.change==='missing_upstream'))observations.push({provider,...change,stale:false,...relate(catalog,provider,change.entry,lookup)});
    }catch(error) {
      sources.push({provider,url:SOURCE_URLS[provider],status:'failed',error:error.message,last_success:old?.last_success ?? null});
      for(const item of Object.values(old?.history ?? {}).filter(item=>item.present))observations.push({provider,entry:item.entry,change:null,stale:true,...relate(catalog,provider,item.entry,lookup)});
    }
  }
  return {state,report:{schema_version:1,generated_at:now,hash_format:'canonical_json_sha256',catalog_sha256:fingerprint(catalog),review_required:true,sources,observations}};
}

export function markdown(report) {
  const escape=value=>String(value).replace(/[\r\n|]/g,' ').replace(/[\\`*_{}\[\]()]/g,'\\$&').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const pending=report.observations.filter(item=>item.change || !item.catalog_contest_ids.length || item.metadata_differences.length);
  return ['# 自动发现报告','',`生成时间：${report.generated_at}`,'','所有条目仅供审核；首次发现不代表新举办的比赛，来源消失不代表比赛应删除。不同来源或组别不会自动合并。','',
    ...report.sources.map(source=>`- ${source.provider}: ${source.status}${source.error ? ` — ${escape(source.error)}` : ''}；最近成功：${source.last_success ?? '无'}`),'',
    `待审观察 ${pending.length} 条。完整原始快照和变化证据见 state.json / report.json。`,'',
    '| 来源 | 上游标题 | 变化 | 已关联目录 | 元数据差异 |','| --- | --- | --- | --- | --- |',
    ...pending.map(item=>`| ${item.provider}${item.stale?'（旧快照）':''} | ${escape(item.entry.title)} | ${item.change ?? '待补映射'} | ${item.catalog_contest_ids.length} | ${item.metadata_differences.length} |`),'',
    'Rating 题目列表只提供补充线索。RankLand 仅检测 SRK 文件变化，不在此计算奖牌；XCPCIO 检测公开索引配置变化，不声称已检查完整榜单。','',
    '来源与许可：XCPC Rating / Hei-MaoM；RankLand / algoUX / srk-collection（AGPL-3.0，见 LICENSE-SRK.txt）；XCPCIO。',''].join('\n');
}

export async function safeOutput(path) {
  const target=resolve(path);
  for(const folder of ['catalog','web','.git']) {
    const blocked=relative(resolve(repoRoot,folder),target);
    if(!blocked || (!blocked.startsWith('..') && !isAbsolute(blocked)))throw new Error('Discovery cannot write into catalog, web or git');
  }
  let ancestor=target;
  while(true) {
    try {const physical=await realpath(ancestor);if(physical!==ancestor)throw new Error('Output cannot traverse symlinks');break;}
    catch(error){if(error.code!=='ENOENT')throw error;ancestor=dirname(ancestor);}
  }
  const roots=[resolve(repoRoot,'docs'),resolve(repoRoot,'tmp'),resolve(tmpdir())];
  if(!roots.some(root=>{const child=relative(root,target);return child && !child.startsWith('..') && !isAbsolute(child);}))throw new Error('Discovery outputs must be under docs/, tmp/ or the system temporary directory');
  return target;
}
async function main() {
  const args=process.argv.slice(2), options={};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--offline')options.offline=true;
    else if(['--state','--output'].includes(args[i]) && args[i+1] && !args[i+1].startsWith('--'))options[args[i].slice(2)]=args[++i];
    else throw new Error('Usage: discover-catalog-updates.mjs [--offline] [--state tmp/discovery/state.json] [--output docs/discovery/generated]');
  }
  const statePath=await safeOutput(options.state ?? resolve(repoRoot,'tmp/discovery/state.json'));
  const output=await safeOutput(options.output ?? resolve(repoRoot,'docs/discovery/generated'));
  let previous;
  try{previous=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const catalog=JSON.parse(await readFile(resolve(repoRoot,'catalog/default-catalog.min.json'),'utf8'));
  const {state,report}=await discover({catalog,previous,offline:options.offline});
  await mkdir(output,{recursive:true});
  await atomicJson(statePath,state);
  await atomicJson(resolve(output,'state.json'),state);
  await atomicJson(resolve(output,'report.json'),report);
  await writeFile(resolve(output,'report.md'),markdown(report));
  await writeFile(resolve(output,'LICENSE-SRK.txt'),await readFile(resolve(repoRoot,'catalog/LICENSE-SRK.txt')));
  console.log(JSON.stringify({output,sources:report.sources},null,2));
  if(report.sources.some(source=>source.status==='failed'))process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error);process.exitCode=1;});
