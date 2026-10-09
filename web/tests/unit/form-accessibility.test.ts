// Offline component checks. These do not replace browser keyboard/screen-reader QA.
import { readFileSync } from "node:fs";

import { baseParse, type ElementNode, type RootNode, type TemplateChildNode } from "@vue/compiler-dom";
import { parse } from "@vue/compiler-sfc";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { h, reactive } from "vue";

import { repoPath } from "./helpers/repo";

const env = vi.hoisted(() => ({
  qojSync: null as any,
  cfImports: 0,
  qojLinks: 0,
  releaseImport: null as null | (() => void),
}));

vi.mock("../../src/lib/catalog-sources", () => ({ aggregateAliasesFromSources: (_title: string, aliases: string[]) => aliases }));
vi.mock("vue-router", () => ({ useRouter: () => ({ replace: async () => {} }), useRoute: () => ({ query: {} }) }));
vi.mock("../../src/lib/codeforces", () => ({
  importCodeforcesMember: async () => { env.cfImports++; await new Promise<void>((resolve) => { env.releaseImport = resolve; }); },
}));
vi.mock("../../src/lib/member-events", () => ({ emitMemberMutated: () => {} }));
vi.mock("../../src/lib/qoj", () => ({ linkQojMember: async () => { env.qojLinks++; } }));
vi.mock("../../src/stores/qoj-sync", () => ({ useQojSyncStore: () => env.qojSync }));

import ContestCatalogEditor from "../../src/components/ContestCatalogEditor.vue";
import AddMemberView from "../../src/views/AddMemberView.vue";

const initialValue = {
  title: "Accessible fixture", aliases: [], tags: [], notes: null,
  sources: [
    { provider: "qoj", kind: "contest", url: "https://qoj.ac/contest/1" },
    { provider: "codeforces", kind: "contest", url: "https://codeforces.com/gym/100000" },
    { provider: "manual", kind: "contest" },
  ],
  problems: [{ ordinal: "A", title: "Example", aliases: [], sources: [] }],
};

describe("ContestCatalogEditor labels", () => {
  it("labels every rendered control exactly once with unique IDs across instances and sources", () => {
    const wrapper = mount({ render: () => h("main", [h(ContestCatalogEditor, { initialValue }), h(ContestCatalogEditor, { initialValue })]) });
    const root = wrapper.element as HTMLElement;
    const ids = [...root.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size, "editor instances and repeated sources need unique IDs").toBe(ids.length);
    const controls = [...root.querySelectorAll("input, select, textarea")];
    expect(controls.length, "fixture must exercise repeated source controls and two editors").toBeGreaterThan(30);
    const labels = [...root.querySelectorAll("label[for]")];
    for (const control of controls) {
      const id = control.getAttribute("id");
      expect(id, `${control.tagName.toLowerCase()} must have an ID`).toBeTruthy();
      expect(labels.filter((label) => label.getAttribute("for") === id), `${id} needs exactly one associated label`).toHaveLength(1);
    }
    const groups = [...root.querySelectorAll('[role="group"]')].filter((node) => /^Contest source \d+$/.test(node.getAttribute("aria-label") ?? ""));
    expect(groups).toHaveLength(6);
    wrapper.unmount();
  });
});

function elements(node: RootNode | TemplateChildNode, result: ElementNode[] = []): ElementNode[] {
  if (node.type === 1) result.push(node as ElementNode);
  for (const child of ("children" in node ? (node.children as TemplateChildNode[]) : []) ?? []) {
    if (typeof child === "object") elements(child, result);
  }
  return result;
}
const attribute = (node: ElementNode, name: string) =>
  node.props.find((prop: any) => prop.type === 6 && prop.name === name)?.["value" as never]?.["content" as never] as string | undefined;

describe("Add Member form", () => {
  it("routes native submit through the existing handler without double wiring", () => {
    const filename = repoPath("web/src/views/AddMemberView.vue");
    const { descriptor } = parse(readFileSync(filename, "utf8"), { filename });
    const templateNodes = elements(baseParse(descriptor.template!.content));
    const form = templateNodes.find((node) => node.tag === "form");
    expect(form, "Add Member must render a native form").toBeTruthy();
    expect(form!.props.some((prop: any) => prop.type === 7 && prop.name === "on" && prop.arg?.content === "submit"
      && prop.exp?.content === "handleSubmit" && prop.modifiers.some((modifier: any) => (modifier.content ?? modifier) === "prevent")),
    "form must route native submit through the existing handler without navigating").toBe(true);
    const submitButton = elements(form!).find((node) => node.tag === "button" && attribute(node, "type") === "submit");
    expect(submitButton, "the action must be a native submit button").toBeTruthy();
    expect(submitButton!.props.some((prop: any) => prop.type === 7 && prop.name === "on" && prop.arg?.content === "click"),
      "click and native submit must not both call the handler").toBe(false);
  });

  it("guards empty, repeated, loading and busy submits", async () => {
    env.qojSync = reactive({ modeLoaded: true, busy: false, useUserscript: false, sync: async () => {} });
    const wrapper = mount(AddMemberView);
    const state = wrapper.vm as unknown as Record<string, any>;

    await state.handleSubmit();
    expect(env.cfImports, "empty fields must not import").toBe(0);
    state.memberForm = { memberId: "Test member", platform: "codeforces", handle: "test" };
    const first = state.handleSubmit();
    expect(env.cfImports).toBe(1);
    await state.handleSubmit();
    expect(env.cfImports, "repeat submit during an in-flight import must be ignored").toBe(1);
    env.releaseImport!();
    await first;
    expect(state.submitting).toBe(false);

    state.memberForm.platform = "qoj";
    env.qojSync.modeLoaded = false;
    await state.handleSubmit();
    expect(env.qojLinks, "keyboard submit must respect loading state").toBe(0);
    env.qojSync.modeLoaded = true;
    env.qojSync.busy = true;
    await state.handleSubmit();
    expect(env.qojLinks, "keyboard submit must respect synchronization state").toBe(0);
    env.qojSync.busy = false;
    await state.handleSubmit();
    expect(env.qojLinks, "ready QOJ form must submit").toBe(1);
    wrapper.unmount();
  });
});
