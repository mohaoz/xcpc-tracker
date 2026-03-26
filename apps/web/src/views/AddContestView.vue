<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import ContestCatalogEditor from "../components/ContestCatalogEditor.vue";
import { addManualCatalogContest, listCatalogContestsFromDb } from "../lib/local-db";
import type { LocalCatalogContestRecord } from "../lib/local-model";

const router = useRouter();
const submitting = ref(false);
const error = ref("");
const feedback = ref("");
const existingCatalogTags = ref<string[]>([]);

async function loadExistingTags() {
  const contests = await listCatalogContestsFromDb();
  existingCatalogTags.value = [...new Set(contests.flatMap((contest) => contest.tags))].sort((left, right) =>
    left.localeCompare(right),
  );
}

async function handleAddManualContest(payload: {
  title: string;
  aliases: string[];
  tags: string[];
  sources: Array<{
    provider: string;
    kind: string;
    url: string;
    provider_contest_id?: string;
    provider_problem_id?: string;
    label?: string;
  }>;
  notes: string | null;
}) {
  if (!payload.title.trim()) {
    error.value = "contest title is required";
    return;
  }
  if (!payload.sources.length) {
    error.value = "at least one source is required";
    return;
  }

  submitting.value = true;
  error.value = "";
  feedback.value = "";
  try {
    const contestId = crypto.randomUUID();
    const contest: LocalCatalogContestRecord = {
      contestId,
      title: payload.title.trim(),
      aliases: payload.aliases,
      tags: payload.tags,
      startAt: null,
      curationStatus: "contest_stub",
      problemIds: [],
      sources: payload.sources,
      notes: payload.notes,
      generatedFrom: "manual",
    };
    await addManualCatalogContest({ contest });
    await router.push(`/contests/${contestId}`);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to add contest";
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void loadExistingTags();
});
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div class="panel__header">
          <div class="panel__title">
            <p class="eyebrow">Catalog</p>
            <h2>Add Contest</h2>
          </div>
        </div>

        <ContestCatalogEditor
          :existing-tags="existingCatalogTags"
          :busy="submitting"
          submit-label="Add Contest"
          @submit="handleAddManualContest"
        />

        <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
