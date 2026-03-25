<script setup lang="ts">
import { onMounted, ref } from "vue";

import { fetchMemberPeople, syncMember, type MemberPerson } from "../lib/api";

const people = ref<MemberPerson[]>([]);
const loading = ref(false);
const syncingPersonKey = ref("");
const error = ref("");
const feedback = ref("");

function formatDateTime(value: string) {
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
    people.value = await fetchMemberPeople();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to load members";
  } finally {
    loading.value = false;
  }
}

async function syncPerson(person: MemberPerson) {
  syncingPersonKey.value = person.local_member_key;
  error.value = "";
  feedback.value = "";
  try {
    let totalStatusCount = 0;
    for (const handle of person.handles) {
      const payload = await syncMember({
        provider_key: handle.provider_key,
        local_member_key: person.local_member_key,
        provider_handle: handle.provider_handle,
        display_name: person.display_name ?? undefined,
      });
      totalStatusCount += Number(payload.status_count ?? 0);
    }
    feedback.value = `synced ${person.local_member_key} across ${person.handles.length} handles with ${totalStatusCount} problem states`;
    await loadMembers();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to sync member";
  } finally {
    syncingPersonKey.value = "";
  }
}

onMounted(loadMembers);
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div class="panel__header">
          <div class="panel__title">
            <p class="eyebrow">Tracked Members</p>
            <h2>队员历史题目状态</h2>
            <p class="muted">
              同一个 local member key 代表同一个本地队员；以后接多 provider 时，会按这个 key 合并成同一个人。
            </p>
          </div>
        </div>
        <div class="actions">
          <button class="button button--ghost" :disabled="loading" @click="loadMembers">
            {{ loading ? "Refreshing..." : "Refresh List" }}
          </button>
        </div>

        <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>

        <div v-if="loading" class="notice">loading members...</div>
        <div v-else-if="!people.length" class="notice">
          还没有 tracked member，先去 Manage 页面添加一个 Codeforces handle。
        </div>
        <div v-else class="list-grid">
          <article
            v-for="person in people"
            :key="person.local_member_key"
            class="member-card"
          >
            <div class="member-card__top">
              <div>
                <p class="eyebrow">{{ person.provider_count }} providers / {{ person.binding_count }} handles</p>
                <h3>{{ person.display_name || person.local_member_key }}</h3>
                <div class="inline-meta tiny muted">
                  <span>local: {{ person.local_member_key }}</span>
                  <span>{{ person.solved_count }} solved</span>
                  <span>{{ person.tried_count }} tried-only</span>
                  <span>last sync {{ formatDateTime(person.last_synced_at) }}</span>
                </div>
              </div>
              <div class="member-card__actions">
                <span class="tag tag--neutral">{{ person.binding_status }}</span>
                <button
                  type="button"
                  class="button button--ghost"
                  :disabled="syncingPersonKey === person.local_member_key"
                  @click="syncPerson(person)"
                >
                  {{ syncingPersonKey === person.local_member_key ? "Syncing..." : "Sync" }}
                </button>
              </div>
            </div>

            <div class="inline-tags" style="margin-top: 16px">
              <div
                v-for="handle in person.handles"
                :key="handle.identity_binding_id"
                class="tag member-handle-tag"
              >
                <span>{{ handle.provider_key }} / {{ handle.provider_handle }}</span>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>
