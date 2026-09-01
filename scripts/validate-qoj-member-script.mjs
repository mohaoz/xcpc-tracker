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
assert(batchScript.includes("QOJ 批量 JSON"), "Generated QOJ batch script must log the final JSON");
assert(batchScript.includes("alert(summary"), "Generated QOJ batch script must alert on completion");
assert(!batchScript.includes("xcpc-tracker-qoj-progress"), "Generated QOJ batch script must stay console-only");
for (const member of fixture.members) {
  assert(batchScript.includes(JSON.stringify(member.handle)), `Generated script is missing ${member.handle}`);
}

const singleScript = buildQojBrowserScript({ memberId: "single", handle: "single_qoj" });
new Function(singleScript);

function createProblemLink(problemId) {
  return {
    getAttribute(attributeName) {
      return attributeName === "href" ? `/problem/${problemId}` : null;
    },
  };
}

function createProblemContent(problemIds, nextElementSibling = null) {
  return {
    nextElementSibling,
    matches() {
      return false;
    },
    querySelectorAll() {
      return problemIds.map(createProblemLink);
    },
  };
}

function createProblemHeading(textContent) {
  return {
    textContent,
    nextElementSibling: null,
    matches(selector) {
      return selector === ".list-group-item-heading";
    },
  };
}

async function runFetchedProfileRegression({
  acceptedHeadingText,
  attemptedHeadingText,
  solvedProblemId,
  attemptedProblemId,
}) {
  const acceptedHeading = createProblemHeading(acceptedHeadingText);
  const attemptedHeading = createProblemHeading(attemptedHeadingText);
  const attemptedContent = createProblemContent([attemptedProblemId]);
  const acceptedContent = createProblemContent([solvedProblemId], attemptedHeading);
  acceptedHeading.nextElementSibling = acceptedContent;
  attemptedHeading.nextElementSibling = attemptedContent;

  const signedInUserLink = {
    getAttribute(attributeName) {
      return attributeName === "href" ? "/user/profile/Qingyu" : null;
    },
  };
  const fetchedDocument = {
    querySelector(selector) {
      if (selector === ".card-body h2") {
        return { textContent: "target_qoj" };
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".list-group-item-heading") {
        return [acceptedHeading, attemptedHeading];
      }
      if (selector.includes("uoj-username")) {
        return [signedInUserLink];
      }
      return [];
    },
  };

  const globalNames = ["copy", "DOMParser", "fetch", "location", "navigator", "window", "alert"];
  const originalDescriptors = new Map(
    globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const setGlobal = (name, value) => {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
  };

  let copiedText = "";
  let resolveCopiedText;
  const copiedTextPromise = new Promise((resolve) => {
    resolveCopiedText = resolve;
  });
  let clipboardWriteCount = 0;
  let timeoutId;

  try {
    setGlobal("location", { hostname: "qoj.ac", origin: "https://qoj.ac" });
    setGlobal("window", {});
    setGlobal("alert", () => {});
    setGlobal("navigator", {
      clipboard: {
        async writeText() {
          clipboardWriteCount += 1;
          throw new Error("Document is not focused");
        },
      },
    });
    setGlobal("DOMParser", class {
      parseFromString() {
        return fetchedDocument;
      }
    });
    setGlobal("copy", (text) => {
      copiedText = text;
      resolveCopiedText(text);
    });
    setGlobal("fetch", async () => {
      delete globalThis.copy;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        url: "https://qoj.ac/user/profile/target_qoj",
        async text() {
          return "<html></html>";
        },
      };
    });

    const runtimeScript = buildQojBatchBrowserScript({
      members: [{ memberId: "target", displayName: "Target", handle: "target_qoj" }],
    });
    new Function(runtimeScript)();
    await Promise.race([
      copiedTextPromise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Generated QOJ script did not copy its result")), 1000);
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    clearTimeout(timeoutId);
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  }

  const payload = JSON.parse(copiedText);
  assert(payload.members.length === 1, "Fetched profile regression must import the target member");
  assert(payload.fetch_failures.length === 0, "Signed-in navbar user must not create a handle mismatch");
  assert(payload.members[0].handle === "target_qoj", "Response URL must identify the requested handle");
  assert(
    payload.members[0].solved.join(",") === solvedProblemId,
    `Accepted problem extraction regressed for heading: ${acceptedHeadingText}`,
  );
  assert(
    payload.members[0].attempted.join(",") === attemptedProblemId,
    `Attempted problem extraction regressed for heading: ${attemptedHeadingText}`,
  );
  assert(clipboardWriteCount === 0, "Captured DevTools copy must run before the unfocused Clipboard API fallback");
}

await runFetchedProfileRegression({
  acceptedHeadingText: "AC 过的题目：共 1 道题",
  attemptedHeadingText: "尝试过的题目：共 1 道题",
  solvedProblemId: "15431",
  attemptedProblemId: "14549",
});
await runFetchedProfileRegression({
  acceptedHeadingText: "已解题目列表",
  attemptedHeadingText: "做过题目列表",
  solvedProblemId: "1001",
  attemptedProblemId: "1002",
});

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
  signedInNavbarIsolation: "valid",
  asyncDevtoolsCopy: "valid",
  localizedStatusSections: "valid",
  positionalStatusFallback: "valid",
  duplicateHandleGuard: "valid",
}, null, 2));
