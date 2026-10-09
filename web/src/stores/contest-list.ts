import { defineStore } from "pinia";

export const contestListModes = ["ALL", "UNSEEN", "DONE"] as const;
export type ContestListMode = typeof contestListModes[number];

export function isContestListMode(value: unknown): value is ContestListMode {
  return typeof value === "string" && (contestListModes as readonly string[]).includes(value);
}

export const useContestListStore = defineStore("contest-list", {
  state: () => ({
    query: "",
    selectedMode: "ALL" as ContestListMode,
    // Shared by the contest list and contest detail; coverage, "未做",
    // placement and spoiler defaults all follow this selection.
    selectedMemberIds: [] as string[],
    memberSelectionInitialized: false,
    // True while the selection means "every active member", so members added
    // later (or recreated after the pool was empty) are selected automatically.
    followAllMembers: true,
    // Active member IDs as of the last reconcile.
    knownMemberIds: [] as string[],
    // A `members` URL value read before members finished loading.
    pendingMemberQuery: null as string[] | null,
  }),
  actions: {
    coversAll(ids: string[]) {
      return this.knownMemberIds.length > 0 && this.knownMemberIds.every((id) => ids.includes(id));
    },
    /** Reconcile the selection with the current active members. */
    syncAvailableMembers(availableIds: string[]) {
      const available = new Set(availableIds);
      // Trust the actual selection over the flag: a selection that no longer
      // covers every previously known member is a deliberate subset.
      if (this.followAllMembers && this.knownMemberIds.length && !this.coversAll(this.selectedMemberIds)) {
        this.followAllMembers = false;
      }
      this.knownMemberIds = [...availableIds];
      if (this.pendingMemberQuery) {
        this.selectedMemberIds = this.pendingMemberQuery.filter((id) => available.has(id));
        this.followAllMembers = this.coversAll(this.selectedMemberIds);
        this.pendingMemberQuery = null;
        this.memberSelectionInitialized = true;
        return;
      }
      if (!this.memberSelectionInitialized && !availableIds.length) return;
      this.memberSelectionInitialized = true;
      this.selectedMemberIds = this.followAllMembers
        ? [...availableIds]
        : this.selectedMemberIds.filter((id) => available.has(id));
    },
    /** Apply a `members` URL value; resolved against members on the next sync. */
    applyMemberQuery(value: unknown) {
      if (typeof value !== "string" || !value) return;
      const ids = value.split(",").filter(Boolean);
      if (!this.knownMemberIds.length) {
        this.pendingMemberQuery = ids;
        return;
      }
      const known = new Set(this.knownMemberIds);
      this.selectedMemberIds = ids.filter((id) => known.has(id));
      this.followAllMembers = this.coversAll(this.selectedMemberIds);
      this.memberSelectionInitialized = true;
    },
    /** URL value for the current selection; omitted when everyone is selected. */
    memberQuery(): string | undefined {
      return this.followAllMembers || !this.selectedMemberIds.length ? undefined : this.selectedMemberIds.join(",");
    },
    /** Select exactly these members, e.g. from a member's "查看 TA 的比赛" link. */
    selectOnly(memberIds: string[]) {
      this.selectedMemberIds = [...memberIds];
      this.memberSelectionInitialized = true;
      this.followAllMembers = this.coversAll(this.selectedMemberIds);
    },
    toggleMember(memberId: string) {
      this.selectedMemberIds = this.selectedMemberIds.includes(memberId)
        ? this.selectedMemberIds.filter((id) => id !== memberId)
        : [...this.selectedMemberIds, memberId];
      this.followAllMembers = this.coversAll(this.selectedMemberIds);
    },
    toggleAllMembers() {
      this.followAllMembers = !this.followAllMembers;
      this.selectedMemberIds = this.followAllMembers ? [...this.knownMemberIds] : [];
    },
  },
});
