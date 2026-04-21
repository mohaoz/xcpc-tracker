<script setup lang="ts">
import { onMounted, ref } from "vue";

import { importQojUserscriptMembers, type QojUserscriptImport } from "../lib/qoj";
import { emitMemberMutated } from "../lib/member-events";
import { listRuntimeCatalogContests } from "../lib/catalog-runtime";
import {
  applyLocalRuntimeSnapshot,
  exportLocalRuntimeSnapshot,
  getCatalogDbStatus,
} from "../lib/local-db";
import type { LocalDbStatus, LocalRuntimeSnapshot } from "../lib/local-model";

const submitting = ref(false);
const loadingStats = ref(false);
const error = ref("");
const feedback = ref("");
const importFileInput = ref<HTMLInputElement | null>(null);
const dbStatus = ref<LocalDbStatus | null>(null);

const exportIncludeProblemStatus = ref(true);
const importMode = ref<"merge" | "replace">("merge");
const importIncludeProblemStatus = ref(true);
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

async function refreshStats() {
  loadingStats.value = true;
  try {
    const [localStatus, runtimeCatalog] = await Promise.all([
      getCatalogDbStatus(),
      listRuntimeCatalogContests(),
    ]);
    dbStatus.value = {
      ...localStatus,
      contestCount: runtimeCatalog.contests.length,
      problemCount: runtimeCatalog.contests.reduce((sum, contest) => sum + contest.problemCount, 0),
    };
  } finally {
    loadingStats.value = false;
  }
}

async function handleExportData() {
  clearStatus();
  try {
    const payload = await exportLocalRuntimeSnapshot({
      includeProblemStatus: exportIncludeProblemStatus.value,
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
      includeProblemStatus: importIncludeProblemStatus.value,
    });
    feedback.value = `imported member data: ${payload.members.length} members, ${payload.memberProblemStatus.length} statuses`;
    emitMemberMutated();
    await refreshStats();
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
                <p class="eyebrow">Catalog</p>
                <h3>静态目录</h3>
              </div>
              <p class="muted tiny">
                默认比赛目录由部署期生成的静态资源直接提供，不会走本地初始化。
                本页只保留成员数据导入导出。
              </p>
            </div>
          </section>

          <section class="panel" style="box-shadow: none">
            <div class="panel__body">
              <div class="panel__title" style="margin-bottom: 14px">
                <p class="eyebrow">导入</p>
                <h3>成员导入</h3>
              </div>

              <div class="manage-io-grid">
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
                    <label class="choice-card" :class="{ 'choice-card--active': importIncludeProblemStatus }">
                      <input v-model="importIncludeProblemStatus" class="choice-card__input" type="checkbox" />
                      <span class="choice-card__title">导入题目状态</span>
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
                  placeholder="把 QOJ 浏览器脚本复制到剪贴板的 JSON 或 local_runtime_snapshot 粘贴到这里"
                />
              </div>
              <p class="muted tiny">
                成员导入支持 `local_runtime_snapshot`，也支持从 QOJ 用户页控制台脚本复制到剪贴板的 `provider = qoj` JSON。
              </p>
            </div>
          </section>

          <section class="panel" style="box-shadow: none">
            <div class="panel__body">
              <div class="panel__title" style="margin-bottom: 14px">
                <p class="eyebrow">导出</p>
                <h3>成员导出</h3>
              </div>

              <div class="manage-io-grid">
                <div class="field">
                  <label>导出内容</label>
                  <div class="choice-grid choice-grid--single">
                    <label class="choice-card" :class="{ 'choice-card--active': exportIncludeProblemStatus }">
                      <input v-model="exportIncludeProblemStatus" class="choice-card__input" type="checkbox" />
                      <span class="choice-card__title">包含题目状态</span>
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
