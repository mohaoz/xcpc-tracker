import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {applyRating,inspectRating} from './import-xcpc-rating.mjs';
import {atomicJson,readJson,sha256,problemIdentity} from './source-import-lib.mjs';

const identity=m=>`${m.contest_slug}:${m.ordinal}`;
function indexRows(rows) {
  const out=new Map();
  for(const row of rows) {
    const key=`${row.contestSlug}:${row.alias}`;
    if(out.has(key))throw new Error(`Duplicate upstream identity: ${key}`);
    out.set(key,row);
  }
  return out;
}
export function refreshRatingMetadata(catalog,previousRaw,currentRaw,history) {
  const previousHash=sha256(previousRaw),currentHash=sha256(currentRaw);
  const oldRows=indexRows(JSON.parse(previousRaw)),rows=indexRows(JSON.parse(currentRaw));
  const inspected=inspectRating(catalog,[...rows.values()]);
  const output=applyRating(catalog,inspected);
  const byProblem=new Map(),owners=new Map(),previousValues=new Map();
  for(const match of inspected.matches)byProblem.set(match.problem_id,[...(byProblem.get(match.problem_id)??[]),match]);
  // Audit shared-ID copies separately. Catalog fields belong to stable contest
  // problem entities; transitive joins must not silently expand field ownership
  // or replace the existing direct-provider matching contract.
  const parent=new Map(catalog.problems.map(p=>[p.problemId,p.problemId]));
  const find=id=>{while(parent.get(id)!==id){parent.set(id,parent.get(parent.get(id)));id=parent.get(id);}return id;};
  const identityOwners=new Map(),equivalenceEdges=[];
  for(const p of catalog.problems)for(const s of p.sources) {
    const key=s.kind==='problem'?problemIdentity(s.url):null;if(!key)continue;
    const previous=identityOwners.get(key)??[];
    if(previous.length)parent.set(find(p.problemId),find(previous[0]));
    if(!previous.includes(p.problemId))previous.push(p.problemId);identityOwners.set(key,previous);
  }
  for(const [providerIdentity,ids]of identityOwners)if(ids.length>1)equivalenceEdges.push({provider_identity:providerIdentity,problem_ids:ids});
  const components=new Map(),componentCandidates=new Map();
  for(const p of catalog.problems) {
    const root=find(p.problemId);components.set(root,[...(components.get(root)??[]),p.problemId]);
    const candidates=(byProblem.get(p.problemId)??[]).map(m=>({source_identity:identity(m),value:rows.get(identity(m))?.problemRating,observed_for_problem_id:p.problemId})).filter(s=>Number.isFinite(s.value)&&s.value>=0);
    componentCandidates.set(root,[...(componentCandidates.get(root)??[]),...candidates]);
  }
  for(const review of history) {
    if(review.review?.status!=='approved')throw new Error('Historical ownership requires an approved review');
    const historicalMatches=review.matches??review.inspected?.matches;
    if(!Array.isArray(historicalMatches))throw new Error('Historical review has no verified matches');
    if(review.inspected&&(!review.applied_at||!/^([a-f0-9]{64})$/.test(review.output_catalog_sha256??'')))throw new Error('Full-refresh ownership requires an applied receipt');
    for(const match of historicalMatches) {
      const problemOwners=owners.get(match.problem_id)??new Map();
      for(const tag of match.tags) {
        const tagOwners=problemOwners.get(tag)??new Set();tagOwners.add(identity(match));problemOwners.set(tag,tagOwners);
      }
      owners.set(match.problem_id,problemOwners);
      if(review.source_sha256===previousHash) {
        const value=oldRows.get(identity(match))?.problemRating;
        if(Number.isFinite(value)&&value>=0)previousValues.set(match.problem_id,[...(previousValues.get(match.problem_id)??[]),{source_identity:identity(match),value}]);
      }
    }
  }
  const tagChanges=[],ratingChanges=[],preserved=[],conflicts=[];
  let checkedRatings=0,unchangedRatings=0;
  for(let i=0;i<catalog.problems.length;i++) {
    const before=catalog.problems[i],problem=output.problems[i],matches=byProblem.get(before.problemId)??[];
    // Numeric-only identity evidence does not verify tag content, including an
    // empty match.tags array caused by a lost upstream title.
    const tagMatches=matches.filter(m=>m.status==='classified'&&m.evidence!=='complete_provider_ids_and_verified_original_contest');
    const freshTags=new Set(tagMatches.flatMap(m=>m.tags));
    const oldTags=before.tags??[],removed=[];
    for(const tag of oldTags) {
      const priorOwners=owners.get(before.problemId)?.get(tag);
      if(!priorOwners||freshTags.has(tag))continue;
      if([...priorOwners].every(owner=>tagMatches.some(m=>identity(m)===owner)))removed.push(tag);
      else preserved.push({problem_id:before.problemId,field:'tags',value:tag,reason:'Prior owner is absent, unknown or unresolved; absence is not deletion'});
    }
    const nextTags=[...new Set([...oldTags.filter(tag=>!removed.includes(tag)),...freshTags])].sort();
    if(JSON.stringify([...oldTags].sort())!==JSON.stringify(nextTags)) {
      const added=nextTags.filter(tag=>!oldTags.includes(tag));
      tagChanges.push({problem_id:before.problemId,previous_value:oldTags,value:nextTags,added,removed,removal_ownership:removed.map(tag=>({tag,source_identities:[...owners.get(before.problemId).get(tag)]})),preserved_other_tags:oldTags.filter(tag=>!owners.get(before.problemId)?.has(tag))});
      problem.tags=nextTags;
    } else if(before.tags!==undefined)problem.tags=before.tags;
    else if(!nextTags.length)delete problem.tags;
    const candidates=matches.map(m=>({source_identity:identity(m),value:rows.get(identity(m))?.problemRating})).filter(s=>Number.isFinite(s.value)&&s.value>=0);
    const unique=[...new Set(candidates.map(s=>s.value))];
    if(before.rating!=null)checkedRatings++;
    const previousEvidence=(previousValues.get(before.problemId)??[]).filter(s=>s.value===before.rating&&before.sources.some(p=>p.provider==='xcpc_rating'&&p.provider_problem_id===s.source_identity));
    const owned=previousEvidence.length>0;
    if(unique.length>1) {
      conflicts.push({problem_id:before.problemId,sources:candidates,previous_value:before.rating??null,source_owned:owned});
      if(before.rating!=null&&owned) {
        delete problem.rating;
        ratingChanges.push({problem_id:before.problemId,action:'withdraw_conflict',previous_value:before.rating,value:null,previous_evidence:previousEvidence,sources:candidates});
      }
      continue;
    }
    if(unique.length===0) {
      if(before.rating!=null)preserved.push({problem_id:before.problemId,field:'rating',value:before.rating,reason:'No current finite verified value; null/missing is not deletion'});
      continue;
    }
    if(before.rating===unique[0]){unchangedRatings++;continue;}
    if(before.rating!=null&&!owned) {
      preserved.push({problem_id:before.problemId,field:'rating',value:before.rating,candidate:unique[0],reason:'Current scalar ownership is not established; preserve other/manual provenance'});
      continue;
    }
    problem.rating=unique[0];
    ratingChanges.push({problem_id:before.problemId,action:before.rating==null?'add':unique[0]>before.rating?'increase':'decrease',previous_value:before.rating??null,value:unique[0],previous_evidence:previousEvidence,sources:candidates});
  }
  const linkedDifferences=[...components].filter(([root,ids])=>ids.length>1&&new Set((componentCandidates.get(root)??[]).map(s=>s.value)).size>1).map(([root,ids])=>({problem_ids:ids,sources:componentCandidates.get(root),disposition:'Audit only; no transitive metadata or field-ownership expansion'}));
  return {catalog:output,report:{previous_source_sha256:previousHash,source_sha256:currentHash,inspected,equivalence_edges:equivalenceEdges,linked_identity_differences:linkedDifferences,tag_changes:tagChanges,rating_changes:ratingChanges,preserved,conflicts,summary:{catalog_problems:catalog.problems.length,verified_problem_matches:new Set(inspected.matches.map(m=>m.problem_id)).size,existing_ratings_compared:checkedRatings,unchanged_numeric_values:unchangedRatings,tag_problems_changed:tagChanges.length,tag_values_added:tagChanges.reduce((n,r)=>n+r.added.length,0),tag_values_removed:tagChanges.reduce((n,r)=>n+r.removed.length,0),rating_additions:ratingChanges.filter(r=>r.action==='add').length,rating_increases:ratingChanges.filter(r=>r.action==='increase').length,rating_decreases:ratingChanges.filter(r=>r.action==='decrease').length,rating_conflict_withdrawals:ratingChanges.filter(r=>r.action==='withdraw_conflict').length}}};
}

async function main() {
  const [command,previousPath,currentPath,reportPath,catalogPath='catalog/default-catalog.min.json',...priorRefreshReceipts]=process.argv.slice(2);
  if(!['inspect','apply'].includes(command)||!previousPath||!currentPath||!reportPath)throw new Error('Usage: refresh-xcpc-rating-metadata.mjs inspect|apply <previous-raw> <current-raw> <review-json> [catalog-json] [prior-applied-refresh-receipt ...]');
  const historyPaths=['fixtures/imports/xcpc-rating/2026-09-review.json','fixtures/imports/xcpc-rating/2026-10-01-review.json','fixtures/imports/xcpc-rating/2026-10-01-numeric-identity-review.json',...priorRefreshReceipts];
  const [catalogBytes,previousRaw,currentRaw,...history]=await Promise.all([readFile(catalogPath),readFile(previousPath),readFile(currentPath),...historyPaths.map(readJson)]);
  const result=refreshRatingMetadata(JSON.parse(catalogBytes),previousRaw,currentRaw,history);
  const report={schema_version:1,input_catalog_sha256:sha256(catalogBytes),history_files:historyPaths,...result.report};
  if(command==='inspect')await atomicJson(reportPath,report);
  else {
    const approved=await readJson(reportPath),comparison={...approved};delete comparison.review;delete comparison.applied_at;delete comparison.output_catalog_sha256;
    if(approved.review?.status!=='approved'||!approved.review?.reviewed_by||JSON.stringify(comparison)!==JSON.stringify(report))throw new Error('Apply requires unchanged raw inputs, catalog and approved ownership-aware review');
    await atomicJson(catalogPath,result.catalog);
    await atomicJson(reportPath,{...approved,applied_at:new Date().toISOString(),output_catalog_sha256:sha256(await readFile(catalogPath))});
  }
  console.log(JSON.stringify(report.summary));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1;});
