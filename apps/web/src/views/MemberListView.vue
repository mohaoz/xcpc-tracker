<script setup lang="ts">
import { onMounted, ref } from "vue";

import { fetchMemberPeople, syncMember, type MemberPerson } from "../lib/api";

const people = ref<MemberPerson[]>([]);
const loading = ref(false);
const submitting = ref(false);
const error = ref("");
const feedback = ref("");

const form = ref({
  localMemberKey: "",
  providerHandle: "",
  displayName: "",
});

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

async function submitMember() {
  if (!form.value.localMemberKey.trim() || !form.value.providerHandle.trim()) {
    error.value = "local member key and provider handle are required";
    return;
  }

  submitting.value = true;
  error.value = "";
  feedback.value = "";
  try {
    const payload = await syncMember({
      provider_key: "codeforces",
      local_member_key: form.value.localMemberKey.trim(),
      provider_handle: form.value.providerHandle.trim(),
      display_name: form.value.displayName.trim() || undefined,
    });
    feedback.value = `synced ${String(payload.local_member_key)} with ${String(payload.status_count)} problem states`;
    form.value = {
      localMemberKey: "",
      providerHandle: "",
      displayName: "",
    };
    await loadMembers();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to sync member";
  } finally {
    submitting.value = false;
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

        <div class="form-grid">
          <div class="field">
            <label for="local-member-key">Local Member Key</label>
            <input id="local-member-key" v-model="form.localMemberKey" placeholder="alice" />
          </div>
          <div class="field">
            <label for="provider-handle">Codeforces Handle</label>
            <input id="provider-handle" v-model="form.providerHandle" placeholder="tourist" />
          </div>
          <div class="field">
            <label for="display-name">Display Name</label>
            <input id="display-name" v-model="form.displayName" placeholder="Alice" />
          </div>
        </div>

        <div class="actions">
          <button class="button" :disabled="submitting" @click="submitMember">
            {{ submitting ? "Syncing..." : "Sync Member" }}
          </button>
          <button class="button button--ghost" :disabled="loading" @click="loadMembers">
            {{ loading ? "Refreshing..." : "Refresh List" }}
          </button>
        </div>

        <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>

    <section class="panel">
      <div class="panel__body">
        <div class="panel__header">
          <div class="panel__title">
            <p class="eyebrow">Current People</p>
            <h2>{{ people.length }} tracked members</h2>
          </div>
        </div>

        <div v-if="loading" class="notice">loading members...</div>
        <div v-else-if="!people.length" class="notice">
          还没有 tracked member，先同步一个 Codeforces handle。
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
                </div>
              </div>
              <span class="tag tag--neutral">{{ person.binding_status }}</span>
            </div>

            <div class="inline-tags" style="margin-top: 16px">
              <span
                v-for="handle in person.handles"
                :key="handle.identity_binding_id"
                class="tag"
              >
                {{ handle.provider_key }} / {{ handle.provider_handle }}
              </span>
            </div>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>
