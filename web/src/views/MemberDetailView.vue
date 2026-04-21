<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { importCodeforcesMember } from "../lib/codeforces";
import { emitMemberMutated, subscribeMemberMutated } from "../lib/member-events";
import { getMemberPersonFromDb, softDeleteMember, softDeleteMemberHandle } from "../lib/local-db";
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
let unsubscribeMemberMutated: (() => void) | null = null;

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
  return provider === "codeforces";
}

async function loadMember() {
  if (!memberId.value) {
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    person.value = await getMemberPersonFromDb(memberId.value);
    if (!person.value) {
      throw new Error("member not found");
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "加载成员失败";
  } finally {
    loading.value = false;
  }
}

async function handleSyncHandle(handle: LocalMemberPerson["handles"][number]) {
  if (!person.value || !isHandleSyncable(handle.provider)) {
    return;
  }

  syncingHandleId.value = handle.handleId;
  error.value = "";
  feedback.value = "";
  syncWarning.value = "";
  try {
    await importCodeforcesMember({
      memberId: person.value.memberId,
      handle: handle.handle,
      displayName: person.value.displayName,
    });
    emitMemberMutated();
    await loadMember();
    feedback.value = `已同步 ${handle.provider} / ${handle.handle}`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "同步账号失败";
    syncWarning.value = "如果这是 private Codeforces 数据，请先在 Manage 页面保存 API 凭据，并确认当前账号本身有访问权限。即使具备权限，返回的数据也可能仍然不完整。";
  } finally {
    syncingHandleId.value = "";
  }
}

async function handleDeleteHandle(handle: LocalMemberPerson["handles"][number]) {
  const confirmed = window.confirm(`删除 handle "${handle.provider} / ${handle.handle}"？`);
  if (!confirmed) {
    return;
  }

  deletingHandleId.value = handle.handleId;
  error.value = "";
  feedback.value = "";
  try {
    await softDeleteMemberHandle(handle.handleId);
    emitMemberMutated();
    await loadMember();
    feedback.value = `已删除 ${handle.provider} / ${handle.handle}`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "删除账号失败";
  } finally {
    deletingHandleId.value = "";
  }
}

async function handleDeleteMember() {
  if (!person.value) {
    return;
  }
  const confirmed = window.confirm(`删除成员 "${person.value.displayName}"？`);
  if (!confirmed) {
    return;
  }

  deletingMemberId.value = person.value.memberId;
  error.value = "";
  try {
    await softDeleteMember(person.value.memberId);
    emitMemberMutated();
    await router.push("/members");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "删除成员失败";
  } finally {
    deletingMemberId.value = "";
  }
}

watch(memberId, () => {
  void loadMember();
});

onMounted(() => {
  unsubscribeMemberMutated = subscribeMemberMutated(() => {
    void loadMember();
  });
  void loadMember();
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
        <div class="panel__header">
          <div class="panel__title">
            <p class="eyebrow">成员</p>
            <h2>{{ person?.displayName ?? "成员详情" }}</h2>
          </div>
          <RouterLink to="/members" class="button button--ghost">
            返回成员列表
          </RouterLink>
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
              <div class="panel__title" style="margin-bottom: 14px">
                <p class="eyebrow">账号</p>
                <h3>账户与同步</h3>
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
                  <div class="actions" style="margin-top: 12px">
                    <button
                      class="button button--ghost"
                      :disabled="!isHandleSyncable(handle.provider) || syncingHandleId === handle.handleId"
                      @click="handleSyncHandle(handle)"
                    >
                      {{ syncingHandleId === handle.handleId ? "同步中..." : "同步账号" }}
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
