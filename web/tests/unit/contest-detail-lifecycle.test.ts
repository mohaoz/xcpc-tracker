// Exercises the real ContestDetailView setup with deliberately late observable
// callbacks and async reads. Browser coverage separately verifies Dexie cross-tab delivery.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive } from "vue";

import { deferred, type Deferred } from "./helpers/async";

const env = vi.hoisted(() => ({
  route: null as any,
  memberInput: null as any,
  detailGate: null as null | { promise: Promise<unknown> },
  readGate: null as null | { promise: Promise<unknown> },
  readError: null as unknown,
  saveGate: null as null | { promise: Promise<unknown> },
  writes: [] as any[],
  readRevisions: [] as unknown[],
  fake: null as any,
  selection: null as any,
}));

const at = "2026-09-30T00:00:00.000Z";
const baseContest = {
  contestId: "test", title: "Test", aliases: [], tags: [], sources: [], problemIds: ["test:A"], startAt: null,
  curationStatus: "reviewed", notes: null, generatedFrom: null,
};
const problems = [{ problemId: "test:A", contestId: "test", ordinal: "A", title: "A", aliases: [], sources: [] }];
const detail = (id: string) => ({ contest: { ...baseContest, contestId: id, title: id }, problems });
const displayedMember = { memberId: "alice", identityRevision: "displayed-revision", displayName: "Alice", handles: [] };

vi.mock("dexie", async () => {
  const { createFakeLiveQuery } = await import("./helpers/live-query");
  env.fake = createFakeLiveQuery();
  return { liveQuery: env.fake.liveQuery };
});
vi.mock("vue-router", () => ({
  useRoute: () => env.route,
  useRouter: () => ({ push: async () => {}, replace: async () => {} }),
  RouterLink: { props: ["to"], render(this: any) { return h("a", this.$slots.default?.()); } },
}));
vi.mock("../../src/stores/contest-list", () => ({ useContestListStore: () => env.selection }));
vi.mock("../../src/components/MemberPicker.vue", () => ({ default: { render: () => null } }));
vi.mock("../../src/stores/settings", () => ({ useSettingsStore: () => ({ allowMedalEstimates: true }) }));
vi.mock("../../src/stores/spoilers", () => ({ useSpoilerStore: () => ({ visible: () => false }) }));
vi.mock("../../src/lib/member-events", () => ({ emitMemberMutated() {} }));
vi.mock("../../src/lib/catalog-events", () => ({ emitCatalogMutated() {} }));
vi.mock("../../src/lib/local-db", () => ({
  replaceManualCatalogContest: async () => env.saveGate?.promise,
  readMemberCoverageInputFromDb: async () => env.memberInput,
  getManualMemberProblemStatusFromDb: async (_id: string, _problem: string, revision: unknown) => {
    env.readRevisions.push(revision);
    if (env.readError) throw env.readError;
    return env.readGate ? env.readGate.promise : null;
  },
  upsertManualMemberProblemStatus: async (payload: unknown) => { env.writes.push(payload); },
}));
vi.mock("../../src/lib/catalog-runtime", () => ({
  getRuntimeCatalogContestDetail: async (id: string) => (env.detailGate ? env.detailGate.promise : detail(id)),
  listRuntimeCatalogContests: async () => ({ contests: [baseContest] }),
}));

import ContestDetailView from "../../src/views/ContestDetailView.vue";

const settle = async () => {
  for (let i = 0; i < 16; i++) { await flushPromises(); await nextTick(); }
};

describe("ContestDetailView lifecycle", () => {
  it("uses the displayed identity, handles read errors and ignores late results across navigation and unmount", async () => {
    env.route = reactive({ name: "contest-detail", params: { contestId: "first", memberId: "alice" }, query: {} });
    // Detail derives coverage from member data plus the shared member selection.
    env.memberInput = { members: [displayedMember], statusByMember: new Map() };
    env.selection = reactive({
      selectedMemberIds: ["alice"], knownMemberIds: ["alice"], syncAvailableMembers() {}, applyMemberQuery() {}, memberQuery: () => undefined,
    });
    const { subscriptions } = env.fake;
    const wrapper = mount(defineComponent({ render: () => h(ContestDetailView) }), { global: { plugins: [createPinia()] } });
    const state = () => wrapper.findComponent(ContestDetailView).vm as unknown as Record<string, any>;
    await settle();

    let observation = subscriptions.at(-1);
    observation.observer.next(env.memberInput);
    expect(state().contest.id).toBe("first");

    // Displayed manual token.
    state().markMode = true;
    await state().applyMarkToCell("test:A", displayedMember, "unseen");
    expect(env.readRevisions).toStrictEqual(["displayed-revision"]);
    expect(env.writes[0].memberIdentityRevision, "the write must use the rendered identity").toBe("displayed-revision");
    expect(state().markSavingCellKey).toBe("");

    // Read-error handling.
    env.readError = Object.assign(new Error("Member removed or replaced"), {
      name: "AbortError", inner: new DOMException("Member removed or replaced", "AbortError"),
    });
    await state().applyMarkToCell("test:A", displayedMember, "unseen");
    expect(state().error, "Dexie-wrapped AbortError should show the friendly identity-change message").toMatch(/成员已删除/);
    expect(state().markSavingCellKey, "read errors must clear busy state").toBe("");
    expect(env.writes).toHaveLength(1);

    // Pending mark navigation.
    env.readError = null;
    const readGate: Deferred<unknown> = deferred();
    env.readGate = readGate;
    const pendingMark = state().applyMarkToCell("test:A", displayedMember, "unseen");
    env.route.params.contestId = "second";
    await settle();
    expect(observation.closed, "route changes unsubscribe old coverage").toBe(true);
    readGate.resolve(null);
    await pendingMark;
    expect(env.writes, "navigation while reading a cell cancels its pending write").toHaveLength(1);
    env.readGate = null;
    observation.observer.next(env.memberInput);
    expect(state().coverage, "old coverage cannot flash into the next route").toBeNull();
    observation = subscriptions.at(-1);
    observation.observer.next(env.memberInput);
    expect(state().contest.id).toBe("second");

    // Late catalog reads.
    const slow = deferred();
    env.detailGate = slow;
    env.route.params.contestId = "slow";
    await settle();
    env.detailGate = null;
    env.route.params.contestId = "third";
    await settle();
    const currentObservation = subscriptions.at(-1);
    currentObservation.observer.next(env.memberInput);
    const subscriptionCount = subscriptions.length;
    slow.resolve(detail("slow"));
    await settle();
    expect(subscriptions, "late catalog reads must not resubscribe the old route").toHaveLength(subscriptionCount);
    expect(state().contest.id).toBe("third");

    // Unmount cleanup with a pending metadata save.
    const saveGate = deferred();
    env.saveGate = saveGate;
    const vm = state();
    const pendingSave = vm.saveContestMetadata({ title: "Edited third", aliases: [], tags: [], sources: [], notes: null });
    expect(vm.saving).toBe(true);
    wrapper.unmount();
    saveGate.resolve(undefined);
    await pendingSave;
    expect(subscriptions, "late metadata save must not restart observation after unmount").toHaveLength(subscriptionCount);
    expect(currentObservation.closed).toBe(true);
    currentObservation.observer.error(new Error("late error"));
    currentObservation.observer.next(env.memberInput);
    expect(vm.contest.id, "unmounted detail ignores late results").toBe("third");
    // Every manual-status read used the rendered identity revision.
    expect(env.readRevisions).toStrictEqual(Array(3).fill("displayed-revision"));
  });
});
