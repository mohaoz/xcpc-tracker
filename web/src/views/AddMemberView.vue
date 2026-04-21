<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

import { importCodeforcesMember } from "../lib/codeforces";
import { emitMemberMutated } from "../lib/member-events";
import { buildQojBrowserScript } from "../lib/qoj-member-script";

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
  memberForm.value.platform === "codeforces" ? "导入并同步 Codeforces" : "打开 QOJ 页面并复制脚本",
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

    const script = buildQojBrowserScript({ memberId, handle });
    await navigator.clipboard.writeText(script);
    window.open(`https://qoj.ac/user/profile/${encodeURIComponent(handle)}`, "_blank", "noopener,noreferrer");
    await router.replace({ name: "manage", query: { import: "member" } });
    feedback.value = "QOJ 脚本已复制，并已打开对应用户页。当前页面已跳到 Manage，执行脚本后直接粘贴导入即可。";
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
          <button class="button" :disabled="submitting" @click="handleSubmit">
            {{ submitting ? "处理中..." : submitLabel }}
          </button>
        </div>

        <p class="muted tiny" style="margin-top: 16px">
          `Codeforces` 会直接用 API 拉取题目状态；`QOJ` 会复制浏览器脚本并打开用户主页，然后在目标页控制台执行脚本。
        </p>

        <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
