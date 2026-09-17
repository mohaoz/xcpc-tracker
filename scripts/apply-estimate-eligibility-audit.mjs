import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {atomicJson,sha256} from './source-import-lib.mjs';
const [auditPath,receiptPath]=process.argv.slice(2);
if(!auditPath || !receiptPath)throw new Error('Usage: apply-estimate-eligibility-audit.mjs <audit> <receipt>');
const path='catalog/default-catalog.min.json',bytes=await readFile(path),catalog=JSON.parse(bytes);
const audit=JSON.parse(await readFile(auditPath,'utf8'));
const removed=[];
for(const row of audit.audit) {
  const contest=catalog.contests.find(c=>c.contestId===row.contest_id);
  assert.ok(contest);
  assert.deepEqual(contest[row.field],row.value,'Estimate changed after eligibility audit');
  if(row.status==='verified')continue;
  assert.equal(row.status,'blocked');
  assert.notEqual(row.value.source,'explicit');
  delete contest[row.field];removed.push(row);
}
catalog.exportedAt=new Date().toISOString();
await atomicJson(receiptPath,{audited_at:new Date().toISOString(),input_catalog_sha256:sha256(bytes),scope:`Official-team/highest-group eligibility of ${audit.audit.length} existing non-explicit cutoffs; removed values retained here, no contests or sources removed`,removed,verified:audit.audit.filter(r=>r.status==='verified')});
await atomicJson(path,catalog,bytes.toString().includes('\n  '));
console.log(JSON.stringify({removed:removed.length,verified:audit.audit.length-removed.length}));
