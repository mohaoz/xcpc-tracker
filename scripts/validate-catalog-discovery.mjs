import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {discover,normalizeSource,compareSource,SOURCE_URLS,markdown,safeOutput} from './discover-catalog-updates.mjs';

const fixture=JSON.parse(await readFile(new URL('../fixtures/imports/catalog-discovery.example.json',import.meta.url),'utf8'));
let inputs=structuredClone(fixture), failed=new Set(), calls=[];
const fetcher=async url=>{
  calls.push(url);
  assert.ok(!new URL(url).hostname.endsWith('qoj.ac'),'Discovery must never fetch QOJ');
  let provider,raw;
  if(url===SOURCE_URLS.rating){provider='rating';raw=inputs.rating;}
  else if(url===SOURCE_URLS.board){provider='board';raw=inputs.board;}
  else if(url===SOURCE_URLS.rankland){provider='rankland';raw={sha:inputs.rankland.revision};}
  else if(url.includes('/git/trees/')){provider='rankland';raw=inputs.rankland.tree;}
  else if(url.endsWith('/official/config.yaml')){provider='rankland';raw=inputs.rankland.config;}
  else throw new Error(`Unexpected request: ${url}`);
  return {ok:!failed.has(provider),status:failed.has(provider)?503:200,text:async()=>typeof raw==='string'?raw:JSON.stringify(raw)};
};
const catalog=structuredClone(fixture.catalog), original=JSON.stringify(catalog);
const first=await discover({catalog,fetcher,now:'2026-09-21T00:00:00Z'});
assert.ok(first.report.sources.every(source=>source.status==='succeeded'));
assert.equal(first.report.observations.filter(item=>item.change==='first_seen').length,4);
assert.equal(first.report.observations.find(item=>item.entry.id==='example').metadata_differences.length,1);
assert.equal(first.report.observations.find(item=>item.entry.id==='candidate').catalog_contest_ids.length,0);
const second=await discover({catalog,fetcher,previous:first.state,now:'2026-09-22T00:00:00Z'});
assert.ok(second.report.observations.every(item=>item.change===null),'Repeat fetch must not manufacture new events');
inputs.rankland.revision='cccccccccccccccccccccccccccccccccccccccc';
inputs.rating.reverse();
const reordered=await discover({catalog,fetcher,previous:second.state});
assert.ok(reordered.report.observations.every(item=>item.change===null),'Ordering and unrelated commit changes are not content changes');
inputs.rating.find(row=>row.contestSlug==='example').problemRating=1800;
inputs.rankland.tree.tree[0].sha='dddddddddddddddddddddddddddddddddddddddd';
const changed=await discover({catalog,fetcher,previous:second.state});
assert.equal(changed.report.observations.filter(item=>item.change==='changed').length,2);
failed.add('rating');
const partial=await discover({catalog,fetcher,previous:changed.state});
assert.deepEqual(partial.state.sources.rating,changed.state.sources.rating);
assert.ok(partial.report.observations.filter(item=>item.provider==='rating').every(item=>item.stale && item.change===null));
failed.clear();inputs.rating=[];
const empty=await discover({catalog,fetcher,previous:changed.state});
assert.equal(empty.report.sources.find(source=>source.provider==='rating').status,'failed');
assert.deepEqual(empty.state.sources.rating,changed.state.sources.rating);
inputs=structuredClone(fixture);
inputs.rating=inputs.rating.filter(row=>row.contestSlug!=='candidate');
const missing=await discover({catalog,fetcher,previous:second.state});
assert.equal(missing.report.observations.find(item=>item.entry.id==='candidate').change,'missing_upstream');
assert.equal(missing.state.sources.rating.history.candidate.present,false);
inputs=structuredClone(fixture);
const back=await discover({catalog,fetcher,previous:missing.state});
assert.equal(back.report.observations.find(item=>item.entry.id==='candidate').change,'reappeared');
calls=[];
const replay=await discover({catalog,fetcher,previous:second.state,offline:true});
assert.equal(calls.length,0);
assert.ok(replay.report.sources.every(source=>source.status==='offline'));
assert.deepEqual(replay.state,second.state,'Offline replay must preserve observed timestamps and the successful cache');
assert.throws(()=>normalizeSource('rating',[fixture.rating[0],fixture.rating[0]]),/Duplicate/);
assert.throws(()=>normalizeSource('rankland',{...fixture.rankland,tree:{...fixture.rankland.tree,truncated:true}}),/truncated/);
assert.throws(()=>normalizeSource('board',{x:{board_link:'//evil.test',config:{contest_name:'bad'}}}),/Unsafe/);
assert.throws(()=>normalizeSource('rating',[{...fixture.rating[0],problemRating:-1}]),/Invalid/);
const hostile=compareSource('rating',[{id:'__proto__',title:'Prototype key'}],undefined,'2026-09-21');
assert.ok(Object.hasOwn(hostile.history,'__proto__'));
assert.equal(Object.getPrototypeOf(hostile.history),Object.prototype);
assert.equal(JSON.stringify(catalog),original,'Discovery must never mutate the catalog');
assert.match(markdown(first.report),/首次发现不代表新举办/);
for(const target of ['catalog/new.json','web/public/candidates.json','.git/discovery.json'])await assert.rejects(safeOutput(target),/cannot write/);
console.log('Discovery passed: new/changed/missing/reappeared, stable ordering, pinned SRK blobs, partial failure retention, malformed source rejection, offline replay and no catalog mutations.');
