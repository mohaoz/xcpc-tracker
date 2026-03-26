import { defineStore } from "pinia";

export type ContestListMode = "all" | "fresh-only" | "non-fresh-only";

export const useContestListStore = defineStore("contest-list", {
  state: () => ({
    query: "",
    mode: "all" as ContestListMode,
    page: 1,
    selectedMemberIds: [] as string[],
    memberSelectionInitialized: false,
  }),
});
