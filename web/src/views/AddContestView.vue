<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import ContestCatalogEditor from "../components/ContestCatalogEditor.vue";
import { aggregateAliasesFromSources } from "../lib/catalog-sources";
import { emitCatalogMutated } from "../lib/catalog-events";
import { addManualCatalogContest, listCatalogContestsFromDb } from "../lib/local-db";
import type { LocalCatalogContestRecord, LocalCatalogProblemRecord } from "../lib/local-model";

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
    url?: string;
    provider_contest_id?: string;
    provider_problem_id?: string;
    source_title?: string;
    label?: string;
  }>;
  notes: string | null;
  problems?: Array<{
    ordinal: string;
    title: string;
    aliases?: string[];
    sources: Array<{
      provider: string;
      kind: string;
      url?: string;
      provider_contest_id?: string;
      provider_problem_id?: string;
      source_title?: string;
      label?: string;
    }>;
  }>;
}) {
  if (!payload.title.trim()) {
    error.value = "contest title is required";
    return;
  }
  submitting.value = true;
  error.value = "";
  feedback.value = "";
  try {
    const targetContestId = crypto.randomUUID();
    const problems: LocalCatalogProblemRecord[] = (payload.problems ?? []).map((problem) => ({
      problemId: `${targetContestId}:${problem.ordinal}`,
      contestId: targetContestId,
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: aggregateAliasesFromSources(problem.title, problem.aliases ?? [], problem.sources),
      sources: problem.sources,
      sourceKind: "catalog",
    }));
    const contestTitle = payload.title.trim();
    const contest: LocalCatalogContestRecord = {
      contestId: targetContestId,
      title: contestTitle,
      aliases: aggregateAliasesFromSources(contestTitle, payload.aliases, payload.sources),
      tags: payload.tags,
      startAt: null,
      curationStatus: problems.length ? "problem_listed" : "contest_stub",
      problemIds: problems.map((problem) => problem.problemId),
      sources: payload.sources,
      notes: payload.notes,
      generatedFrom: "manual",
    };
    await addManualCatalogContest({ contest, problems });
    emitCatalogMutated();
    await router.push(`/contests/${targetContestId}`);
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
