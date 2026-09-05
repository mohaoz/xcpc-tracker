import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "../web/node_modules/typescript/lib/typescript.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRequire = createRequire(path.join(repoRoot, "web/package.json"));
const { parse, compileScript } = webRequire("@vue/compiler-sfc");
const vue = webRequire("vue");
const { createPinia } = webRequire("pinia");

export function loadModule(relativePath, overrides = {}, sourceOverride) {
  const filename = path.resolve(repoRoot, relativePath);
  let source = sourceOverride ?? fs.readFileSync(filename, "utf8");
  if (filename.endsWith(".vue")) {
    source = compileScript(parse(source, { filename }).descriptor, { id: "coverage-test" }).content;
  }
  source = source.replaceAll("import.meta.env.BASE_URL", '"/"');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  const module = { exports: {} };
  const require = (id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id.startsWith(".")) return loadModule(path.relative(repoRoot, path.resolve(path.dirname(filename), `${id}.ts`)), overrides);
    return webRequire(id);
  };
  new Function("require", "module", "exports", compiled.outputText)(require, module, module.exports);
  return module.exports;
}

export function createDbMock(records) {
  const reads = {};
  const listeners = new Set();
  class MockDexie {
    constructor(name) { this.name = name; }
    version() {
      return { stores: (schema) => {
        for (const table of Object.keys(schema)) {
          this[table] = {
            toArray: async () => {
              reads[table] = (reads[table] ?? 0) + 1;
              return structuredClone(records[table] ?? []);
            },
          };
        }
      } };
    }
    transaction(...args) { return args.at(-1)(); }
    static on(_event, listener) {
      if (listener) listeners.add(listener);
      return { unsubscribe: (callback) => listeners.delete(callback) };
    }
  }
  return { MockDexie, reads, listeners };
}

const coverage = loadModule("web/src/lib/local-coverage.ts");
const member = (id, deletedAt = null) => ({ memberId: id, displayName: id, createdAt: "2026-01-01", updatedAt: "2026-01-01", deletedAt });
const handle = (memberId, provider, deletedAt = null) => ({ memberId, provider, handleId: `${memberId}:${provider}`, handle: memberId, displayLabel: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", deletedAt });
const status = (memberId, problemId, provider, state, lastSeenAt = "2026-01-01") => ({ memberId, problemId, provider, status: state, lastSeenAt });
const contest = (contestId, ids) => ({
  contest: { contestId, title: contestId, tags: [], aliases: [], sources: [], curationStatus: "reviewed", problemIds: ids },
  problems: ids.map((problemId, i) => ({ problemId, contestId, title: problemId, ordinal: String(i + 1), aliases: [], sources: [] })),
});
const records = {
  members: [member("alice"), member("bob"), member("deleted", "2026-01-01")],
  memberHandles: [handle("alice", "qoj"), handle("alice", "codeforces"), handle("bob", "qoj", "2026-01-01")],
  memberProblemStatus: [
    status("alice", "p1", "qoj", "attempted"),
    status("alice", "p1", "codeforces", "solved"),
    status("alice", "p1", "manual", "attempted"),
    status("alice", "p2", "qoj", "attempted", "2026-02-01"),
    status("bob", "p2", "qoj", "solved", "2026-03-01"),
    status("bob", "p3", "manual", "solved"),
    status("deleted", "p4", "manual", "solved"),
    status("missing", "p4", "manual", "solved"),
  ],
};
const payload = [contest("c1", ["p1", "p2", "p3", "p4"]), contest("shared", ["p1"]), contest("empty", [])];
const input = coverage.buildMemberCoverageInput(records.members, records.memberHandles, records.memberProblemStatus);
assert.deepEqual(input.members.map(({ memberId, solvedCount, attemptedCount, lastSyncedAt }) => ({ memberId, solvedCount, attemptedCount, lastSyncedAt })), [
  { memberId: "alice", solvedCount: 1, attemptedCount: 1, lastSyncedAt: "2026-02-01" },
  { memberId: "bob", solvedCount: 1, attemptedCount: 0, lastSyncedAt: "2026-01-01" },
]);
const states = (options) => coverage.summarizeCatalogCoverage(payload, input, options)[0].problemStates.map((problem) => problem.status);
assert.deepEqual(states(), ["solved", "attempted", "solved", "unseen"]);
assert.deepEqual(states({ memberIds: ["bob"] }), ["unseen", "unseen", "solved", "unseen"]);
assert.deepEqual(states({ memberIds: [] }), ["unseen", "unseen", "unseen", "unseen"]);
assert.deepEqual(states({ memberIds: ["deleted", "missing"] }), states({ memberIds: [] }));
assert.equal(coverage.summarizeCatalogCoverage(payload, input).length, 2);
assert.equal(coverage.summarizeCatalogCoverage(payload, input)[1].solvedProblemCount, 1);
const matrix = coverage.buildContestCoverage(payload[0], input);
assert.equal(matrix.freshProblemCount, 1);
assert.deepEqual(matrix.problems[1].members.map((item) => item.status), ["attempted", "unseen"]);

const dbMock = createDbMock(records);
const db = loadModule("web/src/lib/local-db.ts", { dexie: dbMock.MockDexie });
await db.listContestCoverageSummariesForCatalog(Array.from({ length: 235 }, (_, i) => contest(`contest-${i}`, ["p1", "p2"])));
assert.deepEqual(dbMock.reads, { members: 1, memberHandles: 1, memberProblemStatus: 1 });
let invalidations = 0;
const unsubscribe = db.subscribeCoverageDataMutated(() => invalidations++);
for (const listener of dbMock.listeners) {
  listener({ "idb://other-db/members/": {} });
  listener({ "idb://xcpc_tracker_local/syncRecords/": {} });
  listener({ "idb://xcpc_tracker_local/memberProblemStatus/": {} });
  listener({ "idb://xcpc_tracker_local/catalogContests/:dels": {} });
}
assert.equal(invalidations, 2);
unsubscribe();
assert.equal(dbMock.listeners.size, 0);

// Exercise the real list setup/lifecycle in Vue's renderer without a browser or network.
let dataListener;
let memberReads = 0;
let catalogReads = 0;
let payloadReads = 0;
let failNextLoad = false;
let blockNextRead;
let currentInput = input;
const listStoreModule = loadModule("web/src/stores/contest-list.ts");
const listComponent = loadModule("web/src/views/ContestListView.vue", {
  "../lib/local-db": {
    readMemberCoverageInputFromDb: async () => {
      memberReads++;
      if (failNextLoad) { failNextLoad = false; throw new Error("temporary read failure"); }
      if (blockNextRead) { const gate = blockNextRead; blockNextRead = null; return gate; }
      return currentInput;
    },
    subscribeCoverageDataMutated: (listener) => { dataListener = listener; return () => { dataListener = null; }; },
  },
  "../lib/catalog-runtime": {
    listRuntimeCatalogContests: async () => { catalogReads++; return { generatedAt: "2026-01-01", contests: payload.map(({ contest, problems }) => ({ ...contest, problemCount: problems.length })) }; },
    listRuntimeContestCoveragePayload: async () => { payloadReads++; return payload; },
  },
  "../stores/contest-list": listStoreModule,
}).default;
let listInstance;
listComponent.render = function () { listInstance = vue.getCurrentInstance(); return vue.h("list"); };
function detach(node) {
  if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
  node.parent = null;
}
const renderer = vue.createRenderer({
  createElement: (tag) => ({ tag, children: [] }),
  createText: (text) => ({ text }), createComment: (text) => ({ text }),
  insert: (node, parent, anchor) => {
    detach(node);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
    node.parent = parent;
  },
  remove: detach, setText: (node, text) => { node.text = text; },
  setElementText: (node, text) => { node.text = text; },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp: () => {},
});
const showList = vue.ref(true);
const otherComponent = { name: "OtherView", render: () => vue.h("other") };
const app = renderer.createApp({ render: () => vue.h(vue.KeepAlive, { include: "ContestListView" }, { default: () => vue.h(showList.value ? listComponent : otherComponent) }) });
app.use(createPinia());
app.mount({ children: [] });
const settle = async () => { for (let i = 0; i < 12; i++) await vue.nextTick(); };
await settle();
const state = listInstance.setupState;
assert.equal(state.hasLoaded, true);
assert.equal(memberReads, 1, "initial member selection must not restart the load");
assert.equal(state.coverageSummaryMap.get("c1").solvedProblemCount, 2);
state.contestListStore.selectedMemberIds = ["bob"];
await settle();
assert.equal(state.coverageSummaryMap.get("c1").solvedProblemCount, 1);
assert.equal(memberReads, 1, "member filters must reuse the input snapshot");
showList.value = false;
await settle();
showList.value = true;
await settle();
assert.equal(memberReads, 1, "a clean cached list must not reload on return");
assert.equal(listInstance.setupState, state);

showList.value = false;
await settle();
currentInput = coverage.buildMemberCoverageInput(records.members, records.memberHandles, [...records.memberProblemStatus, status("bob", "p4", "manual", "solved")]);
dataListener();
await settle();
assert.equal(memberReads, 1, "defer writes while the page is inactive");
showList.value = true;
await settle();
assert.equal(memberReads, 2);
assert.equal(state.coverageSummaryMap.get("c1").solvedProblemCount, 2);

failNextLoad = true;
dataListener();
await settle();
assert.match(state.error, /temporary read failure/);
assert.equal(state.contests.length, 3, "retain visible cards when a refresh fails");
assert.equal(memberReads, 3, "do not loop on failure");
await state.loadContests();
await settle();
assert.equal(state.error, "");
assert.equal(memberReads, 4);

let releaseRead;
blockNextRead = new Promise((resolve) => { releaseRead = resolve; });
dataListener();
dataListener();
assert.equal(memberReads, 5, "coalesce writes while a read is in progress");
releaseRead(currentInput);
await settle();
assert.equal(memberReads, 6, "a write during a read must refresh the snapshot again");
assert.equal(catalogReads, memberReads);
assert.equal(payloadReads, memberReads);
app.unmount();
assert.equal(dataListener, null);

const originalFetch = globalThis.fetch;
try {
  let requests = 0;
  globalThis.fetch = async () => {
    if (++requests === 1) throw new Error("offline");
    return { ok: true, json: async () => ({ contests: [] }) };
  };
  const catalog = loadModule("web/src/lib/catalog.ts");
  await assert.rejects(catalog.fetchCatalogContestIndex(), /offline/);
  assert.deepEqual(await catalog.fetchCatalogContestIndex(), { contests: [] });
  await catalog.fetchCatalogContestIndex();
  assert.equal(requests, 2, "failed requests retry; successful requests stay cached");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Coverage checks passed: status precedence, active providers, empty selection, shared problems, one read per table, cached navigation, filter reuse, invalidation, in-flight writes, retry.");
