import { defineStore } from "pinia";

export const contestListModes = ["UNSEEN", "NONE-MEDAL-DATA", "FE", "CU", "AG", "AU"] as const;
export type ContestListMode = typeof contestListModes[number];

export const useContestListStore = defineStore("contest-list", {
  state: () => ({
    query: "",
    selectedModes: [...contestListModes] as ContestListMode[],
    page: 1,
    selectedMemberIds: [] as string[],
    memberSelectionInitialized: false,
  }),
});
