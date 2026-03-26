import type { CatalogSource } from "./catalog";

export type LocalCatalogContestRecord = {
  contestId: string;
  title: string;
  aliases: string[];
  tags: string[];
  startAt: string | null;
  curationStatus: "contest_stub" | "problem_listed" | "reviewed";
  problemIds: string[];
  sources: CatalogSource[];
  notes: string | null;
  generatedFrom: string | null;
  deletedAt?: string | null;
};

export type LocalCatalogProblemRecord = {
  problemId: string;
  contestId: string;
  ordinal: string;
  title: string;
  aliases: string[];
  sources: CatalogSource[];
  sourceKind?: "catalog" | "runtime_codeforces";
};

export type LocalMemberRecord = {
  memberId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type LocalMemberHandleRecord = {
  handleId: string;
  memberId: string;
  provider: string;
  handle: string;
  displayLabel: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocalMemberProblemStatusRecord = {
  statusId: string;
  memberId: string;
  problemId: string;
  provider: string;
  status: "solved" | "attempted";
  firstSeenAt: string;
  lastSeenAt: string;
  sourceRecordId: string;
  matchMethod: "provider_id" | "contest_ordinal" | "alias" | "manual";
};

export type LocalImportSourceRecord = {
  sourceRecordId: string;
  kind: "catalog" | "codeforces_api" | "qoj_userscript_json";
  label: string;
  importedAt: string;
  rawMetaJson: Record<string, unknown>;
};

export type LocalSyncRecord = {
  syncId: string;
  sourceRecordId: string;
  adapter: "catalog" | "codeforces_api" | "qoj_userscript";
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed";
  summaryJson: Record<string, unknown>;
};

export type LocalProblemMatchCacheRecord = {
  cacheKey: string;
  provider: string;
  externalRef: string;
  contestId: string | null;
  problemId: string | null;
  matchMethod: "provider_id" | "contest_ordinal" | "alias" | "manual";
  updatedAt: string;
};

export type LocalDbStatus = {
  contestCount: number;
  syncedContestCount: number;
  problemCount: number;
  memberCount: number;
  handleCount: number;
  statusCount: number;
  lastCatalogImportAt: string | null;
};

export type LocalRuntimeSnapshot = {
  schemaVersion: 1;
  exportKind: "local_runtime_snapshot";
  exportedAt: string;
  members: LocalMemberRecord[];
  memberHandles: LocalMemberHandleRecord[];
  memberProblemStatus: LocalMemberProblemStatusRecord[];
  importSources: LocalImportSourceRecord[];
  syncRecords: LocalSyncRecord[];
};

export type LocalCatalogSnapshot = {
  schemaVersion: 1;
  exportKind: "local_catalog_snapshot";
  exportedAt: string;
  contests: LocalCatalogContestRecord[];
  problems: LocalCatalogProblemRecord[];
};

export type LocalMemberPerson = {
  memberId: string;
  displayName: string;
  providerCount: number;
  handleCount: number;
  totalProblemCount: number;
  solvedCount: number;
  attemptedCount: number;
  lastSyncedAt: string | null;
  handles: Array<{
    handleId: string;
    provider: string;
    handle: string;
    displayLabel: string | null;
    updatedAt: string;
  }>;
};

export type LocalCoverageProblemMember = {
  memberId: string;
  displayName: string;
  status: "solved" | "attempted" | "unseen";
};

export type LocalContestCoverage = {
  contest: LocalCatalogContestRecord;
  trackedMembers: LocalMemberPerson[];
  problemCount: number;
  freshProblemCount: number;
  problems: Array<{
    problemId: string;
    ordinal: string;
    title: string;
    freshForTeam: boolean;
    members: LocalCoverageProblemMember[];
  }>;
};

export type LocalContestCoverageSummary = {
  contestId: string;
  problemCount: number;
  freshProblemCount: number;
  solvedProblemCount: number;
  attemptedProblemCount: number;
  problemStates: Array<{
    ordinal: string;
    status: "solved" | "attempted" | "unseen";
  }>;
};
