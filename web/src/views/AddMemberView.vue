<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import { importCodeforcesMember } from "../lib/codeforces";
import { emitMemberMutated } from "../lib/member-events";

const router = useRouter();
const submitting = ref(false);
const error = ref("");
const feedback = ref("");

const memberForm = ref({
  memberId: "",
  providerHandle: "",
  displayName: "",
});

async function submitCodeforcesImport() {
  if (!memberForm.value.memberId.trim() || !memberForm.value.providerHandle.trim()) {
    error.value = "member id and Codeforces handle are required";
    return;
  }

  submitting.value = true;
  error.value = "";
  feedback.value = "";
  try {
    await importCodeforcesMember({
      memberId: memberForm.value.memberId.trim(),
      handle: memberForm.value.providerHandle.trim(),
      displayName: memberForm.value.displayName.trim() || undefined,
    });
    emitMemberMutated();
    await router.push("/members");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to import Codeforces member";
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
            <p class="eyebrow">Codeforces</p>
            <h2>Add Member</h2>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="add-member-id">Member ID</label>
            <input id="add-member-id" v-model="memberForm.memberId" placeholder="alice" />
          </div>
          <div class="field">
            <label for="add-member-handle">Codeforces Handle</label>
            <input id="add-member-handle" v-model="memberForm.providerHandle" placeholder="tourist" />
          </div>
          <div class="field">
            <label for="add-member-name">Display Name</label>
            <input id="add-member-name" v-model="memberForm.displayName" placeholder="Alice" />
          </div>
        </div>

        <div class="actions">
          <button class="button" :disabled="submitting" @click="submitCodeforcesImport">
            {{ submitting ? "Importing..." : "Import Codeforces Member" }}
          </button>
        </div>

        <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
