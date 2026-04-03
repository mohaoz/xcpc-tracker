<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import { importCodeforcesMember } from "../lib/codeforces";
import { emitMemberMutated } from "../lib/member-events";

const router = useRouter();
const submitting = ref(false);
const error = ref("");
const feedback = ref("");
const copyFeedback = ref("");

const qojBrowserScript = `(() => {
  function cleanText(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function extractHandle() {
    const profileMatch = location.pathname.match(/\\/user\\/profile\\/([^/?#]+)/i);
    if (profileMatch) {
      return decodeURIComponent(profileMatch[1]);
    }
    const headingLink = document.querySelector('a.uoj-username[href*="/user/profile/"]');
    if (!headingLink) {
      return "";
    }
    const href = headingLink.getAttribute("href") || "";
    const hrefMatch = href.match(/\\/user\\/profile\\/([^/?#]+)/i);
    return hrefMatch ? decodeURIComponent(hrefMatch[1]) : "";
  }

  function extractDisplayName() {
    const heading = document.querySelector(".card-body h2 a.uoj-username");
    return cleanText(heading?.textContent);
  }

  function extractProblemIds(headingText) {
    const headings = Array.from(document.querySelectorAll(".list-group-item-heading"));
    const heading = headings.find((node) => cleanText(node.textContent).includes(headingText));
    if (!heading) {
      return [];
    }
    const container = heading.parentElement;
    const links = Array.from(container?.querySelectorAll('a[href*="/problem/"]') ?? []);
    const seen = new Set();
    const result = [];

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\\/problem\\/(\\d+)/i);
      if (!match) {
        continue;
      }
      const problemId = match[1];
      if (seen.has(problemId)) {
        continue;
      }
      seen.add(problemId);
      result.push(problemId);
    }

    return result;
  }

  const handle = extractHandle();
  if (!handle) {
    throw new Error("Could not determine QOJ handle from this page");
  }

  const memberId = window.prompt("Local member id", handle) || handle;
  const fallbackDisplayName = extractDisplayName() || handle;
  const displayName = window.prompt("Display name", fallbackDisplayName) || fallbackDisplayName;
  const solved = extractProblemIds("Accepted problems");
  const attempted = extractProblemIds("Tried problems").filter((problemId) => !solved.includes(problemId));

  const payload = {
    provider: "qoj",
    exported_at: new Date().toISOString(),
    members: [
      {
        member_id: cleanText(memberId) || handle,
        handle,
        display_name: cleanText(displayName) || handle,
        profile_url: location.href,
        solved,
        attempted,
      },
    ],
  };
  const text = JSON.stringify(payload, null, 2);

  async function main() {
    try {
      await navigator.clipboard.writeText(text);
      console.log("已复制到剪贴板", {
        handle,
        memberId: payload.members[0].member_id,
        solvedCount: solved.length,
        attemptedCount: attempted.length,
      });
      alert("QOJ 成员 JSON 已复制到剪贴板。回到 xcpc-tracker 的 Manage 页面直接粘贴导入。");
    } catch (error) {
      console.warn("复制失败，回退为下载 JSON 文件", error);
      const blob = new Blob([text], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = \`qoj-member-\${handle}.json\`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      alert("剪贴板复制失败，已回退为下载 JSON 文件。");
    }
  }

  main();

  console.log("导出完成", {
    handle,
    memberId: payload.members[0].member_id,
    solvedCount: solved.length,
    attemptedCount: attempted.length,
  });
})();`;

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
    await router.replace({ name: "members" });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to import Codeforces member";
  } finally {
    submitting.value = false;
  }
}

async function copyQojBrowserScript() {
  copyFeedback.value = "";
  try {
    await navigator.clipboard.writeText(qojBrowserScript);
    copyFeedback.value = "QOJ 脚本已复制";
  } catch {
    copyFeedback.value = "复制失败，请手动选中下面代码";
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
            <label for="add-member-id">成员名</label>
            <input id="add-member-id" v-model="memberForm.memberId" placeholder="alice" />
          </div>
          <div class="field">
            <label for="add-member-handle">Codeforces 账户名</label>
            <input id="add-member-handle" v-model="memberForm.providerHandle" placeholder="tourist" />
          </div>
          <div class="field">
            <label for="add-member-name">显示名称（可选）</label>
            <input id="add-member-name" v-model="memberForm.displayName" placeholder="Alice" />
          </div>
        </div>

        <div class="actions">
          <button class="button" :disabled="submitting" @click="submitCodeforcesImport">
            {{ submitting ? "导入中..." : "导入 Codeforces 成员" }}
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
            <p class="eyebrow">QOJ</p>
            <h2>Browser Script</h2>
          </div>
        </div>

        <p class="muted">
          在 QOJ 用户主页打开浏览器控制台，粘贴下面脚本运行。它会优先把成员 JSON 复制到剪贴板，然后你可以直接回到 Manage 页面粘贴导入。
        </p>

        <div class="actions">
          <button class="button button--ghost" type="button" @click="copyQojBrowserScript">
            复制脚本
          </button>
        </div>

        <p v-if="copyFeedback" class="notice" style="margin-top: 16px">{{ copyFeedback }}</p>

        <div class="field" style="margin-top: 16px">
          <label for="qoj-browser-script">QOJ 成员导出脚本</label>
          <textarea
            id="qoj-browser-script"
            class="input-textarea"
            :value="qojBrowserScript"
            readonly
            rows="18"
            spellcheck="false"
          />
        </div>
      </div>
    </section>
  </div>
</template>
