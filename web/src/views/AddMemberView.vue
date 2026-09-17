<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

import { importCodeforcesMember } from "../lib/codeforces";
import { emitMemberMutated } from "../lib/member-events";
import { linkQojMember } from '../lib/qoj';
import { useQojSyncStore } from '../stores/qoj-sync';
const qojSync=useQojSyncStore();

const router = useRouter();
const submitting = ref(false);
const error = ref("");
const feedback = ref("");

const memberForm = ref({
  memberId: "",
  platform: "codeforces" as "codeforces" | "qoj",
  handle: "",
});

const submitLabel = computed(() =>
  memberForm.value.platform === "codeforces" ? "导入并同步 Codeforces" : qojSync.useUserscript ? '添加并同步 QOJ' : '添加并手动导入 QOJ',
);

async function handleSubmit() {
  const memberId = memberForm.value.memberId.trim();
  const handle = memberForm.value.handle.trim();
  if (!memberId || !handle) {
    error.value = "名称和 Handle 不能为空";
    return;
  }

  submitting.value = true;
  error.value = "";
  feedback.value = "";

  try {
    if (memberForm.value.platform === "codeforces") {
      await importCodeforcesMember({
        memberId,
        handle,
      });
      emitMemberMutated();
      await router.replace({ name: "members" });
      return;
    }

    await linkQojMember(memberId,handle);
    emitMemberMutated();
    await router.replace({name:'members'});
    await qojSync.sync(true,handle);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "处理成员来源失败";
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
            <p class="eyebrow">成员来源</p>
            <h2>添加成员</h2>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="add-member-id">名称</label>
            <input id="add-member-id" v-model="memberForm.memberId" placeholder="alice" />
          </div>

          <div class="field">
            <label for="add-member-platform">来源平台</label>
            <select id="add-member-platform" v-model="memberForm.platform">
              <option value="codeforces">Codeforces</option>
              <option value="qoj">QOJ</option>
            </select>
          </div>

          <div class="field">
            <label for="add-member-handle">Handle</label>
            <input
              id="add-member-handle"
              v-model="memberForm.handle"
              :placeholder="memberForm.platform === 'codeforces' ? 'tourist' : 'Qingyu'"
            />
          </div>
        </div>

        <div class="actions">
          <button class="button" :disabled="submitting || (memberForm.platform==='qoj' && (!qojSync.modeLoaded || qojSync.busy))" @click="handleSubmit">
            {{ submitting ? "处理中..." : submitLabel }}
          </button>
        </div>

        <p class="muted tiny" style="margin-top: 16px">
          {{ memberForm.platform==='codeforces' ? '通过 Codeforces API 同步做题记录。' : qojSync.useUserscript ? 'QOJ 使用油猴脚本同步，可在管理页切换为手动导入。' : 'QOJ 使用手动导入，可在管理页启用油猴脚本。' }}
        </p>

        <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
