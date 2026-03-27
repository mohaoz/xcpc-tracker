<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";

import { syncAllCodeforcesMembers } from "../lib/codeforces";
import { getCatalogDbStatus, listMemberPeopleFromDb } from "../lib/local-db";
import { subscribeMemberMutated } from "../lib/member-events";
import type { LocalDbStatus, LocalMemberPerson } from "../lib/local-model";

const people = ref<LocalMemberPerson[]>([]);
const dbStatus = ref<LocalDbStatus | null>(null);
const loading = ref(false);
const error = ref("");
const syncing = ref(false);
const syncProgress = ref<{
  currentIndex: number;
  totalMemberCount: number;
  displayName: string;
  handle: string;
} | null>(null);
let syncAbortController: AbortController | null = null;
let unsubscribeMemberMutated: (() => void) | null = null;

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
    error.value = caught instanceof Error ? caught.message : "failed to load members";
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
    totalMemberCount: people.value.length,
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
    error.value = caught instanceof Error ? caught.message : "failed to sync members";
  } finally {
    syncing.value = false;
    syncAbortController = null;
  }
}

function handleInterruptSync() {
  syncAbortController?.abort();
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
            <p class="stat-card__label">Members</p>
            <div class="stat-card__value">{{ dbStatus.memberCount }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">Handles</p>
            <div class="stat-card__value">{{ dbStatus.handleCount }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">Problem Status</p>
            <div class="stat-card__value">{{ dbStatus.statusCount }}</div>
          </div>
          <div class="stat-card">
            <p class="stat-card__label">Catalog Imported</p>
            <div class="stat-card__value" style="font-size: 1rem">
              {{ formatDateTime(dbStatus.lastCatalogImportAt) }}
            </div>
          </div>
        </div>

        <div class="member-toolbar">
          <div class="member-toolbar__actions">
            <button class="button button--ghost" :disabled="loading" @click="syncing ? handleInterruptSync() : handleSyncMembers()">
              {{ syncing ? "Interrupt Sync" : "One-Click Sync" }}
            </button>
            <RouterLink to="/members/new" class="button">
              Add Member
            </RouterLink>
          </div>
          <p v-if="dbStatus" class="muted tiny">
            上次 catalog 更新：{{ formatDateTime(dbStatus.lastCatalogImportAt) }}
          </p>
        </div>

        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>

        <div v-if="loading" class="notice">loading local members...</div>
        <div v-else-if="syncProgress" class="notice" style="margin-bottom: 16px">
          <strong>{{ syncProgress.currentIndex }}/{{ syncProgress.totalMemberCount }}</strong>
          <span style="margin-left: 8px">
            {{ syncProgress.displayName }}<template v-if="syncProgress.handle"> / {{ syncProgress.handle }}</template>
          </span>
        </div>
        <div v-if="!loading && !people.length" class="notice">
          本地数据库里还没有成员。下一步接入 Codeforces / QOJ 导入后，这里会显示本地 member、handle 和题目状态。
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
                <p class="eyebrow">Member</p>
                <h3>{{ person.displayName }}</h3>
                <div class="inline-tags" style="margin-top: 10px">
                  <span class="tag tag--neutral">{{ person.providerCount }} providers</span>
                  <span class="tag tag--neutral">{{ person.handleCount }} handles</span>
                  <span class="tag tag--neutral">{{ person.totalProblemCount }} total</span>
                </div>
              </div>
              <div class="member-card__actions">
                <span class="button member-card__detail-button">查看详情</span>
              </div>
            </div>

            <div class="member-card__stats">
              <div class="member-card__stat">
                <span class="member-card__stat-label">Solved</span>
                <strong>{{ person.solvedCount }}</strong>
              </div>
              <div class="member-card__stat">
                <span class="member-card__stat-label">Attempted</span>
                <strong>{{ person.attemptedCount }}</strong>
              </div>
              <div class="member-card__stat">
                <span class="member-card__stat-label">Last Sync</span>
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
