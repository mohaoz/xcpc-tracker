<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { useRoute } from "vue-router";

import { importQojUserscriptMembers, type QojUserscriptImport } from "../lib/qoj";
import { emitMemberMutated } from "../lib/member-events";
import { listRuntimeCatalogContests } from "../lib/catalog-runtime";
import {
  applyLocalRuntimeSnapshot,
  exportLocalRuntimeSnapshot,
  getCatalogDbStatus,
} from "../lib/local-db";
import type { LocalDbStatus, LocalRuntimeSnapshot } from "../lib/local-model";

const route = useRoute();
const submitting = ref(false);
const loadingStats = ref(false);
const error = ref("");
const feedback = ref("");
const importProgress = ref("");
const importSucceeded = ref(false);
const pastedImportSucceeded = ref(false);
const importFileInput = ref<HTMLInputElement | null>(null);
const importTextArea = ref<HTMLTextAreaElement | null>(null);
const dbStatus = ref<LocalDbStatus | null>(null);

const exportIncludeProblemStatus = ref(true);
const importMode = ref<"merge" | "replace">("merge");
const importIncludeProblemStatus = ref(true);
const importText = ref("");

function clearStatus() {
  error.value = "";
  feedback.value = "";
  importProgress.value = "";
  importSucceeded.value = false;
  pastedImportSucceeded.value = false;
}

async function showImportProgress(message: string) {
  importProgress.value = message;
  await nextTick();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
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

function handleImportTextInput() {
  if (submitting.value || !pastedImportSucceeded.value) {
    return;
  }
  pastedImportSucceeded.value = false;
  importSucceeded.value = false;
  feedback.value = "";
}

async function importDataFromText(text: string) {
  await showImportProgress("正在解析导入内容…");
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error("没有可导入的 JSON 内容");
  }

  const parsedPayload = JSON.parse(normalizedText) as unknown;
  if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
    throw new Error("导入内容必须是 JSON 对象");
  }
  const rawPayload = parsedPayload as LocalRuntimeSnapshot | QojUserscriptImport;
  if ("provider" in rawPayload && rawPayload.provider === "qoj") {
    const summary = await importQojUserscriptMembers(rawPayload, {
      onProgress: ({ currentIndex, totalCount, handle, phase }) => {
        importProgress.value = phase === "failure"
          ? `正在记录抓取失败 ${currentIndex}/${totalCount}：${handle}`
          : `正在导入 QOJ 成员 ${currentIndex}/${totalCount}：${handle}`;
      },
    });
    feedback.value = `已导入 ${summary.memberCount} 名 QOJ 成员、${summary.matchedStatusCount} 条已匹配状态`;
    if (summary.unmatchedStatusCount > 0) {
      feedback.value += `，${summary.unmatchedStatusCount} 条状态未匹配`;
    }
    if (summary.fetchFailureCount > 0) {
      feedback.value += `，${summary.fetchFailureCount} 个账号抓取失败（${summary.failedHandles.join("、")}）`;
    }
    emitMemberMutated();
    importProgress.value = "导入完成，正在刷新统计…";
    await refreshStats();
  } else {
    const payload = rawPayload as LocalRuntimeSnapshot;
    await showImportProgress(`正在导入 ${payload.members?.length ?? 0} 名成员…`);
    await applyLocalRuntimeSnapshot(payload, {
      mode: importMode.value,
      includeProblemStatus: importIncludeProblemStatus.value,
    });
    feedback.value = `imported member data: ${payload.members.length} members, ${payload.memberProblemStatus.length} statuses`;
    emitMemberMutated();
    importProgress.value = "导入完成，正在刷新统计…";
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
    await showImportProgress(`正在读取文件：${file.name}`);
    await importDataFromText(await file.text());
    importSucceeded.value = true;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "导入数据失败";
  } finally {
    submitting.value = false;
    importProgress.value = "";
    if (importFileInput.value) {
      importFileInput.value.value = "";
    }
  }
}

async function handleImportPastedData() {
  submitting.value = true;
  clearStatus();
  try {
    await showImportProgress("正在读取粘贴内容…");
    await importDataFromText(importText.value);
    importText.value = "";
    importSucceeded.value = true;
    pastedImportSucceeded.value = true;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "导入数据失败";
  } finally {
    submitting.value = false;
    importProgress.value = "";
  }
}

onMounted(async () => {
  void refreshStats();
  if (route.query.import === "member") {
    await nextTick();
    importTextArea.value?.focus({ preventScroll: true });
    importTextArea.value?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
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
                <p class="eyebrow">导入</p>
                <h3>成员导入</h3>
              </div>

              <p v-if="route.query.import === 'member'" class="notice" style="margin-bottom: 16px">
                QOJ 导入已就绪。运行新标签页中的控制台脚本后，回到这里直接粘贴 JSON。
              </p>

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
                  {{ submitting ? "正在导入…" : "导入" }}
                </button>
                <button
                  class="button"
                  :class="{ 'button--success': pastedImportSucceeded }"
                  :disabled="submitting || !importText.trim()"
                  @click="handleImportPastedData"
                >
                  {{ submitting ? "正在导入…" : pastedImportSucceeded ? "✓ 导入完成" : "粘贴内容导入" }}
                </button>
              </div>
              <p
                v-if="submitting"
                class="notice"
                role="status"
                aria-live="polite"
                style="margin-top: 12px"
              >
                {{ importProgress || "正在准备导入…" }}
              </p>
              <div
                v-else-if="importSucceeded && feedback"
                class="notice import-result"
                role="status"
                aria-live="polite"
                style="margin-top: 12px"
              >
                <strong>✓ 导入完成</strong>
                <span>{{ feedback }}</span>
              </div>
              <div class="field" style="margin-top: 16px">
                <label for="import-json-text">直接粘贴 JSON</label>
                <textarea
                  id="import-json-text"
                  ref="importTextArea"
                  v-model="importText"
                  class="input-textarea"
                  rows="10"
                  spellcheck="false"
                  placeholder="把 QOJ 单账号或批量浏览器脚本复制的 JSON，或 local_runtime_snapshot，粘贴到这里"
                  @input="handleImportTextInput"
                />
              </div>
              <p class="muted tiny">
                成员导入支持 `local_runtime_snapshot`，也支持 QOJ 控制台脚本生成的单账号或批量 `provider = qoj` JSON；批量抓取失败清单会保留在同步记录中。
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

        <p v-if="feedback && !importSucceeded" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
