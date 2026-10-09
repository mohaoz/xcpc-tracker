<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { liveQuery, type Subscription } from "dexie";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { importCodeforcesMember } from "../lib/codeforces";
import { useQojSyncStore } from '../stores/qoj-sync';
const qojSync = useQojSyncStore();
import { useContestListStore } from "../stores/contest-list";
const selection = useContestListStore();
import { emitMemberMutated } from "../lib/member-events";
import {
  getMemberPersonFromDb,
  localDb,
  listMemberHandleProblemCountsFromDb,
  softDeleteMember,
  softDeleteMemberHandle,
} from "../lib/local-db";
import type { LocalMemberPerson } from "../lib/local-model";

const route = useRoute();
const router = useRouter();
const person = ref<LocalMemberPerson | null>(null);
const loading = ref(false);
const error = ref("");
const feedback = ref("");
const syncWarning = ref("");
const syncingHandleId = ref("");
const deletingHandleId = ref("");
const deletingMemberId = ref("");
const handleProblemCounts = ref<Record<string, {
  solvedCount: number;
  attemptedCount: number;
  totalCount: number;
}>>({});
let memberSubscription: Subscription | null = null;
let pageGeneration = 0;
let disposed = false;

const memberId = computed(() => String(route.params.memberId ?? ""));

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

function isHandleSyncable(provider: string) {
  return provider === "codeforces" || provider === 'qoj';
}

function getHandleProblemCount(handleId: string) {
  return handleProblemCounts.value[handleId] ?? {
    solvedCount: 0,
    attemptedCount: 0,
    totalCount: 0,
  };
}

function loadMember() {
  const id = memberId.value;
  const generation = ++pageGeneration;
  const isCurrent = () => !disposed && generation === pageGeneration && id === memberId.value;
  memberSubscription?.unsubscribe();
  memberSubscription = null;
  person.value = null;
  handleProblemCounts.value = {};
  error.value = "";
  loading.value = !!id;
  if (!id || disposed) return;

  // Read both panels from one transaction and let Dexie refresh them on
  // same-tab and cross-tab writes, including member deletion and rebinding.
  memberSubscription = liveQuery(() => localDb.transaction('r',
    localDb.members, localDb.memberHandles, localDb.memberProblemStatus,
    () => Promise.all([getMemberPersonFromDb(id), listMemberHandleProblemCountsFromDb(id)]),
  )).subscribe({
    next([personPayload, handleCountsPayload]) {
      if (!isCurrent()) return;
      person.value = personPayload;
      handleProblemCounts.value = personPayload ? handleCountsPayload : {};
      error.value = personPayload ? "" : "member not found";
      loading.value = false;
    },
    error(caught) {
      if (!isCurrent()) return;
      person.value = null;
      handleProblemCounts.value = {};
      error.value = caught instanceof Error ? caught.message : "加载成员失败";
      loading.value = false;
    },
  });
}

function currentPageGuard() {
  const id = memberId.value;
  const generation = pageGeneration;
  return () => !disposed && generation === pageGeneration && id === memberId.value;
}

async function handleSyncHandle(handle: LocalMemberPerson["handles"][number]) {
  if (!person.value || !isHandleSyncable(handle.provider)) {
    return;
  }

  const isCurrent = currentPageGuard();
  const target = person.value;
  syncingHandleId.value = handle.handleId;
  error.value = "";
  feedback.value = "";
  syncWarning.value = "";
  try {
    if (handle.provider === 'qoj') {
      await qojSync.sync(true, handle.handle);
      if (isCurrent()) feedback.value = qojSync.useUserscript ? qojSync.message : '';
      return;
    }
    await importCodeforcesMember({
      memberId: target.memberId,
      handle: handle.handle,
      displayName: target.displayName,
    }, {requireExisting:true});
    emitMemberMutated();
    if (!isCurrent()) return;
    feedback.value = `已同步 ${handle.provider} / ${handle.handle}`;
  } catch (caught) {
    if (!isCurrent()) return;
    error.value = caught instanceof Error ? caught.message : "同步账号失败";
    syncWarning.value = "Codeforces API 只能读取公开数据；非公开比赛或私有 Gym 的记录可能缺失。已有记录不会被清空。";
  } finally {
    if (isCurrent()) syncingHandleId.value = "";
  }
}

async function handleDeleteHandle(handle: LocalMemberPerson["handles"][number]) {
  const confirmed = window.confirm(`确定要删除账号「${handle.provider} / ${handle.handle}」吗？\n\n删除后可通过重新绑定同一账号恢复。`);
  if (!confirmed) {
    return;
  }

  const isCurrent = currentPageGuard();
  deletingHandleId.value = handle.handleId;
  error.value = "";
  feedback.value = "";
  try {
    await softDeleteMemberHandle(handle.handleId);
    emitMemberMutated();
    if (!isCurrent()) return;
    feedback.value = `已删除 ${handle.provider} / ${handle.handle}`;
  } catch (caught) {
    if (!isCurrent()) return;
    error.value = caught instanceof Error ? caught.message : "删除账号失败";
  } finally {
    if (isCurrent()) deletingHandleId.value = "";
  }
}

async function handleDeleteMember() {
  if (!person.value) {
    return;
  }
  const confirmed = window.confirm(`确定要删除成员「${person.value.displayName}」吗？\n\n删除后可通过添加成员页面重新创建同名成员恢复。`);
  if (!confirmed) {
    return;
  }

  const isCurrent = currentPageGuard();
  const targetMemberId = person.value.memberId;
  deletingMemberId.value = targetMemberId;
  error.value = "";
  try {
    await softDeleteMember(targetMemberId);
    emitMemberMutated();
    if (isCurrent()) await router.push("/members");
  } catch (caught) {
    if (!isCurrent()) return;
    error.value = caught instanceof Error ? caught.message : "删除成员失败";
  } finally {
    if (isCurrent()) deletingMemberId.value = "";
  }
}

watch(memberId, () => {
  feedback.value = "";
  syncWarning.value = "";
  syncingHandleId.value = "";
  deletingHandleId.value = "";
  deletingMemberId.value = "";
  loadMember();
}, { immediate: true });

onUnmounted(() => {
  disposed = true;
  pageGeneration++;
  memberSubscription?.unsubscribe();
  memberSubscription = null;
});
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div class="panel__header">
          <div class="panel__title">
            <p class="eyebrow">成员</p>
            <h2>{{ person?.displayName ?? "成员详情" }}</h2>
          </div>
          <div class="actions" style="margin-top: 0">
            <RouterLink v-if="person" :to="{ path: '/contests', query: { members: person.memberId } }" class="button" @click="selection.selectOnly([person.memberId])">
              查看 TA 的比赛
            </RouterLink>
            <RouterLink to="/members" class="button button--ghost">
              返回成员列表
            </RouterLink>
          </div>
        </div>

        <div v-if="loading" class="notice">正在加载成员...</div>
        <template v-else-if="person">
          <div class="stat-grid" style="margin-bottom: 18px">
            <div class="stat-card">
              <p class="stat-card__label">成员名</p>
              <div class="stat-card__value" style="font-size: 1rem">{{ person.memberId }}</div>
            </div>
            <div class="stat-card">
              <p class="stat-card__label">已做</p>
              <div class="stat-card__value">{{ person.solvedCount }}</div>
            </div>
            <div class="stat-card">
              <p class="stat-card__label">尝试过</p>
              <div class="stat-card__value">{{ person.attemptedCount }}</div>
            </div>
            <div class="stat-card">
              <p class="stat-card__label">上次同步</p>
              <div class="stat-card__value" style="font-size: 1rem">{{ formatDateTime(person.lastSyncedAt) }}</div>
            </div>
          </div>

          <section class="panel" style="box-shadow: none; margin-bottom: 18px">
            <div class="panel__body">
              <div class="panel__header" style="margin-bottom: 14px">
                <div class="panel__title">
                  <p class="eyebrow">账号</p>
                  <h3>账户与同步</h3>
                </div>
                <RouterLink :to="{ path: '/members/new', query: { member: person.memberId } }" class="button button--ghost">
                  添加账号
                </RouterLink>
              </div>
              <div class="list-grid">
                <div
                  v-for="handle in person.handles"
                  :key="handle.handleId"
                  class="contest-source-card"
                  :style="deletingHandleId === handle.handleId ? 'border-color: rgba(185, 28, 28, 0.4); background: rgba(185, 28, 28, 0.06);' : ''"
                >
                  <div class="contest-card__top">
                    <div>
                      <p class="eyebrow">{{ handle.provider }}</p>
                      <h3>{{ handle.handle }}</h3>
                    </div>
                    <span class="muted tiny">{{ formatDateTime(handle.updatedAt) }}</span>
                  </div>
                  <div class="inline-tags" style="margin-top: 12px">
                    <span class="tag tag--neutral">
                      {{ getHandleProblemCount(handle.handleId).totalCount }} 题
                    </span>
                    <span class="tag tag--neutral">
                      已做 {{ getHandleProblemCount(handle.handleId).solvedCount }}
                    </span>
                    <span class="tag tag--neutral">
                      尝试 {{ getHandleProblemCount(handle.handleId).attemptedCount }}
                    </span>
                  </div>
                  <div class="actions" style="margin-top: 12px">
                    <button
                      class="button button--ghost"
                      :disabled="!isHandleSyncable(handle.provider) || syncingHandleId === handle.handleId || (handle.provider === 'qoj' && (!qojSync.modeLoaded || qojSync.busy))"
                      @click="handleSyncHandle(handle)"
                    >
                      {{ syncingHandleId === handle.handleId ? "同步中..." : handle.provider === 'qoj' && !qojSync.useUserscript ? '手动导入' : "同步账号" }}
                    </button>
                    <button
                      class="button button--ghost"
                      :disabled="deletingHandleId === handle.handleId"
                      @click="handleDeleteHandle(handle)"
                    >
                      {{ deletingHandleId === handle.handleId ? "删除中..." : "删除账号" }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="panel" style="box-shadow: none">
            <div class="panel__body">
              <div class="panel__title" style="margin-bottom: 14px">
                <p class="eyebrow">危险操作</p>
                <h3>成员删除</h3>
              </div>
              <div class="actions">
                <button class="button button--ghost" :disabled="deletingMemberId === person.memberId" @click="handleDeleteMember">
                  {{ deletingMemberId === person.memberId ? "删除中..." : "删除成员" }}
                </button>
              </div>
            </div>
          </section>

          <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
          <p v-if="syncWarning" class="notice" style="margin-top: 16px">{{ syncWarning }}</p>
        </template>

        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
