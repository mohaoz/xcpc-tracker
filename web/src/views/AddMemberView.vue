<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import { importCodeforcesMember } from "../lib/codeforces";
import { emitMemberMutated } from "../lib/member-events";
import { importQojMember } from "../lib/qoj";

const router = useRouter();
const submitting = ref(false);
const error = ref("");
const feedback = ref("");

const memberForm = ref({
  provider: "codeforces" as "codeforces" | "qoj",
  memberId: "",
  providerHandle: "",
  displayName: "",
  qojSolvedIds: "",
  qojAttemptedIds: "",
});

function splitProblemIds(raw: string) {
  return raw
    .split(/[\s,\n\r\t]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

async function submitMemberImport() {
  if (!memberForm.value.memberId.trim() || !memberForm.value.providerHandle.trim()) {
    error.value = "member id and handle are required";
    return;
  }

  submitting.value = true;
  error.value = "";
  feedback.value = "";
  try {
    if (memberForm.value.provider === "codeforces") {
      await importCodeforcesMember({
        memberId: memberForm.value.memberId.trim(),
        handle: memberForm.value.providerHandle.trim(),
        displayName: memberForm.value.displayName.trim() || undefined,
      });
    } else {
      await importQojMember({
        memberId: memberForm.value.memberId.trim(),
        handle: memberForm.value.providerHandle.trim(),
        displayName: memberForm.value.displayName.trim() || undefined,
        solvedProblemIds: splitProblemIds(memberForm.value.qojSolvedIds),
        attemptedProblemIds: splitProblemIds(memberForm.value.qojAttemptedIds),
      });
    }
    emitMemberMutated();
    await router.replace({ name: "members" });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to import member";
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
            <p class="eyebrow">Member Import</p>
            <h2>Add Member</h2>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="add-member-provider">Provider</label>
            <select id="add-member-provider" v-model="memberForm.provider" class="input-select">
              <option value="codeforces">Codeforces API</option>
              <option value="qoj">QOJ userscript snapshot</option>
            </select>
          </div>
          <div class="field">
            <label for="add-member-id">成员名</label>
            <input id="add-member-id" v-model="memberForm.memberId" placeholder="alice" />
          </div>
          <div class="field">
            <label for="add-member-handle">
              {{ memberForm.provider === "codeforces" ? "Codeforces 账户名" : "QOJ 账户名" }}
            </label>
            <input
              id="add-member-handle"
              v-model="memberForm.providerHandle"
              :placeholder="memberForm.provider === 'codeforces' ? 'tourist' : 'Rainybunny'"
            />
          </div>
          <div class="field">
            <label for="add-member-name">显示名称（可选）</label>
            <input id="add-member-name" v-model="memberForm.displayName" placeholder="Alice" />
          </div>
          <div v-if="memberForm.provider === 'qoj'" class="field">
            <label for="add-member-qoj-solved">QOJ AC 题号（空格/逗号分隔）</label>
            <textarea id="add-member-qoj-solved" v-model="memberForm.qojSolvedIds" rows="4" placeholder="1001, 1002, 1003" />
          </div>
          <div v-if="memberForm.provider === 'qoj'" class="field">
            <label for="add-member-qoj-attempted">QOJ 尝试过题号（空格/逗号分隔）</label>
            <textarea id="add-member-qoj-attempted" v-model="memberForm.qojAttemptedIds" rows="4" placeholder="1004, 1005" />
          </div>
        </div>

        <div class="actions">
          <button class="button" :disabled="submitting" @click="submitMemberImport">
            {{ submitting ? "导入中..." : (memberForm.provider === "codeforces" ? "导入 Codeforces 成员" : "导入 QOJ 成员快照") }}
          </button>
        </div>

        <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
