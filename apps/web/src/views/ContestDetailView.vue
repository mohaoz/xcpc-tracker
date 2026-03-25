<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

import {
  annotateContest,
  fetchContestCoverage,
  fetchContestDetail,
  type ContestCoverage,
  type ContestDetail,
} from "../lib/api";

const route = useRoute();
const contest = ref<ContestDetail | null>(null);
const coverage = ref<ContestCoverage | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const feedback = ref("");
const freshOnly = ref(false);

const form = ref({
  alias: "",
  tags: "",
});

const contestId = computed(() => String(route.params.contestId ?? ""));

const visibleProblems = computed(() => {
  const problems = coverage.value?.problems ?? [];
  if (!freshOnly.value) {
    return problems;
  }
  return problems.filter((problem) => problem.fresh_for_team);
});

async function loadContestPage() {
  if (!contestId.value) {
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    const [detailPayload, coveragePayload] = await Promise.all([
      fetchContestDetail(contestId.value),
      fetchContestCoverage(contestId.value),
    ]);
    contest.value = detailPayload;
    coverage.value = coveragePayload;
    form.value.alias = detailPayload.alias ?? "";
    form.value.tags = detailPayload.tags.join(", ");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to load contest";
  } finally {
    loading.value = false;
  }
}

async function saveAnnotation() {
  if (!contest.value) {
    return;
  }
  saving.value = true;
  error.value = "";
  feedback.value = "";
  try {
    await annotateContest({
      contest_ref: contest.value.contest_id,
      alias: form.value.alias.trim() || undefined,
      tags: form.value.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    feedback.value = "contest metadata updated";
    await loadContestPage();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to update contest";
  } finally {
    saving.value = false;
  }
}

function statusClass(status: string) {
  return `status-${status}`;
}

watch(contestId, loadContestPage);
onMounted(loadContestPage);
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div v-if="loading" class="notice">loading contest...</div>
        <template v-else-if="contest && coverage">
          <div class="panel__header">
            <div class="panel__title">
              <p class="eyebrow">{{ contest.provider_key }} / {{ contest.provider_contest_id }}</p>
              <h2>{{ contest.title }}</h2>
              <div class="inline-meta muted tiny">
                <span v-if="contest.alias">alias: {{ contest.alias }}</span>
                <span>{{ contest.problem_count }} problems</span>
                <span>{{ coverage.tracked_members.length }} tracked members</span>
              </div>
            </div>
            <div class="inline-tags">
              <span class="tag tag--warm">fresh {{ coverage.fresh_problem_count }}</span>
              <span
                v-for="tag in contest.tags"
                :key="tag"
                class="tag"
              >
                {{ tag }}
              </span>
            </div>
          </div>

          <div class="section-split">
            <div class="panel" style="box-shadow: none">
              <div class="panel__body">
                <div class="panel__title" style="margin-bottom: 16px">
                  <p class="eyebrow">Coverage</p>
                  <h3>每道题 x 每个队员</h3>
                </div>

                <div class="stat-grid" style="margin-bottom: 18px">
                  <div class="stat-card">
                    <p class="stat-card__label">Problems</p>
                    <div class="stat-card__value">{{ coverage.problem_count }}</div>
                  </div>
                  <div class="stat-card">
                    <p class="stat-card__label">Fresh Before VP</p>
                    <div class="stat-card__value">{{ coverage.fresh_problem_count }}</div>
                  </div>
                </div>

                <div class="actions" style="margin-top: 0; margin-bottom: 18px">
                  <button
                    class="button"
                    :class="{ 'button--ghost': !freshOnly }"
                    @click="freshOnly = !freshOnly"
                  >
                    {{ freshOnly ? "Showing Fresh Only" : "Show Fresh Only" }}
                  </button>
                  <span class="muted tiny">
                    {{ visibleProblems.length }} / {{ coverage.problem_count }} problems visible
                  </span>
                </div>

                <div class="table-shell">
                  <table class="coverage-table">
                    <thead>
                      <tr>
                        <th>Problem</th>
                        <th>Team Fresh</th>
                        <th
                          v-for="member in coverage.tracked_members"
                          :key="member.identity_binding_id"
                        >
                          {{ member.local_member_key }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="problem in visibleProblems" :key="problem.problem_id">
                        <td>
                          <strong>{{ problem.ordinal }}</strong>
                          <div class="muted tiny">{{ problem.title }}</div>
                        </td>
                        <td>
                          <span
                            class="tag"
                            :class="problem.fresh_for_team ? 'tag--warm' : 'tag--neutral'"
                          >
                            {{ problem.fresh_for_team ? "fresh" : "touched" }}
                          </span>
                        </td>
                        <td v-for="member in problem.members" :key="member.local_member_key">
                          <span class="status-dot" :class="statusClass(member.status)">
                            {{ member.status }}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p
                  v-if="freshOnly && visibleProblems.length === 0"
                  class="notice"
                  style="margin-top: 16px"
                >
                  这场比赛当前没有队内完全 fresh 的题。
                </p>
              </div>
            </div>

            <div class="panel" style="box-shadow: none">
              <div class="panel__body">
                <div class="panel__title" style="margin-bottom: 16px">
                  <p class="eyebrow">Annotation</p>
                  <h3>本地管理信息</h3>
                </div>

                <div class="field">
                  <label for="contest-alias">Alias</label>
                  <input id="contest-alias" v-model="form.alias" placeholder="ccinv25db" />
                </div>

                <div class="field" style="margin-top: 14px">
                  <label for="contest-tags">Tags</label>
                  <input
                    id="contest-tags"
                    v-model="form.tags"
                    placeholder="2025, 省赛, 贵州"
                  />
                </div>

                <div class="actions">
                  <button class="button" :disabled="saving" @click="saveAnnotation">
                    {{ saving ? "Saving..." : "Save Metadata" }}
                  </button>
                  <a
                    v-if="contest.official_url"
                    class="button button--ghost"
                    :href="contest.official_url"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Contest
                  </a>
                </div>

                <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
                <p v-if="error" class="error-box" style="margin-top: 16px">{{ error }}</p>
              </div>
            </div>
          </div>
        </template>
        <p v-else-if="error" class="error-box">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
