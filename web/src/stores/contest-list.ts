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
    page: 1,
    selectedMemberIds: [] as string[],
    memberSelectionInitialized: false,
  }),
});
