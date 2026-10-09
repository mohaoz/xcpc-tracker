import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { buildQojBatchBrowserScript, buildQojBrowserScript } from "../../web/src/lib/qoj-member-script";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const generatorPath = path.join(repoRoot, "web/src/lib/qoj-member-script.ts");
const fixturePath = path.join(repoRoot, "fixtures/imports/qoj/qoj-members-batch.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

describe("QOJ member script generator", () => {
  it("transpiles without errors", () => {
    const compiled = ts.transpileModule(fs.readFileSync(generatorPath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: generatorPath,
      reportDiagnostics: true,
    });
    expect(
      (compiled.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error),
      "QOJ member script generator failed to transpile",
    ).toBe(false);
  });
});

describe("QOJ batch fixture", () => {
  it("has the v2 batch envelope with multiple members and a fetch failure", () => {
    expect(fixture.provider, "QOJ batch fixture must use provider=qoj").toBe("qoj");
    expect(typeof fixture.exported_at, "QOJ batch fixture must include exported_at").toBe("string");
    expect(fixture.script_version, "QOJ batch fixture must use script_version=2").toBe(2);
    expect(Array.isArray(fixture.members) && fixture.members.length > 1, "QOJ batch fixture must include multiple members").toBe(true);
    expect(Array.isArray(fixture.fetch_failures) && fixture.fetch_failures.length > 0, "QOJ batch fixture must include a fetch failure").toBe(true);
  });

  it("members and failures carry identity and evidence", () => {
    for (const member of fixture.members) {
      expect(typeof member.member_id === "string" && member.member_id, "QOJ fixture member needs member_id").toBeTruthy();
      expect(typeof member.handle === "string" && member.handle, "QOJ fixture member needs handle").toBeTruthy();
      expect(Array.isArray(member.solved), "QOJ fixture member solved must be an array").toBe(true);
      expect(Array.isArray(member.attempted), "QOJ fixture member attempted must be an array").toBe(true);
    }
    for (const failure of fixture.fetch_failures) {
      expect(typeof failure.handle === "string" && failure.handle, "QOJ fixture failure needs handle").toBeTruthy();
      expect(typeof failure.error === "string" && failure.error, "QOJ fixture failure needs error evidence").toBeTruthy();
    }
  });
});

describe("generated QOJ scripts", () => {
  it("batch script is valid, versioned, console-only and includes every handle", () => {
    const batchScript = buildQojBatchBrowserScript({
      members: fixture.members.map((member: any) => ({
        memberId: member.member_id,
        displayName: member.display_name,
        handle: member.handle,
      })),
    });
    expect(() => new Function(batchScript)).not.toThrow();
    expect(batchScript, "Generated QOJ batch script must export version 2").toContain("script_version: 2");
    expect(batchScript, "Generated QOJ batch script must export fetch failures").toContain("fetch_failures");
    expect(batchScript, "Generated QOJ batch script must log the final JSON").toContain("QOJ 批量 JSON");
    expect(batchScript, "Generated QOJ batch script must alert on completion").toContain("alert(summary");
    expect(batchScript, "Generated QOJ batch script must stay console-only").not.toContain("xcpc-tracker-qoj-progress");
    for (const member of fixture.members) {
      expect(batchScript, `Generated script is missing ${member.handle}`).toContain(JSON.stringify(member.handle));
    }
  });

  it("single-member script is syntactically valid", () => {
    const singleScript = buildQojBrowserScript({ memberId: "single", handle: "single_qoj" });
    expect(() => new Function(singleScript)).not.toThrow();
  });

  it("rejects one handle linked to multiple members", () => {
    expect(() => buildQojBatchBrowserScript({
      members: [
        { memberId: "first", handle: "Duplicate_QOJ" },
        { memberId: "second", handle: "duplicate_qoj" },
      ],
    }), "QOJ batch generator must reject one handle linked to multiple members").toThrow();
  });
});

function createProblemLink(problemId: string) {
  return { getAttribute: (attributeName: string) => (attributeName === "href" ? `/problem/${problemId}` : null) };
}
function createProblemContent(problemIds: string[], nextElementSibling: unknown = null) {
  return { nextElementSibling, matches: () => false, querySelectorAll: () => problemIds.map(createProblemLink) };
}
function createProblemHeading(textContent: string) {
  return { textContent, nextElementSibling: null as unknown, matches: (selector: string) => selector === ".list-group-item-heading" };
}

async function runFetchedProfile({ acceptedHeadingText, attemptedHeadingText, solvedProblemId, attemptedProblemId }: {
  acceptedHeadingText: string; attemptedHeadingText: string; solvedProblemId: string; attemptedProblemId: string;
}) {
  const acceptedHeading = createProblemHeading(acceptedHeadingText);
  const attemptedHeading = createProblemHeading(attemptedHeadingText);
  const attemptedContent = createProblemContent([attemptedProblemId]);
  const acceptedContent = createProblemContent([solvedProblemId], attemptedHeading);
  acceptedHeading.nextElementSibling = acceptedContent;
  attemptedHeading.nextElementSibling = attemptedContent;

  const signedInUserLink = {
    getAttribute: (attributeName: string) => (attributeName === "href" ? "/user/profile/Qingyu" : null),
  };
  const fetchedDocument = {
    querySelector: (selector: string) => (selector === ".card-body h2" ? { textContent: "target_qoj" } : null),
    querySelectorAll(selector: string) {
      if (selector === ".list-group-item-heading") return [acceptedHeading, attemptedHeading];
      if (selector.includes("uoj-username")) return [signedInUserLink];
      return [];
    },
  };

  const g = globalThis as any;
  const globalNames = ["copy", "DOMParser", "fetch", "location", "navigator", "window", "alert"];
  const originalDescriptors = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const setGlobal = (name: string, value: unknown) => {
    Object.defineProperty(globalThis, name, { configurable: true, enumerable: true, writable: true, value });
  };

  let copiedText = "";
  let resolveCopiedText!: (text: string) => void;
  const copiedTextPromise = new Promise<string>((resolve) => { resolveCopiedText = resolve; });
  let clipboardWriteCount = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const quiet = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
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
    setGlobal("DOMParser", class { parseFromString() { return fetchedDocument; } });
    setGlobal("copy", (text: string) => { copiedText = text; resolveCopiedText(text); });
    setGlobal("fetch", async () => {
      delete g.copy;
      return {
        ok: true, status: 200, statusText: "OK",
        url: "https://qoj.ac/user/profile/target_qoj",
        async text() { return "<html></html>"; },
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
    for (const spy of quiet) spy.mockRestore();
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete g[name];
    }
  }
  return { payload: JSON.parse(copiedText), clipboardWriteCount };
}

describe("generated QOJ batch script against a fetched profile", () => {
  it.each([
    { label: "localized status sections", acceptedHeadingText: "AC 过的题目：共 1 道题", attemptedHeadingText: "尝试过的题目：共 1 道题", solvedProblemId: "15431", attemptedProblemId: "14549" },
    { label: "positional status fallback", acceptedHeadingText: "已解题目列表", attemptedHeadingText: "做过题目列表", solvedProblemId: "1001", attemptedProblemId: "1002" },
  ])("$label: isolates the signed-in navbar user and uses captured DevTools copy", async ({ label: _label, ...options }) => {
    const { payload, clipboardWriteCount } = await runFetchedProfile(options);
    expect(payload.members, "Fetched profile regression must import the target member").toHaveLength(1);
    expect(payload.fetch_failures, "Signed-in navbar user must not create a handle mismatch").toHaveLength(0);
    expect(payload.members[0].handle, "Response URL must identify the requested handle").toBe("target_qoj");
    expect(payload.members[0].solved.join(","), `Accepted problem extraction regressed for heading: ${options.acceptedHeadingText}`).toBe(options.solvedProblemId);
    expect(payload.members[0].attempted.join(","), `Attempted problem extraction regressed for heading: ${options.attemptedHeadingText}`).toBe(options.attemptedProblemId);
    expect(clipboardWriteCount, "Captured DevTools copy must run before the unfocused Clipboard API fallback").toBe(0);
  });
});
