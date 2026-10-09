import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

import { buildMemberCoverageInput, type MemberCoverageInput } from "../../src/lib/local-coverage";
import { coveragePayload, coverageRecords, status } from "./fixtures/coverage";

const data = vi.hoisted(() => ({
  memberReads: 0,
  catalogReads: 0,
  payloadReads: 0,
  failNextLoad: false,
  blockNextRead: null as Promise<unknown> | null,
  currentInput: null as unknown,
  listener: null as (() => void) | null,
}));

vi.mock("../../src/lib/local-db", () => ({
  readMemberCoverageInputFromDb: async () => {
    data.memberReads++;
    if (data.failNextLoad) {
      data.failNextLoad = false;
      throw new Error("temporary read failure");
    }
    if (data.blockNextRead) {
      const gate = data.blockNextRead;
      data.blockNextRead = null;
      return gate;
    }
    return data.currentInput;
  },
  subscribeCoverageDataMutated: (listener: () => void) => {
    data.listener = listener;
    return () => { data.listener = null; };
  },
}));

vi.mock("../../src/lib/catalog-runtime", async () => {
  const { coveragePayload } = await import("./fixtures/coverage");
  return {
    listRuntimeCatalogContests: async () => {
      data.catalogReads++;
      return { generatedAt: "2026-01-01", contests: coveragePayload().map(({ contest, problems }) => ({ ...contest, problemCount: problems.length })) };
    },
    listRuntimeContestCoveragePayload: async () => {
      data.payloadReads++;
      return coveragePayload();
    },
  };
});

vi.mock("../../src/stores/spoilers", () => ({
  useSpoilerStore: () => ({ loaded: true, saving: [], error: "", visible: (_id: string, touched: boolean) => touched, hasOverride: () => false, toggle: async () => {} }),
}));
vi.mock("../../src/stores/settings", () => ({ useSettingsStore: () => ({ allowMedalEstimates: false }) }));

import ContestListView from "../../src/views/ContestListView.vue";

const records = coverageRecords();
const input = (extra: ReturnType<typeof status>[] = []): MemberCoverageInput =>
  buildMemberCoverageInput(records.members, records.memberHandles, [...records.memberProblemStatus, ...extra]);

/** Lets chained async loads and the list's animation-frame URL sync settle. */
async function settle() {
  for (let i = 0; i < 6; i++) {
    await flushPromises();
    await nextTick();
  }
}

async function mountList() {
  const showList = ref(true);
  const Other = defineComponent({ name: "OtherView", render: () => h("div", "other") });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/contests", component: ContestListView }] });
  await router.push("/contests");
  const Host = defineComponent({
    render: () => h(KeepAlive, { include: "ContestListView" }, { default: () => h(showList.value ? ContestListView : Other) }),
  });
  const wrapper = mount(Host, { global: { plugins: [createPinia(), router] } });
  await settle();
  // Script-setup bindings are reachable through the component proxy in tests.
  const state = () => wrapper.findComponent(ContestListView).vm as unknown as Record<string, any>;
  return { wrapper, showList, state };
}

describe("ContestListView data lifecycle", () => {
  beforeEach(() => {
    Object.assign(data, { memberReads: 0, catalogReads: 0, payloadReads: 0, failNextLoad: false, blockNextRead: null, currentInput: input(), listener: null });
  });

  it("loads once and reuses the snapshot when the member filter changes", async () => {
    const { state } = await mountList();
    expect(state().hasLoaded).toBe(true);
    expect(data.memberReads).toBe(1);
    expect(state().getContestListMode("missing")).toBe("UNSEEN");
    expect(state().coverageSummaryMap.get("c1").solvedProblemCount).toBe(2);

    state().contestListStore.selectedMemberIds = ["bob"];
    await settle();
    expect(state().coverageSummaryMap.get("c1").solvedProblemCount).toBe(1);
    expect(data.memberReads).toBe(1);
  });

  it("keeps a clean cached list on return and defers writes while inactive", async () => {
    const { showList, state } = await mountList();
    const first = state();
    showList.value = false;
    await settle();
    showList.value = true;
    await settle();
    expect(data.memberReads).toBe(1);
    // test-utils wraps script-setup proxies per lookup, so compare the internal
    // instance id (diffing component proxies on failure would also be unbounded).
    expect(state().$.uid, "KeepAlive must reuse the same list instance").toBe(first.$.uid);

    showList.value = false;
    await settle();
    data.currentInput = input([status("bob", "p4", "manual", "solved")]);
    data.listener?.();
    await settle();
    expect(data.memberReads).toBe(1);
    showList.value = true;
    await settle();
    expect(data.memberReads).toBe(2);
    expect(state().coverageSummaryMap.get("c1").solvedProblemCount).toBe(3);
  });

  it("keeps visible cards when a refresh fails and does not retry in a loop", async () => {
    const { state } = await mountList();
    data.failNextLoad = true;
    data.listener?.();
    await settle();
    expect(state().error).toMatch(/temporary read failure/);
    expect(state().contests).toHaveLength(3);
    expect(data.memberReads).toBe(2);

    await state().loadContests();
    await settle();
    expect(state().error).toBe("");
    expect(data.memberReads).toBe(3);
  });

  it("coalesces writes during a read and refreshes once more afterwards", async () => {
    const { wrapper } = await mountList();
    let release!: (value: unknown) => void;
    data.blockNextRead = new Promise((resolve) => { release = resolve; });
    data.listener?.();
    data.listener?.();
    expect(data.memberReads).toBe(2);
    release(data.currentInput);
    await settle();
    expect(data.memberReads).toBe(3);
    expect(data.catalogReads).toBe(data.memberReads);
    expect(data.payloadReads).toBe(data.memberReads);

    wrapper.unmount();
    expect(data.listener).toBeNull();
  });
});
