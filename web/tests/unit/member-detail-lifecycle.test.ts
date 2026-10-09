// Exercises the real MemberDetailView setup with deliberately late observable results.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive } from "vue";

const env = vi.hoisted(() => ({ route: null as any, fake: null as any }));

vi.mock("dexie", async () => {
  const { createFakeLiveQuery } = await import("./helpers/live-query");
  env.fake = createFakeLiveQuery();
  return { liveQuery: env.fake.liveQuery };
});
vi.mock("vue-router", () => ({
  useRoute: () => env.route,
  useRouter: () => ({ push: async () => {} }),
  RouterLink: { props: ["to"], render(this: any) { return h("a", this.$slots.default?.()); } },
}));
vi.mock("../../src/lib/codeforces", () => ({ importCodeforcesMember: async () => {} }));
vi.mock("../../src/stores/qoj-sync", () => ({ useQojSyncStore: () => ({}) }));
vi.mock("../../src/lib/member-events", () => ({ emitMemberMutated() {} }));
vi.mock("../../src/lib/local-db", () => ({
  localDb: {}, getMemberPersonFromDb: async () => null, listMemberHandleProblemCountsFromDb: async () => ({}),
  softDeleteMember: async () => {}, softDeleteMemberHandle: async () => {},
}));

import MemberDetailView from "../../src/views/MemberDetailView.vue";

const settle = async () => {
  for (let i = 0; i < 16; i++) { await flushPromises(); await nextTick(); }
};

describe("MemberDetailView lifecycle", () => {
  it("drops old-route and post-unmount results and never keeps orphan handle counts", async () => {
    env.route = reactive({ name: "member-detail", params: { contestId: "third", memberId: "alice" }, query: {} });
    const { subscriptions } = env.fake;
    const wrapper = mount(defineComponent({ render: () => h(MemberDetailView) }), { global: { plugins: [createPinia()] } });
    const vm = wrapper.findComponent(MemberDetailView).vm as unknown as Record<string, any>;

    let observation = subscriptions.at(-1);
    observation.observer.next([{ memberId: "alice", displayName: "Alice", handles: [] }, { old: { solvedCount: 1 } }]);
    expect(vm.person.memberId).toBe("alice");

    env.route.params.memberId = "bob";
    await settle();
    expect(observation.closed).toBe(true);
    observation.observer.next([{ memberId: "alice" }, {}]);
    expect(vm.person).toBeNull();

    const memberObservation = subscriptions.at(-1);
    memberObservation.observer.next([{ memberId: "bob", handles: [] }, {}]);
    expect(vm.person.memberId).toBe("bob");
    memberObservation.observer.next([null, { orphan: { solvedCount: 5 } }]);
    expect(vm.person).toBeNull();
    expect(vm.handleProblemCounts, "deleted members must not keep orphan handle counts").toStrictEqual({});
    expect(vm.error).toBe("member not found");

    wrapper.unmount();
    expect(memberObservation.closed).toBe(true);
    memberObservation.observer.next([{ memberId: "late" }, {}]);
    expect(vm.person).toBeNull();
  });
});
