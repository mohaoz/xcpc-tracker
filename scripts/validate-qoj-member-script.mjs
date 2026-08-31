import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "../web/node_modules/typescript/lib/typescript.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatorPath = path.join(repoRoot, "web/src/lib/qoj-member-script.ts");
const fixturePath = path.join(repoRoot, "fixtures/imports/qoj/qoj-members-batch.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const generatorSource = fs.readFileSync(generatorPath, "utf8");
const compiledGenerator = ts.transpileModule(generatorSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: generatorPath,
  reportDiagnostics: true,
});
assert(
  !(compiledGenerator.diagnostics ?? []).some(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  ),
  "QOJ member script generator failed to transpile",
);

const generatorModuleUrl = `data:text/javascript;base64,${Buffer.from(compiledGenerator.outputText).toString("base64")}`;
const { buildQojBatchBrowserScript, buildQojBrowserScript } = await import(generatorModuleUrl);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

assert(fixture.provider === "qoj", "QOJ batch fixture must use provider=qoj");
assert(typeof fixture.exported_at === "string", "QOJ batch fixture must include exported_at");
assert(fixture.script_version === 2, "QOJ batch fixture must use script_version=2");
assert(Array.isArray(fixture.members) && fixture.members.length > 1, "QOJ batch fixture must include multiple members");
assert(Array.isArray(fixture.fetch_failures) && fixture.fetch_failures.length > 0, "QOJ batch fixture must include a fetch failure");

for (const member of fixture.members) {
  assert(typeof member.member_id === "string" && member.member_id, "QOJ fixture member needs member_id");
  assert(typeof member.handle === "string" && member.handle, "QOJ fixture member needs handle");
  assert(Array.isArray(member.solved), "QOJ fixture member solved must be an array");
  assert(Array.isArray(member.attempted), "QOJ fixture member attempted must be an array");
}
for (const failure of fixture.fetch_failures) {
  assert(typeof failure.handle === "string" && failure.handle, "QOJ fixture failure needs handle");
  assert(typeof failure.error === "string" && failure.error, "QOJ fixture failure needs error evidence");
}

const batchScript = buildQojBatchBrowserScript({
  members: fixture.members.map((member) => ({
    memberId: member.member_id,
    displayName: member.display_name,
    handle: member.handle,
  })),
});
new Function(batchScript);
assert(batchScript.includes('script_version: 2'), "Generated QOJ batch script must export version 2");
assert(batchScript.includes("fetch_failures"), "Generated QOJ batch script must export fetch failures");
for (const member of fixture.members) {
  assert(batchScript.includes(JSON.stringify(member.handle)), `Generated script is missing ${member.handle}`);
}

const singleScript = buildQojBrowserScript({ memberId: "single", handle: "single_qoj" });
new Function(singleScript);

let duplicateRejected = false;
try {
  buildQojBatchBrowserScript({
    members: [
      { memberId: "first", handle: "Duplicate_QOJ" },
      { memberId: "second", handle: "duplicate_qoj" },
    ],
  });
} catch {
  duplicateRejected = true;
}
assert(duplicateRejected, "QOJ batch generator must reject one handle linked to multiple members");

console.log(JSON.stringify({
  fixture: path.relative(repoRoot, fixturePath),
  fixtureMemberCount: fixture.members.length,
  fixtureFailureCount: fixture.fetch_failures.length,
  batchScriptSyntax: "valid",
  singleScriptSyntax: "valid",
  duplicateHandleGuard: "valid",
}, null, 2));
