<script setup lang="ts">
import { onMounted, ref } from "vue";

import { syncAllCodeforcesContests, syncAllCodeforcesMembers } from "../lib/codeforces";
import { importBundledCatalogSnapshot, refreshCatalogCache } from "../lib/catalog-cache";
import { emitCatalogMutated } from "../lib/catalog-events";
import { emitMemberMutated } from "../lib/member-events";
import {
  applyLocalCatalogSnapshot,
  applyLocalRuntimeSnapshot,
  clearLocalContestData,
  clearLocalMemberData,
  exportLocalCatalogSnapshot,
  exportLocalRuntimeSnapshot,
  getCatalogDbStatus,
} from "../lib/local-db";
import type { LocalCatalogSnapshot, LocalDbStatus, LocalRuntimeSnapshot } from "../lib/local-model";

const submitting = ref(false);
const loadingStats = ref(false);
const error = ref("");
const feedback = ref("");
const importFileInput = ref<HTMLInputElement | null>(null);
const dbStatus = ref<LocalDbStatus | null>(null);
const syncProgress = ref<{
  totalContestCount: number;
  syncedContestCount: number;
  currentContestTitle: string;
} | null>(null);
const refreshingCatalog = ref(false);
const importingDefaultData = ref(false);
const syncingContests = ref(false);
let syncAbortController: AbortController | null = null;

const exportTarget = ref<"contest" | "member">("contest");
const exportIncludeProblems = ref(true);
const importTarget = ref<"contest" | "member">("contest");
const importMode = ref<"merge" | "replace">("merge");
const importIncludeProblems = ref(true);

function clearStatus() {
  error.value = "";
  feedback.value = "";
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "not imported yet";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

async function refreshStats() {
  loadingStats.value = true;
  try {
    dbStatus.value = await getCatalogDbStatus();
  } finally {
    loadingStats.value = false;
  }
}

async function handleRefreshCatalog() {
  submitting.value = true;
  refreshingCatalog.value = true;
  clearStatus();
  try {
    await refreshCatalogCache();
    await refreshStats();
    emitCatalogMutated();
    feedback.value = "catalog cache refreshed";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to refresh catalog cache";
  } finally {
    refreshingCatalog.value = false;
    submitting.value = false;
  }
}

async function handleImportDefaultData() {
  submitting.value = true;
  importingDefaultData.value = true;
  clearStatus();
  try {
    const payload = await importBundledCatalogSnapshot({
      mode: importMode.value,
      includeProblems: importIncludeProblems.value,
    });
    await refreshStats();
    emitCatalogMutated();
    feedback.value = `imported default catalog: ${payload.contests.length} contests, ${payload.problems.length} problems`;
    await maybeAutoSyncImportedContests(payload);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to import default catalog";
  } finally {
    importingDefaultData.value = false;
    submitting.value = false;
  }
}

async function handleOneClickSync() {
  submitting.value = true;
  syncingContests.value = true;
  syncAbortController = new AbortController();
  clearStatus();
  syncProgress.value = {
    totalContestCount: dbStatus.value?.contestCount ?? 0,
    syncedContestCount: dbStatus.value?.syncedContestCount ?? 0,
    currentContestTitle: "checking unsynced contests",
  };
  try {
    const result = await syncAllCodeforcesContests({
      signal: syncAbortController.signal,
      onProgress: ({ currentIndex, pendingContestCount, alreadySyncedCount, contestTitle }) => {
        syncProgress.value = {
          totalContestCount: dbStatus.value?.contestCount ?? (alreadySyncedCount + pendingContestCount),
          syncedContestCount: alreadySyncedCount + currentIndex - 1,
          currentContestTitle: contestTitle,
        };
      },
    });
    await refreshStats();
    syncProgress.value = {
      totalContestCount: dbStatus.value?.contestCount ?? result.totalContestCount,
      syncedContestCount: dbStatus.value?.syncedContestCount ?? result.syncedContestCount,
      currentContestTitle: result.cancelled ? "sync interrupted" : "sync finished",
    };
    feedback.value = result.cancelled
      ? `sync interrupted, now ${result.syncedContestCount}/${result.totalContestCount} ready`
      : `synced ${result.synced.length} new contests, now ${result.syncedContestCount}/${result.totalContestCount} ready`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to run full sync";
  } finally {
    syncAbortController = null;
    syncingContests.value = false;
    submitting.value = false;
  }
}

function handleInterruptSync() {
  syncAbortController?.abort();
}

async function handleDeleteLocalContests() {
  const confirmed = window.confirm("Delete all local contest data? This clears contests, problems, and contest-side cache.");
  if (!confirmed) {
    return;
  }
  submitting.value = true;
  clearStatus();
  try {
    await clearLocalContestData();
    await refreshStats();
    emitCatalogMutated();
    feedback.value = "local contest data deleted";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to delete local contest data";
  } finally {
    submitting.value = false;
  }
}

async function handleDeleteLocalMembers() {
  const confirmed = window.confirm("Delete all local member data? This clears members, handles, statuses, and sync metadata.");
  if (!confirmed) {
    return;
  }
  submitting.value = true;
  clearStatus();
  try {
    await clearLocalMemberData();
    await refreshStats();
    emitMemberMutated();
    feedback.value = "local member data deleted";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to delete local member data";
  } finally {
    submitting.value = false;
  }
}

async function handleExportData() {
  clearStatus();
  try {
    if (exportTarget.value === "contest") {
      const payload = await exportLocalCatalogSnapshot({
        includeProblems: exportIncludeProblems.value,
      });
      downloadJson("contest-export.min.json", payload);
      feedback.value = `exported ${payload.contests.length} contests`;
      return;
    }

    const payload = await exportLocalRuntimeSnapshot({
      includeProblemStatus: exportIncludeProblems.value,
    });
    downloadJson("member-export.min.json", payload);
    feedback.value = `exported ${payload.members.length} members`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to export data";
  }
}

function handleOpenImport() {
  importFileInput.value?.click();
}

async function maybeAutoSyncImportedContests(payload: LocalCatalogSnapshot) {
  const shouldPrompt = !importIncludeProblems.value || payload.problems.length === 0;
  if (!shouldPrompt) {
    return;
  }

  const confirmed = window.confirm("导入内容未包含题目，是否现在自动同步比赛题目？");
  if (!confirmed) {
    return;
  }

  syncProgress.value = {
    totalContestCount: dbStatus.value?.contestCount ?? payload.contests.length,
    syncedContestCount: dbStatus.value?.syncedContestCount ?? 0,
    currentContestTitle: "checking unsynced contests",
  };

  const result = await syncAllCodeforcesContests({
    onProgress: ({ currentIndex, pendingContestCount, alreadySyncedCount, contestTitle }) => {
      syncProgress.value = {
        totalContestCount: dbStatus.value?.contestCount ?? (alreadySyncedCount + pendingContestCount),
        syncedContestCount: alreadySyncedCount + currentIndex - 1,
        currentContestTitle: contestTitle,
      };
    },
  });

  await refreshStats();
  emitCatalogMutated();
  syncProgress.value = {
    totalContestCount: dbStatus.value?.contestCount ?? result.totalContestCount,
    syncedContestCount: dbStatus.value?.syncedContestCount ?? result.syncedContestCount,
    currentContestTitle: result.cancelled ? "sync interrupted" : "sync finished",
  };
  feedback.value = `imported contest data: ${payload.contests.length} contests, ${payload.problems.length} problems; auto-synced ${result.synced.length} contests`;
}

async function maybeAutoSyncImportedMembers(payload: LocalRuntimeSnapshot) {
  const shouldPrompt = !importIncludeProblems.value || payload.memberProblemStatus.length === 0;
  if (!shouldPrompt) {
    return;
  }

  const confirmed = window.confirm("导入内容未包含题目状态，是否现在自动同步成员题目状态？");
  if (!confirmed) {
    return;
  }

  const result = await syncAllCodeforcesMembers();
  emitMemberMutated();
  feedback.value = `imported member data: ${payload.members.length} members, ${payload.memberProblemStatus.length} statuses; auto-synced ${result.syncedMemberCount} members`;
}

async function handleImportData(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) {
    return;
  }

  submitting.value = true;
  clearStatus();
  try {
    const text = await file.text();

    if (importTarget.value === "contest") {
      const payload = JSON.parse(text) as LocalCatalogSnapshot;
      await applyLocalCatalogSnapshot(payload, {
        mode: importMode.value,
        includeProblems: importIncludeProblems.value,
      });
      feedback.value = `imported contest data: ${payload.contests.length} contests, ${payload.problems.length} problems`;
      emitCatalogMutated();
      await refreshStats();
      await maybeAutoSyncImportedContests(payload);
    } else {
      const payload = JSON.parse(text) as LocalRuntimeSnapshot;
      await applyLocalRuntimeSnapshot(payload, {
        mode: importMode.value,
        includeProblemStatus: importIncludeProblems.value,
      });
      feedback.value = `imported member data: ${payload.members.length} members, ${payload.memberProblemStatus.length} statuses`;
      emitMemberMutated();
      await refreshStats();
      await maybeAutoSyncImportedMembers(payload);
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to import data";
  } finally {
    submitting.value = false;
    if (importFileInput.value) {
      importFileInput.value.value = "";
    }
  }
}

onMounted(refreshStats);
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div class="stat-grid" style="margin-bottom: 20px">
          <div class="stat-card">
            <p class="stat-card__label">Catalog Contests</p>
            <div class="stat-card__value">{{ dbStatus?.syncedContestCount ?? 0 }}/{{ dbStatus?.contestCount ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">Catalog Problems</p>
            <div class="stat-card__value">{{ dbStatus?.problemCount ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">Members</p>
            <div class="stat-card__value">{{ dbStatus?.memberCount ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">Problem Status</p>
            <div class="stat-card__value">{{ dbStatus?.statusCount ?? 0 }}</div>
          </div>
        </div>

        <div class="list-grid">
          <section class="panel" style="box-shadow: none">
            <div class="panel__body">
              <div class="panel__title" style="margin-bottom: 14px">
                <p class="eyebrow">Operations</p>
                <h3>本地操作</h3>
              </div>
              <p class="muted">
                上次 catalog 更新：{{ formatDateTime(dbStatus?.lastCatalogImportAt ?? null) }}
              </p>
              <div v-if="syncProgress" class="notice" style="margin-top: 14px">
                <strong>{{ syncProgress.syncedContestCount }}/{{ syncProgress.totalContestCount }}</strong>
                <span style="margin-left: 8px">正在同步：{{ syncProgress.currentContestTitle }}</span>
              </div>
              <div class="actions">
                <button class="button" :disabled="loadingStats" @click="syncingContests ? handleInterruptSync() : handleOneClickSync()">
                  {{ syncingContests ? "Interrupt Sync" : "全量同步" }}
                </button>
                <button class="button" :disabled="submitting || loadingStats" @click="handleImportDefaultData">
                  {{ importingDefaultData ? "Importing..." : "导入默认数据" }}
                </button>
                <button class="button" :disabled="submitting || loadingStats" @click="handleRefreshCatalog">
                  {{ refreshingCatalog ? "Refreshing..." : "刷新缓存" }}
                </button>
                <button class="button button--ghost" :disabled="submitting" @click="handleDeleteLocalContests">
                  删除本地比赛
                </button>
                <button class="button button--ghost" :disabled="submitting" @click="handleDeleteLocalMembers">
                  删除本地成员
                </button>
              </div>
            </div>
          </section>

          <section class="panel" style="box-shadow: none">
            <div class="panel__body">
              <div class="panel__title" style="margin-bottom: 14px">
                <p class="eyebrow">Import</p>
                <h3>导入</h3>
              </div>

              <div class="manage-io-grid">
                <div class="field">
                  <label>导入对象</label>
                  <div class="choice-grid">
                    <label class="choice-card" :class="{ 'choice-card--active': importTarget === 'contest' }">
                      <input v-model="importTarget" class="choice-card__input" type="radio" value="contest" />
                      <span class="choice-card__title">比赛</span>
                    </label>
                    <label class="choice-card" :class="{ 'choice-card--active': importTarget === 'member' }">
                      <input v-model="importTarget" class="choice-card__input" type="radio" value="member" />
                      <span class="choice-card__title">成员</span>
                    </label>
                  </div>
                </div>
                <div class="field">
                  <label>导入模式</label>
                  <div class="choice-grid">
                    <label class="choice-card" :class="{ 'choice-card--active': importMode === 'merge' }">
                      <input v-model="importMode" class="choice-card__input" type="radio" value="merge" />
                      <span class="choice-card__title">新增</span>
                    </label>
                    <label class="choice-card" :class="{ 'choice-card--active': importMode === 'replace' }">
                      <input v-model="importMode" class="choice-card__input" type="radio" value="replace" />
                      <span class="choice-card__title">覆盖</span>
                    </label>
                  </div>
                </div>
                <div class="field">
                  <label>导入内容</label>
                  <div class="choice-grid choice-grid--single">
                    <label class="choice-card" :class="{ 'choice-card--active': importIncludeProblems }">
                      <input v-model="importIncludeProblems" class="choice-card__input" type="checkbox" />
                      <span class="choice-card__title">{{ importTarget === "contest" ? "导入题目" : "导入题目状态" }}</span>
                    </label>
                  </div>
                </div>
              </div>

              <div class="actions">
                <input
                  ref="importFileInput"
                  type="file"
                  accept="application/json"
                  style="display: none"
                  @change="handleImportData"
                />
                <button class="button button--ghost" :disabled="submitting" @click="handleOpenImport">
                  导入
                </button>
              </div>
            </div>
          </section>

          <section class="panel" style="box-shadow: none">
            <div class="panel__body">
              <div class="panel__title" style="margin-bottom: 14px">
                <p class="eyebrow">Export</p>
                <h3>导出</h3>
              </div>

              <div class="manage-io-grid">
                <div class="field">
                  <label>导出对象</label>
                  <div class="choice-grid">
                    <label class="choice-card" :class="{ 'choice-card--active': exportTarget === 'contest' }">
                      <input v-model="exportTarget" class="choice-card__input" type="radio" value="contest" />
                      <span class="choice-card__title">比赛</span>
                    </label>
                    <label class="choice-card" :class="{ 'choice-card--active': exportTarget === 'member' }">
                      <input v-model="exportTarget" class="choice-card__input" type="radio" value="member" />
                      <span class="choice-card__title">成员</span>
                    </label>
                  </div>
                </div>
                <div class="field">
                  <label>导出内容</label>
                  <div class="choice-grid choice-grid--single">
                    <label class="choice-card" :class="{ 'choice-card--active': exportIncludeProblems }">
                      <input v-model="exportIncludeProblems" class="choice-card__input" type="checkbox" />
                      <span class="choice-card__title">{{ exportTarget === "contest" ? "包含题目" : "包含题目状态" }}</span>
                    </label>
                  </div>
                </div>
              </div>

              <div class="actions">
                <button class="button button--ghost" :disabled="submitting" @click="handleExportData">
                  导出
                </button>
              </div>
            </div>
          </section>
        </div>

        <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
