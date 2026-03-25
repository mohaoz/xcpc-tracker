<script setup lang="ts">
import { ref } from "vue";

import {
  exportConfig,
  exportContests,
  importConfig,
  importContests,
  syncContest,
  syncMember,
  syncMissingContests,
} from "../lib/api";

type IntakeLogLevel = "info" | "success" | "error";

type IntakeLogEntry = {
  id: number;
  timestamp: string;
  level: IntakeLogLevel;
  message: string;
  details?: string[];
};

const submitting = ref(false);
const error = ref("");
const feedback = ref("");
const importFileInput = ref<HTMLInputElement | null>(null);
const importMemberFileInput = ref<HTMLInputElement | null>(null);
const logs = ref<IntakeLogEntry[]>([]);
let nextLogId = 1;

const syncForm = ref({
  contestUrl: "",
});
const memberForm = ref({
  localMemberKey: "",
  providerHandle: "",
  displayName: "",
});

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function pushLog(level: IntakeLogLevel, message: string, details?: string[]) {
  logs.value.unshift({
    id: nextLogId++,
    timestamp: nowLabel(),
    level,
    message,
    details,
  });
}

function clearStatus() {
  error.value = "";
  feedback.value = "";
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function submitSyncContest() {
  if (!syncForm.value.contestUrl.trim()) {
    error.value = "contest url is required";
    pushLog("error", "Sync Contest failed", ["contest url is required"]);
    return;
  }

  submitting.value = true;
  clearStatus();
  pushLog("info", "Sync Contest started", [syncForm.value.contestUrl.trim()]);
  try {
    const payload = await syncContest({
      provider_key: "codeforces",
      contest_url: syncForm.value.contestUrl.trim(),
    });
    feedback.value = `synced contest ${String(payload.provider_contest_id)} with ${String(payload.problem_count)} problems`;
    pushLog("success", "Sync Contest finished", [
      `contest ${String(payload.provider_key)}:${String(payload.provider_contest_id)}`,
      `${String(payload.problem_count)} problems`,
    ]);
    syncForm.value.contestUrl = "";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to sync contest";
    pushLog("error", "Sync Contest failed", [error.value]);
  } finally {
    submitting.value = false;
  }
}

async function handleExportContests() {
  clearStatus();
  pushLog("info", "Export Contests started");
  try {
    const payload = await exportContests();
    downloadJson("xvg-contests.json", payload);
    feedback.value = `exported ${payload.contests.length} contests`;
    pushLog("success", "Export Contests finished", [`exported ${payload.contests.length} contests`]);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to export contests";
    pushLog("error", "Export Contests failed", [error.value]);
  }
}

async function handleExportMembers() {
  clearStatus();
  pushLog("info", "Export Members started");
  try {
    const payload = await exportConfig();
    downloadJson("xvg-members.json", {
      schema_version: payload.schema_version,
      export_kind: "member_config_only",
      exported_at: payload.exported_at,
      members: payload.members,
    });
    feedback.value = `exported ${payload.members.length} members`;
    pushLog("success", "Export Members finished", [`exported ${payload.members.length} members`]);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to export members";
    pushLog("error", "Export Members failed", [error.value]);
  }
}

async function handleSyncMissingContests() {
  submitting.value = true;
  clearStatus();
  pushLog("info", "Sync Missing Contests started");
  try {
    const result = await syncMissingContests();
    feedback.value =
      `checked ${String(result.missing_contest_count ?? 0)} unsynced contests` +
      `, synced ${String(result.synced_contest_count ?? 0)}` +
      `, failed ${String(result.failed_contest_count ?? 0)}`;
    const details = [
      `checked ${String(result.missing_contest_count ?? 0)} unsynced contests`,
      `synced ${String(result.synced_contest_count ?? 0)}`,
      `failed ${String(result.failed_contest_count ?? 0)}`,
      ...(((result.failed_contests as Array<Record<string, unknown>> | undefined) ?? []).map((item) =>
        `${String(item.provider_key)}:${String(item.provider_contest_id)} ${String(item.error)}`,
      )),
    ];
    pushLog(
      (Number(result.failed_contest_count ?? 0) > 0 ? "error" : "success"),
      "Sync Missing Contests finished",
      details,
    );
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to sync missing contests";
    pushLog("error", "Sync Missing Contests failed", [error.value]);
  } finally {
    submitting.value = false;
  }
}

async function handleImportContests(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) {
    return;
  }
  const syncAfterImport = window.confirm("导入比赛后，是否立即同步这些比赛？");

  submitting.value = true;
  clearStatus();
  pushLog("info", "Import Contests started", [file.name, syncAfterImport ? "sync after import: yes" : "sync after import: no"]);
  try {
    const text = await file.text();
    const payload = JSON.parse(text) as Record<string, unknown>;
    const result = await importContests({
      payload,
      sync: syncAfterImport,
    });
    feedback.value =
      `imported ${String(result.imported_contest_count ?? 0)} contests` +
      (syncAfterImport ? `, synced ${String(result.synced_contest_count ?? 0)}` : "");
    const details = [
      `imported ${String(result.imported_contest_count ?? 0)} contests`,
      ...(syncAfterImport ? [`synced ${String(result.synced_contest_count ?? 0)}`, `failed ${String(result.failed_contest_count ?? 0)}`] : []),
      ...(((result.failed_contests as Array<Record<string, unknown>> | undefined) ?? []).map((item) =>
        `${String(item.provider_key)}:${String(item.provider_contest_id)} ${String(item.error)}`,
      )),
    ];
    pushLog(
      (Number(result.failed_contest_count ?? 0) > 0 ? "error" : "success"),
      "Import Contests finished",
      details,
    );
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to import contests";
    pushLog("error", "Import Contests failed", [error.value]);
  } finally {
    submitting.value = false;
    if (importFileInput.value) {
      importFileInput.value.value = "";
    }
  }
}

async function handleImportMembers(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) {
    return;
  }

  submitting.value = true;
  clearStatus();
  pushLog("info", "Import Members started", [file.name]);
  try {
    const text = await file.text();
    const payload = JSON.parse(text) as Record<string, unknown>;
    const result = await importConfig({
      payload: {
        members: Array.isArray(payload.members) ? payload.members : [],
      },
    });
    feedback.value = `imported ${String(result.imported_member_count ?? 0)} members`;
    pushLog("success", "Import Members finished", [
      `imported ${String(result.imported_member_count ?? 0)} members`,
    ]);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to import members";
    pushLog("error", "Import Members failed", [error.value]);
  } finally {
    submitting.value = false;
    if (importMemberFileInput.value) {
      importMemberFileInput.value.value = "";
    }
  }
}

async function submitSyncMember() {
  if (!memberForm.value.localMemberKey.trim() || !memberForm.value.providerHandle.trim()) {
    error.value = "local member key and provider handle are required";
    pushLog("error", "Sync Member failed", ["local member key and provider handle are required"]);
    return;
  }

  submitting.value = true;
  clearStatus();
  pushLog("info", "Sync Member started", [
    memberForm.value.localMemberKey.trim(),
    memberForm.value.providerHandle.trim(),
  ]);
  try {
    const payload = await syncMember({
      provider_key: "codeforces",
      local_member_key: memberForm.value.localMemberKey.trim(),
      provider_handle: memberForm.value.providerHandle.trim(),
      display_name: memberForm.value.displayName.trim() || undefined,
    });
    feedback.value = `synced ${String(payload.local_member_key)} with ${String(payload.status_count)} problem states`;
    pushLog("success", "Sync Member finished", [
      `${String(payload.local_member_key)} / ${String(payload.provider_handle)}`,
      `${String(payload.status_count)} problem states`,
    ]);
    memberForm.value = {
      localMemberKey: "",
      providerHandle: "",
      displayName: "",
    };
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to sync member";
    pushLog("error", "Sync Member failed", [error.value]);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div class="panel__header">
          <div class="panel__title">
            <p class="eyebrow">Manage</p>
            <h2>本地数据管理台</h2>
            <p class="muted">
              添加、导入、导出和补同步都放到这里，列表页尽量只负责浏览和决策。
            </p>
          </div>
        </div>

        <div class="panel__title" style="margin-bottom: 12px">
          <p class="eyebrow">Contest</p>
          <h3>添加和维护比赛池</h3>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="contest-url">Codeforces Gym URL</label>
            <input
              id="contest-url"
              v-model="syncForm.contestUrl"
              placeholder="https://codeforces.com/gym/615540"
            />
          </div>
        </div>

        <div class="actions">
          <button class="button" :disabled="submitting" @click="submitSyncContest">
            {{ submitting ? "Syncing..." : "Sync Contest" }}
          </button>
          <button class="button button--ghost" :disabled="submitting" @click="handleSyncMissingContests">
            Sync Missing Contests
          </button>
          <button class="button button--ghost" @click="handleExportContests">
            Export Contests
          </button>
          <label class="button button--ghost" style="cursor: pointer">
            Import Contests
            <input
              ref="importFileInput"
              type="file"
              accept="application/json"
              style="display: none"
              @change="handleImportContests"
            />
          </label>
        </div>

        <div class="panel__title" style="margin-top: 28px; margin-bottom: 12px">
          <p class="eyebrow">Member</p>
          <h3>添加和同步队员</h3>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="intake-local-member-key">Local Member Key</label>
            <input id="intake-local-member-key" v-model="memberForm.localMemberKey" placeholder="alice" />
          </div>
          <div class="field">
            <label for="intake-provider-handle">Codeforces Handle</label>
            <input id="intake-provider-handle" v-model="memberForm.providerHandle" placeholder="tourist" />
          </div>
          <div class="field">
            <label for="intake-display-name">Display Name</label>
            <input id="intake-display-name" v-model="memberForm.displayName" placeholder="Alice" />
          </div>
        </div>

        <div class="actions">
          <button class="button" :disabled="submitting" @click="submitSyncMember">
            {{ submitting ? "Syncing..." : "Sync Member" }}
          </button>
          <button class="button button--ghost" @click="handleExportMembers">
            Export Members
          </button>
          <label class="button button--ghost" style="cursor: pointer">
            Import Members
            <input
              ref="importMemberFileInput"
              type="file"
              accept="application/json"
              style="display: none"
              @change="handleImportMembers"
            />
          </label>
        </div>

        <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>

        <div class="intake-log-panel">
          <div class="panel__header" style="margin-bottom: 12px">
            <div class="panel__title">
              <p class="eyebrow">Logs</p>
              <h3>操作日志</h3>
            </div>
          </div>
          <div v-if="!logs.length" class="notice">还没有操作日志，执行一次 sync 或 import 之后会显示在这里。</div>
          <div v-else class="intake-log-list">
            <article
              v-for="entry in logs"
              :key="entry.id"
              class="intake-log-entry"
              :class="`intake-log-entry--${entry.level}`"
            >
              <div class="intake-log-entry__header">
                <strong>{{ entry.message }}</strong>
                <span class="tiny muted">{{ entry.timestamp }}</span>
              </div>
              <div v-if="entry.details?.length" class="intake-log-entry__details">
                <div v-for="detail in entry.details" :key="detail">{{ detail }}</div>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
