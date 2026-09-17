<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { useSpoilerStore } from '../stores/spoilers';
import { useSettingsStore } from '../stores/settings';
import { useQojSyncStore } from '../stores/qoj-sync';

import { importQojUserscriptMembers, type QojUserscriptImport } from "../lib/qoj";
import { emitMemberMutated, subscribeMemberMutated } from "../lib/member-events";
import { listRuntimeCatalogContests } from "../lib/catalog-runtime";
import {
  applyLocalRuntimeSnapshot,
  exportLocalRuntimeSnapshot,
  getCatalogDbStatus,
} from "../lib/local-db";
import type { LocalDbStatus, LocalRuntimeSnapshot } from "../lib/local-model";

const spoilers = useSpoilerStore();
const settings = useSettingsStore();
const qojSync = useQojSyncStore();
const catalogContestIds = ref<string[]>([]);
const submitting = ref(false);
const loadingStats = ref(false);
const error = ref("");
const feedback = ref("");
const importProgress = ref("");
const importSucceeded = ref(false);
const importFileInput = ref<HTMLInputElement | null>(null);
const dbStatus = ref<LocalDbStatus | null>(null);

const exportIncludeProblemStatus = ref(true);
const importMode = ref<"merge" | "replace">("merge");
const importIncludeProblemStatus = ref(true);

function clearStatus() {
  error.value = "";
  feedback.value = "";
  importProgress.value = "";
  importSucceeded.value = false;
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
    catalogContestIds.value = runtimeCatalog.contests.map(contest => contest.contestId);
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

let unsubscribe: (() => void) | undefined;
onMounted(() => {
  void refreshStats();
  unsubscribe=subscribeMemberMutated(()=>void refreshStats());
});
onUnmounted(()=>unsubscribe?.());
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
          <section class="panel settings-panel" style="box-shadow: none">
            <div class="panel__body">
              <div class="panel__header" style="margin-bottom: 0">
                <div class="panel__title">
                  <h3>全部剧透</h3>
                  <p class="muted tiny">批量设置当前全部比赛，单场仍可在详情页调整。</p>
                </div>
                <button type="button" role="switch" class="spoiler-switch"
                  aria-label="全部剧透" :aria-checked="spoilers.allEnabled(catalogContestIds)"
                  :disabled="!spoilers.loaded || loadingStats || spoilers.bulkSaving || !catalogContestIds.length"
                  @click="spoilers.setAll(catalogContestIds, !spoilers.allEnabled(catalogContestIds))">
                  <span class="spoiler-switch__track" aria-hidden="true"><span class="spoiler-switch__thumb"></span></span>
                </button>
              </div>
              <p v-if="spoilers.error" class="error-box">{{ spoilers.error }}</p>
              <div class="panel__header" style="margin: 20px 0 0">
                <div class="panel__title"><h3>允许比例估算</h3><p class="muted tiny">无奖牌配置时，按榜单正式队伍的 10% / 20% / 30% 估算金、银、铜牌线。</p></div>
                <button type="button" role="switch" class="spoiler-switch" aria-label="允许比例估算"
                  :aria-checked="settings.allowMedalEstimates" :disabled="!settings.loaded || settings.saving"
                  @click="settings.toggleEstimates()"><span class="spoiler-switch__track" aria-hidden="true"><span class="spoiler-switch__thumb"></span></span></button>
              </div>
              <p v-if="settings.error" class="error-box">{{ settings.error }}</p>
              <div class="panel__header" style="margin: 20px 0 0">
                <div class="panel__title"><h3>使用 QOJ 油猴脚本</h3><p class="muted tiny">用于添加成员和更新记录；关闭后改为手动导入，并停止自动同步。</p></div>
                <button type="button" role="switch" class="spoiler-switch" aria-label="使用 QOJ 油猴脚本"
                  :aria-checked="qojSync.useUserscript" :disabled="!qojSync.modeLoaded || qojSync.busy"
                  @click="qojSync.setUseUserscript(!qojSync.useUserscript)"><span class="spoiler-switch__track" aria-hidden="true"><span class="spoiler-switch__thumb"></span></span></button>
              </div>
              <div class="panel__header" style="margin: 20px 0 0">
                <div class="panel__title"><h3>自动同步</h3><p class="muted tiny">同时启用 QOJ 油猴模式，每 30 分钟同步 CF 与 QOJ，页面关闭时不运行。</p></div>
                <button type="button" role="switch" class="spoiler-switch" aria-label="自动同步"
                  :aria-checked="qojSync.enabled" :disabled="!qojSync.modeLoaded"
                  @click="qojSync.setEnabled(!qojSync.enabled)"><span class="spoiler-switch__track" aria-hidden="true"><span class="spoiler-switch__thumb"></span></span></button>
              </div>
            </div>
          </section>
          <div class="transfer-grid">
            <section class="panel transfer-card" aria-labelledby="manage-import-title">
              <div class="panel__body">
                <h3 id="manage-import-title">导入</h3>
                <p class="muted tiny">从文件恢复成员数据备份</p>
                <div class="transfer-options">
                  <label class="status-option"><input v-model="importIncludeProblemStatus" type="checkbox" :disabled="submitting" /> 包含题目状态</label>
                  <div class="import-mode" role="group" aria-label="导入方式">
                    <span>导入方式</span>
                    <div class="segmented">
                      <button type="button" :aria-pressed="importMode==='merge'" :disabled="submitting" @click="importMode='merge'">合并</button>
                      <button type="button" :aria-pressed="importMode==='replace'" :disabled="submitting" @click="importMode='replace'">覆盖</button>
                    </div>
                  </div>
                </div>
                <div class="transfer-actions">
                  <input ref="importFileInput" type="file" accept=".json,application/json" hidden @change="handleImportData" />
                  <button class="button button--ghost" :disabled="submitting" @click="handleOpenImport">{{ submitting ? '正在导入…' : '选择备份文件' }}</button>
                </div>
              </div>
            </section>
            <section class="panel transfer-card" aria-labelledby="manage-export-title">
              <div class="panel__body">
                <h3 id="manage-export-title">导出</h3>
                <p class="muted tiny">保存本地成员数据备份</p>
                <div class="transfer-options">
                  <label class="status-option"><input v-model="exportIncludeProblemStatus" type="checkbox" /> 包含题目状态</label>
                </div>
                <div class="transfer-actions">
                  <button class="button button--ghost" :disabled="submitting" @click="handleExportData">导出备份</button>
                </div>
              </div>
            </section>
          </div>
        </div>

        <p v-if="submitting" class="notice" role="status">{{ importProgress }}</p>
        <p v-else-if="feedback" class="notice" role="status" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.transfer-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;}
.transfer-card {box-shadow:none;min-width:0;display:flex;}
.transfer-card > .panel__body {display:flex;flex-direction:column;flex:1;}
.transfer-card h3 {margin:0;}
.transfer-card p {margin:8px 0 0;}
.transfer-options {display:grid;align-content:start;gap:16px;margin:22px 0;}
.transfer-actions {display:flex;align-items:center;margin-top:auto;padding-top:2px;}
.transfer-actions .button {min-width:144px;min-height:42px;justify-content:center;border-radius:10px;padding:10px 18px;font-size:14px;}
.status-option {display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;}
.status-option input {appearance:none;width:18px;height:18px;margin:0;border:1px solid #aabeb9;border-radius:5px;background:#fff;display:grid;place-content:center;cursor:pointer;}
.status-option input:checked {background:#146e75;border-color:#146e75;}
.status-option input:checked::after {content:'';width:8px;height:4px;border-left:2px solid white;border-bottom:2px solid white;transform:translateY(-1px) rotate(-45deg);}
.status-option input:focus-visible,.segmented button:focus-visible {outline:2px solid #146e75;outline-offset:3px;}
.status-option input:disabled {opacity:.5;cursor:default;}
.import-mode {display:flex;align-items:center;gap:16px;font-size:13px;color:#657482;}
.segmented {display:flex;border:1px solid #d7dfdc;border-radius:8px;padding:3px;background:#f1f3ef;gap:3px;}
.segmented button {border:0;border-radius:5px;padding:6px 16px;background:transparent;color:#657482;font:inherit;cursor:pointer;}
.segmented button[aria-pressed=true] {background:#fffdf9;color:#146e75;box-shadow:0 1px 3px #233a361a;font-weight:600;}
.settings-panel > .panel__body {padding-top:6px;padding-bottom:6px;}
.settings-panel .panel__header {margin:0 !important;padding:16px 0;align-items:center;gap:24px;}
.settings-panel .panel__header ~ .panel__header {border-top:1px solid #e6e8e1;}
.settings-panel .panel__title {gap:0;}
.settings-panel h3 {margin:0;font-size:15px;}
.settings-panel .panel__title p {margin:5px 0 0;line-height:1.5;}
.settings-panel .spoiler-switch {flex-shrink:0;}
@media(max-width:760px) {.transfer-grid {grid-template-columns:1fr;}}
</style>
