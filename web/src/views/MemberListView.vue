<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";

import { syncAllCodeforcesMembers } from "../lib/codeforces";
import { getCatalogDbStatus, listMemberPeopleFromDb } from "../lib/local-db";
import { subscribeMemberMutated } from "../lib/member-events";
import type { LocalDbStatus, LocalMemberPerson } from "../lib/local-model";
import { buildQojBatchBrowserScript } from "../lib/qoj-member-script";

const router = useRouter();
const people = ref<LocalMemberPerson[]>([]);
const dbStatus = ref<LocalDbStatus | null>(null);
const loading = ref(false);
const error = ref("");
const syncing = ref(false);
const preparingQojScript = ref(false);
const qojScript = ref("");
const qojScriptTargetCount = ref(0);
const qojFeedback = ref("");
const qojLaunchUrl = ref("https://qoj.ac/");
const syncProgress = ref<{
  currentIndex: number;
  totalMemberCount: number;
  displayName: string;
  handle: string;
} | null>(null);
let syncAbortController: AbortController | null = null;
let unsubscribeMemberMutated: (() => void) | null = null;

const codeforcesHandleCount = computed(() =>
  people.value.reduce(
    (count, person) => count + person.handles.filter((handle) => handle.provider === "codeforces").length,
    0,
  ),
);

const qojScriptMembers = computed(() =>
  people.value.flatMap((person) =>
    person.handles
      .filter((handle) => handle.provider === "qoj")
      .map((handle) => ({
        memberId: person.memberId,
        displayName: person.displayName,
        handle: handle.handle,
      })),
  ),
);

function formatDateTime(value: string | null) {
  if (!value) {
    return "未同步";
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

async function loadMembers() {
  loading.value = true;
  error.value = "";
  try {
    const [peoplePayload, statusPayload] = await Promise.all([
      listMemberPeopleFromDb(),
      getCatalogDbStatus(),
    ]);
    people.value = peoplePayload;
    dbStatus.value = statusPayload;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "加载成员失败";
  } finally {
    loading.value = false;
  }
}

async function handleSyncMembers() {
  syncing.value = true;
  error.value = "";
  syncAbortController = new AbortController();
  syncProgress.value = {
    currentIndex: 0,
    totalMemberCount: codeforcesHandleCount.value,
    displayName: "准备同步",
    handle: "",
  };
  try {
    const result = await syncAllCodeforcesMembers({
      signal: syncAbortController.signal,
      onProgress: ({ currentIndex, totalMemberCount, displayName, handle }) => {
        syncProgress.value = {
          currentIndex,
          totalMemberCount,
          displayName,
          handle,
        };
      },
    });
    await loadMembers();
    syncProgress.value = {
      currentIndex: result.syncedMemberCount,
      totalMemberCount: result.totalMemberCount,
      displayName: result.cancelled ? "同步已中断" : "同步完成",
      handle: "",
    };
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "同步成员失败";
  } finally {
    syncing.value = false;
    syncAbortController = null;
  }
}

function handleInterruptSync() {
  syncAbortController?.abort();
}

function startClipboardWrite(text: string): Promise<void> {
  try {
    return navigator.clipboard.writeText(text);
  } catch (caught) {
    return Promise.reject(caught);
  }
}

async function copyQojScript() {
  if (!qojScript.value) {
    return;
  }
  error.value = "";
  const copyAttempt = startClipboardWrite(qojScript.value);
  window.open(qojLaunchUrl.value, "_blank", "noopener,noreferrer");
  qojFeedback.value = "已在新标签页打开 QOJ，正在重新复制批量脚本…";
  try {
    await copyAttempt;
    qojFeedback.value = `已重新复制包含 ${qojScriptTargetCount.value} 个 QOJ 账号的批量脚本，并在新标签页打开 QOJ。`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "浏览器未允许复制，请在脚本框中手动复制";
    qojFeedback.value = "已在新标签页打开 QOJ；浏览器未允许复制，请在下方手动复制脚本。";
    return;
  }
  await router.replace({ name: "manage", query: { import: "member" } });
}

async function handlePrepareQojScript() {
  preparingQojScript.value = true;
  error.value = "";
  qojFeedback.value = "";
  qojScript.value = "";
  qojScriptTargetCount.value = 0;
  try {
    const firstHandle = qojScriptMembers.value[0]?.handle;
    qojLaunchUrl.value = firstHandle
      ? `https://qoj.ac/user/profile/${encodeURIComponent(firstHandle)}`
      : "https://qoj.ac/";
    qojScript.value = buildQojBatchBrowserScript({
      members: qojScriptMembers.value,
    });
    qojScriptTargetCount.value = qojScriptMembers.value.length;
    const copyAttempt = startClipboardWrite(qojScript.value);
    window.open(qojLaunchUrl.value, "_blank", "noopener,noreferrer");
    qojFeedback.value = "已在新标签页打开 QOJ，正在复制批量脚本…";
    try {
      await copyAttempt;
      qojFeedback.value = `已复制包含 ${qojScriptTargetCount.value} 个 QOJ 账号的批量脚本，并在新标签页打开 QOJ。`;
    } catch {
      qojFeedback.value = `已在新标签页打开 QOJ，并生成包含 ${qojScriptTargetCount.value} 个账号的批量脚本。浏览器未允许自动复制，请在下方手动复制。`;
      return;
    }
    await router.replace({ name: "manage", query: { import: "member" } });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "生成 QOJ 批量脚本失败";
  } finally {
    preparingQojScript.value = false;
  }
}

function selectQojScript(event: Event) {
  (event.target as HTMLTextAreaElement).select();
}

onMounted(() => {
  unsubscribeMemberMutated = subscribeMemberMutated(() => {
    void loadMembers();
  });
  void loadMembers();
});

onUnmounted(() => {
  unsubscribeMemberMutated?.();
  unsubscribeMemberMutated = null;
});
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div v-if="dbStatus" class="member-overview-grid">
          <div class="stat-card">
            <p class="stat-card__label">成员数</p>
            <div class="stat-card__value">{{ dbStatus.memberCount }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">账号数</p>
            <div class="stat-card__value">{{ dbStatus.handleCount }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">做题状态</p>
            <div class="stat-card__value">{{ dbStatus.statusCount }}</div>
          </div>
        </div>

        <div class="member-toolbar">
          <div class="member-toolbar__actions">
            <button
              class="button button--ghost"
              :disabled="loading || preparingQojScript || (!syncing && codeforcesHandleCount === 0)"
              @click="syncing ? handleInterruptSync() : handleSyncMembers()"
            >
              {{ syncing ? "中断同步" : `同步 Codeforces (${codeforcesHandleCount})` }}
            </button>
            <button
              class="button button--ghost"
              :disabled="loading || syncing || preparingQojScript || qojScriptMembers.length === 0"
              :title="qojScriptMembers.length ? '生成全部 QOJ 账号的批量控制台脚本' : '当前没有 QOJ 账号'"
              @click="handlePrepareQojScript"
            >
              {{ preparingQojScript ? "正在生成..." : `更新 QOJ (${qojScriptMembers.length})` }}
            </button>
            <RouterLink to="/members/new" class="button">
              添加成员
            </RouterLink>
          </div>
        </div>

        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>

        <div v-if="qojScript" class="notice" style="margin-top: 16px; margin-bottom: 16px">
          <p style="margin: 0">{{ qojFeedback }}</p>
          <p class="muted tiny" style="margin: 8px 0 0">
            脚本执行完成后会复制一份批量 JSON；回到管理页粘贴导入即可。单个账号抓取失败不会中断其他账号。
          </p>
          <div class="actions" style="margin-top: 12px">
            <button class="button button--ghost" @click="copyQojScript">重新复制并打开 QOJ</button>
            <a
              :href="qojLaunchUrl"
              class="button button--ghost"
              target="_blank"
              rel="noopener noreferrer"
            >直接打开 QOJ</a>
            <RouterLink to="/manage?import=member" class="button">前往管理页导入</RouterLink>
          </div>
          <details style="margin-top: 12px">
            <summary>查看或手动复制脚本</summary>
            <textarea
              class="input-textarea"
              :value="qojScript"
              rows="8"
              readonly
              spellcheck="false"
              style="margin-top: 10px"
              @focus="selectQojScript"
            />
          </details>
        </div>

        <div v-if="loading" class="notice">正在加载成员...</div>
        <div v-else-if="syncProgress" class="notice" style="margin-bottom: 16px">
          <strong>{{ syncProgress.currentIndex }}/{{ syncProgress.totalMemberCount }}</strong>
          <span style="margin-left: 8px">
            {{ syncProgress.displayName }}<template v-if="syncProgress.handle"> / {{ syncProgress.handle }}</template>
          </span>
        </div>
        <div v-if="!loading && !people.length" class="notice">
          本地数据库里还没有成员。添加 Codeforces 或 QOJ 账号后，这里会显示成员、账号和题目状态。
        </div>
        <div v-else-if="people.length" class="list-grid">
          <RouterLink
            v-for="person in people"
            :key="person.memberId"
            :to="`/members/${person.memberId}`"
            class="member-card"
          >
            <div class="member-card__top">
              <div>
                <p class="eyebrow">成员</p>
                <h3>{{ person.displayName }}</h3>
                <div class="inline-tags" style="margin-top: 10px">
                  <span class="tag tag--neutral">{{ person.providerCount }} 个平台</span>
                  <span class="tag tag--neutral">{{ person.handleCount }} 个账号</span>
                </div>
              </div>
              <div class="member-card__actions">
                <span class="button member-card__detail-button">查看详情</span>
              </div>
            </div>

            <div class="member-card__stats">
              <div class="member-card__stat">
                <span class="member-card__stat-label">已做</span>
                <strong>{{ person.solvedCount }}</strong>
              </div>
              <div class="member-card__stat">
                <span class="member-card__stat-label">尝试过</span>
                <strong>{{ person.attemptedCount }}</strong>
              </div>
              <div class="member-card__stat">
                <span class="member-card__stat-label">上次同步</span>
                <strong>{{ formatDateTime(person.lastSyncedAt) }}</strong>
              </div>
            </div>

            <div class="inline-tags" style="margin-top: 16px">
              <span
                v-for="handle in person.handles"
                :key="handle.handleId"
                class="tag member-handle-tag tag--neutral"
              >
                {{ handle.provider }} / {{ handle.handle }}
              </span>
            </div>
          </RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>
