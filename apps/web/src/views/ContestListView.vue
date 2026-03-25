<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import {
  exportContests,
  fetchContests,
  importContests,
  syncContest,
  type ContestListItem,
} from "../lib/api";

const contests = ref<ContestListItem[]>([]);
const loading = ref(false);
const submitting = ref(false);
const error = ref("");
const feedback = ref("");
const wholeContestFreshOnly = ref(false);
let latestLoadRequestId = 0;
const importSync = ref(true);
const importFileInput = ref<HTMLInputElement | null>(null);

const syncForm = ref({
  contestUrl: "",
});

const filterForm = ref({
  tags: "",
});

const activeTags = computed(() =>
  filterForm.value.tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean),
);

const visibleContests = computed(() => {
  let nextContests = contests.value;

  if (activeTags.value.length > 0) {
    const required = new Set(activeTags.value.map((tag) => tag.toLocaleLowerCase()));
    nextContests = nextContests.filter((contest) => {
      const contestTags = new Set(contest.tags.map((tag) => tag.toLocaleLowerCase()));
      for (const tag of required) {
        if (!contestTags.has(tag)) {
          return false;
        }
      }
      return true;
    });
  }

  if (!wholeContestFreshOnly.value) {
    return nextContests;
  }

  return nextContests.filter((contest) => {
    const problemCount = contest.problem_count ?? 0;
    const freshProblemCount = contest.fresh_problem_count ?? 0;
    return problemCount > 0 && freshProblemCount === problemCount;
  });
});

async function loadContests() {
  const requestId = ++latestLoadRequestId;
  loading.value = true;
  error.value = "";
  try {
    const nextContests = await fetchContests({
      withCoverage: true,
    });
    if (requestId !== latestLoadRequestId) {
      return;
    }
    contests.value = nextContests;
  } catch (caught) {
    if (requestId !== latestLoadRequestId) {
      return;
    }
    error.value = caught instanceof Error ? caught.message : "failed to load contests";
  } finally {
    if (requestId === latestLoadRequestId) {
      loading.value = false;
    }
  }
}

async function submitSyncContest() {
  if (!syncForm.value.contestUrl.trim()) {
    error.value = "contest url is required";
    return;
  }

  submitting.value = true;
  error.value = "";
  feedback.value = "";
  try {
    const payload = await syncContest({
      provider_key: "codeforces",
      contest_url: syncForm.value.contestUrl.trim(),
    });
    feedback.value = `synced contest ${String(payload.provider_contest_id)} with ${String(payload.problem_count)} problems`;
    syncForm.value.contestUrl = "";
    await loadContests();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to sync contest";
  } finally {
    submitting.value = false;
  }
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function handleExportContests() {
  error.value = "";
  feedback.value = "";
  try {
    const payload = await exportContests();
    downloadJson("xvg-contests.json", payload);
    feedback.value = `exported ${payload.contests.length} contests`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to export contests";
  }
}

async function handleImportContests(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) {
    return;
  }

  submitting.value = true;
  error.value = "";
  feedback.value = "";
  try {
    const text = await file.text();
    const payload = JSON.parse(text) as Record<string, unknown>;
    const result = await importContests({
      payload,
      sync: importSync.value,
    });
    feedback.value =
      `imported ${String(result.imported_contest_count ?? 0)} contests` +
      (importSync.value ? `, synced ${String(result.synced_contest_count ?? 0)}` : "");
    await loadContests();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to import contests";
  } finally {
    submitting.value = false;
    if (importFileInput.value) {
      importFileInput.value.value = "";
    }
  }
}

onMounted(loadContests);
watch(activeTags, loadContests);
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div class="panel__header">
          <div class="panel__title">
            <p class="eyebrow">Contest Intake</p>
            <h2>把比赛拉进本地池子</h2>
            <p class="muted">
              先同步比赛，再用 coverage 摘要判断整场值不值得 VP。
            </p>
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label for="contest-url">Codeforces Gym URL</label>
            <input
              id="contest-url"
              v-model="syncForm.contestUrl"
              placeholder="https://codeforces.com/gym/615540"
            />
          </div>
          <div class="field">
            <label for="contest-tags">Filter Tags</label>
            <input
              id="contest-tags"
              v-model="filterForm.tags"
              placeholder="省赛, 2025, 东北"
            />
          </div>
        </div>

        <div class="actions">
          <button class="button" :disabled="submitting" @click="submitSyncContest">
            {{ submitting ? "Syncing..." : "Sync Contest" }}
          </button>
          <button class="button button--ghost" :disabled="loading" @click="loadContests">
            {{ loading ? "Refreshing..." : "Refresh List" }}
          </button>
          <button
            class="button"
            :class="{ 'button--ghost': !wholeContestFreshOnly }"
            @click="wholeContestFreshOnly = !wholeContestFreshOnly"
          >
            {{ wholeContestFreshOnly ? "Showing Whole-Contest Fresh Only" : "Show Whole-Contest Fresh Only" }}
          </button>
          <button class="button button--ghost" @click="handleExportContests">
            Export Contests
          </button>
          <label class="button button--ghost" style="cursor: pointer">
            Import Contests
            <input
              ref="importFileInput"
              type="file"
              accept="application/json"
              style="display: none"
              @change="handleImportContests"
            />
          </label>
        </div>

        <label class="inline-meta tiny muted" style="margin-top: 12px; display: inline-flex; gap: 8px; align-items: center">
          <input v-model="importSync" type="checkbox" />
          sync imported contests immediately
        </label>

        <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
        <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
      </div>
    </section>

    <section class="panel">
      <div class="panel__body">
        <div class="panel__header">
          <div class="panel__title">
            <p class="eyebrow">Contest Pool</p>
            <h2>按整场看 VP 价值</h2>
            <p class="muted">
              这里的 fresh only 指整场比赛队内一道题都没做过、也没试过。
            </p>
          </div>
          <div class="inline-tags">
            <span class="tag tag--neutral">{{ visibleContests.length }} visible</span>
            <span class="tag tag--neutral">{{ contests.length }} total</span>
            <span v-for="tag in activeTags" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </div>

        <div v-if="loading" class="notice">loading contests...</div>
        <div v-else-if="!visibleContests.length && wholeContestFreshOnly" class="notice">
          当前没有“整场 fresh”的比赛，也就是每场至少都有一道题被队内碰过。
        </div>
        <div v-else-if="!contests.length" class="notice">
          还没有比赛，先同步一场 Gym 试试。
        </div>
        <div v-else class="list-grid">
          <RouterLink
            v-for="contest in visibleContests"
            :key="contest.contest_id"
            :to="`/contests/${contest.contest_id}`"
            class="contest-card"
          >
            <div class="contest-card__top">
              <div>
                <p class="eyebrow">{{ contest.provider_key }} / {{ contest.provider_contest_id }}</p>
                <h3>{{ contest.title }}</h3>
                <div class="inline-meta tiny muted">
                  <span v-if="contest.alias">alias: {{ contest.alias }}</span>
                  <span v-if="contest.official_url">public link available</span>
                </div>
              </div>
            </div>

            <div class="contest-card__meta-row">
              <div class="inline-tags">
                <span class="tag tag--warm">fresh {{ contest.fresh_problem_count ?? 0 }}</span>
                <span class="tag tag--neutral">solved {{ contest.solved_problem_count ?? 0 }}</span>
                <span class="tag tag--neutral">tried {{ contest.tried_problem_count ?? 0 }}</span>
              </div>
              <span class="contest-card__link-mark" aria-hidden="true">open ↗</span>
            </div>

            <div class="contest-card__summary">
              <span><strong>{{ contest.problem_count ?? 0 }}</strong> problems</span>
              <span><strong>{{ contest.fresh_problem_count ?? 0 }}</strong> fresh</span>
              <span>updated {{ contest.updated_at.slice(0, 10) }}</span>
            </div>

            <div v-if="contest.tags.length" class="inline-tags" style="margin-top: 16px">
              <span v-for="tag in contest.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>
