<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";

import { importQojUserscriptMembers, type QojUserscriptImport } from "../lib/qoj";
import { loadBundledCatalogSnapshot } from "../lib/catalog-cache";
import { emitCatalogMutated } from "../lib/catalog-events";
import { emitMemberMutated } from "../lib/member-events";
import {
  applyLocalCatalogSnapshot,
  applyLocalRuntimeSnapshot,
  exportLocalCatalogSnapshot,
  exportLocalRuntimeSnapshot,
  getCatalogDbStatus,
  resetLocalDb,
} from "../lib/local-db";
import type { LocalCatalogSnapshot, LocalDbStatus, LocalRuntimeSnapshot } from "../lib/local-model";

const route = useRoute();

const submitting = ref(false);
const loadingStats = ref(false);
const error = ref("");
const feedback = ref("");
const importFileInput = ref<HTMLInputElement | null>(null);
const dbStatus = ref<LocalDbStatus | null>(null);
const initializingDevData = ref(false);

const exportTarget = ref<"contest" | "member">("contest");
const exportIncludeProblems = ref(true);
const importTarget = ref<"contest" | "member">("contest");
const importMode = ref<"merge" | "replace">("merge");
const importIncludeProblems = ref(true);
const importText = ref("");

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
    return "暂无记录";
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

async function handleOneClickInit() {
  const confirmed = window.confirm("一键初始化会删除当前浏览器里整个本地数据库，然后重新导入默认 catalog。是否继续？");
  if (!confirmed) {
    return;
  }

  submitting.value = true;
  initializingDevData.value = true;
  clearStatus();

  try {
    const snapshot = await loadBundledCatalogSnapshot({
      forceRefresh: true,
    });

    await resetLocalDb();
    await applyLocalCatalogSnapshot(snapshot, {
      mode: "replace",
      includeProblems: true,
    });

    await refreshStats();
    emitCatalogMutated();
    emitMemberMutated();
    feedback.value = `开发初始化完成：${snapshot.contests.length} 场比赛，${snapshot.problems.length} 道题目，本地成员数据已清空`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "初始化本地数据失败";
  } finally {
    initializingDevData.value = false;
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
      feedback.value = `已导出 ${payload.contests.length} 场比赛`;
      return;
    }

    const payload = await exportLocalRuntimeSnapshot({
      includeProblemStatus: exportIncludeProblems.value,
    });
    downloadJson("member-export.min.json", payload);
    feedback.value = `已导出 ${payload.members.length} 名成员`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "导出数据失败";
  }
}

function handleOpenImport() {
  importFileInput.value?.click();
}

async function importDataFromText(text: string) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error("没有可导入的 JSON 内容");
  }

  if (importTarget.value === "contest") {
    const payload = JSON.parse(normalizedText) as LocalCatalogSnapshot;
    await applyLocalCatalogSnapshot(payload, {
      mode: importMode.value,
      includeProblems: importIncludeProblems.value,
    });
    feedback.value = `imported contest data: ${payload.contests.length} contests, ${payload.problems.length} problems`;
    emitCatalogMutated();
    await refreshStats();
  } else {
    const rawPayload = JSON.parse(normalizedText) as LocalRuntimeSnapshot | QojUserscriptImport;
    if ("provider" in rawPayload && rawPayload.provider === "qoj") {
      const summary = await importQojUserscriptMembers(rawPayload);
      feedback.value = `imported QOJ member data: ${summary.memberCount} members, ${summary.matchedStatusCount} matched statuses`;
      if (summary.unmatchedStatusCount > 0) {
        feedback.value += `, ${summary.unmatchedStatusCount} unmatched`;
      }
      emitMemberMutated();
      await refreshStats();
    } else {
      const payload = rawPayload as LocalRuntimeSnapshot;
      await applyLocalRuntimeSnapshot(payload, {
        mode: importMode.value,
        includeProblemStatus: importIncludeProblems.value,
      });
      feedback.value = `imported member data: ${payload.members.length} members, ${payload.memberProblemStatus.length} statuses`;
      emitMemberMutated();
      await refreshStats();
    }
  }
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
    await importDataFromText(await file.text());
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "导入数据失败";
  } finally {
    submitting.value = false;
    if (importFileInput.value) {
      importFileInput.value.value = "";
    }
  }
}

async function handleImportPastedData() {
  submitting.value = true;
  clearStatus();
  try {
    await importDataFromText(importText.value);
    importText.value = "";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "导入数据失败";
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  if (route.query.import === "member") {
    importTarget.value = "member";
  } else if (route.query.import === "contest") {
    importTarget.value = "contest";
  }
  void refreshStats();
});
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div class="stat-grid" style="margin-bottom: 20px">
          <div class="stat-card">
            <p class="stat-card__label">比赛数</p>
            <div class="stat-card__value">{{ dbStatus?.contestCount ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">题目数</p>
            <div class="stat-card__value">{{ dbStatus?.problemCount ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">成员数</p>
            <div class="stat-card__value">{{ dbStatus?.memberCount ?? 0 }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">做题状态</p>
            <div class="stat-card__value">{{ dbStatus?.statusCount ?? 0 }}</div>
          </div>
        </div>

        <div class="list-grid">
          <section class="panel" style="box-shadow: none">
            <div class="panel__body">
              <div class="panel__title" style="margin-bottom: 14px">
                <p class="eyebrow">操作</p>
                <h3>本地操作</h3>
              </div>
              <div class="actions">
                <button class="button" :disabled="submitting || loadingStats" @click="handleOneClickInit">
                  {{ initializingDevData ? "初始化中..." : "一键初始化" }}
                </button>
              </div>
            </div>
          </section>

          <section class="panel" style="box-shadow: none">
            <div class="panel__body">
              <div class="panel__title" style="margin-bottom: 14px">
                <p class="eyebrow">导入</p>
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
                <button class="button" :disabled="submitting || !importText.trim()" @click="handleImportPastedData">
                  粘贴内容导入
                </button>
              </div>
              <div class="field" style="margin-top: 16px">
                <label for="import-json-text">直接粘贴 JSON</label>
                <textarea
                  id="import-json-text"
                  v-model="importText"
                  class="input-textarea"
                  rows="10"
                  spellcheck="false"
                  :placeholder="importTarget === 'member' ? '把 QOJ 浏览器脚本复制到剪贴板的 JSON 直接粘贴到这里' : '把 contest JSON 粘贴到这里'"
                />
              </div>
              <p v-if="importTarget === 'member'" class="muted tiny">
                成员导入支持 `local_runtime_snapshot`，也支持从 QOJ 用户页控制台脚本复制到剪贴板的 `provider = qoj` JSON。
              </p>
              <p v-else class="muted tiny">
                比赛导入支持整份 `local_catalog_snapshot`，也支持单场补丁 JSON；补充已有比赛时保持导入模式为 `merge`。
              </p>
            </div>
          </section>

          <section class="panel" style="box-shadow: none">
            <div class="panel__body">
              <div class="panel__title" style="margin-bottom: 14px">
                <p class="eyebrow">导出</p>
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
