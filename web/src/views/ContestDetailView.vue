<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useRouter } from "vue-router";

import ContestCatalogEditor from "../components/ContestCatalogEditor.vue";
import {
  type CatalogSource,
  type CatalogContestDetail,
} from "../lib/catalog";
import { aggregateAliasesFromSources } from "../lib/catalog-sources";
import { emitCatalogMutated } from "../lib/catalog-events";
import { syncCodeforcesContestProblems } from "../lib/codeforces";
import {
  deleteCatalogContestRecord,
  getCatalogContestDetailFromDb,
  getContestCoverageFromDb,
  hasDeletedCatalogContestId,
  listCatalogContestsFromDb,
  replaceManualCatalogContest,
} from "../lib/local-db";
import type { LocalCatalogContestRecord, LocalCatalogProblemRecord, LocalContestCoverage } from "../lib/local-model";

const route = useRoute();
const router = useRouter();
const contest = ref<CatalogContestDetail | null>(null);
const coverage = ref<LocalContestCoverage | null>(null);
const loading = ref(false);
const syncing = ref(false);
const error = ref("");
const feedback = ref("");
const syncWarning = ref("");
const editing = ref(false);
const saving = ref(false);
const deleting = ref(false);
const existingTags = ref<string[]>([]);

const contestId = computed(() => String(route.params.contestId ?? ""));
const contestEyebrow = computed(() => {
  const source = contest.value?.sources.find((item) => item.provider === "codeforces" && item.kind === "contest" && item.provider_contest_id);
  if (source?.provider && source.provider_contest_id) {
    return `${source.provider.toUpperCase()} / ${source.provider_contest_id}`;
  }
  return "CURATED CONTEST";
});
const contestEditorInitialValue = computed(() => {
  if (!contest.value) {
    return undefined;
  }

  return {
    contestId: contest.value.id,
    title: contest.value.title,
    aliases: contest.value.aliases,
    tags: contest.value.tags,
    sources: contest.value.sources,
    notes: contest.value.notes ?? null,
    problems: contest.value.problems.map((problem) => ({
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: problem.aliases,
      sources: problem.sources,
    })),
  };
});

function mapLocalContestRecordToDetail(
  contestRecord: LocalCatalogContestRecord,
  problems: LocalContestCoverage["problems"] | Array<{
    problemId: string;
    ordinal: string;
    title: string;
    aliases?: string[];
    sources?: CatalogSource[];
  }> = [],
): CatalogContestDetail {
  return {
    id: contestRecord.contestId,
    title: contestRecord.title,
    aliases: contestRecord.aliases,
    tags: contestRecord.tags,
    start_at: contestRecord.startAt,
    curation_status: contestRecord.curationStatus,
    sources: contestRecord.sources,
    problems: problems.map((problem) => ({
      id: problem.problemId,
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: "aliases" in problem ? (problem.aliases ?? []) : [],
      sources: "sources" in problem ? (problem.sources ?? []) : [],
    })),
    notes: contestRecord.notes ?? undefined,
    generated_from: contestRecord.generatedFrom ?? undefined,
    problem_count: problems.length,
  };
}

async function loadContestPage() {
  if (!contestId.value) {
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    const [localDetail, allContests] = await Promise.all([
      getCatalogContestDetailFromDb(contestId.value),
      listCatalogContestsFromDb(),
    ]);
    existingTags.value = [...new Set(allContests.flatMap((item) => item.tags))].sort((left, right) =>
      left.localeCompare(right),
    );
    if (localDetail) {
      const localCoverage = await getContestCoverageFromDb(contestId.value);
      coverage.value = localCoverage;
      contest.value = mapLocalContestRecordToDetail(localDetail.contest, localDetail.problems);
    } else {
      if (await hasDeletedCatalogContestId(contestId.value)) {
        throw new Error("contest deleted");
      }
      throw new Error("contest not found locally");
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to load contest";
  } finally {
    loading.value = false;
  }
}

async function saveContestMetadata(payload: {
  title: string;
  aliases: string[];
  tags: string[];
  sources: CatalogSource[];
  notes: string | null;
  problems?: Array<{
    ordinal: string;
    title: string;
    aliases?: string[];
    sources: CatalogSource[];
  }>;
}) {
  if (!contest.value) {
    return;
  }
  if (!payload.title.trim()) {
    error.value = "contest title is required";
    return;
  }
  if (!payload.sources.length) {
    error.value = "at least one source is required";
    return;
  }

  saving.value = true;
  error.value = "";
  feedback.value = "";
  try {
    const nextProblems: LocalCatalogProblemRecord[] = (payload.problems ?? contest.value.problems).map((problem) => ({
      problemId: `${contest.value!.id}:${problem.ordinal}`,
      contestId: contest.value!.id,
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: aggregateAliasesFromSources(problem.title, problem.aliases ?? [], problem.sources),
      sources: problem.sources,
    }));
    const contestTitle = payload.title.trim();
    await replaceManualCatalogContest({
      contest: {
        contestId: contest.value.id,
        title: contestTitle,
        aliases: aggregateAliasesFromSources(contestTitle, payload.aliases, payload.sources),
        tags: payload.tags,
        startAt: contest.value.start_at ?? null,
        curationStatus: nextProblems.length ? "problem_listed" : contest.value.curation_status,
        problemIds: nextProblems.map((problem) => problem.problemId),
        sources: payload.sources,
        notes: payload.notes,
        generatedFrom: "manual",
      },
      problems: nextProblems,
    });
    emitCatalogMutated();
    await loadContestPage();
    editing.value = false;
    feedback.value = "contest metadata updated";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to save contest metadata";
  } finally {
    saving.value = false;
  }
}

async function syncProblemsFromCodeforces() {
  if (!contestId.value) {
    return;
  }

  syncing.value = true;
  error.value = "";
  feedback.value = "";
  syncWarning.value = "";
  try {
    const result = await syncCodeforcesContestProblems(contestId.value);
    emitCatalogMutated();
    feedback.value = `synced ${result.problemCount} problems from ${result.sourceCount} Codeforces source(s)`;
    await loadContestPage();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to sync contest problems";
    syncWarning.value = "如果这是一个 private Codeforces 比赛，请先在 Manage 页面保存 API 凭据，并确认当前账号本身有访问权限。即使具备权限，返回的数据也可能仍然不完整。";
  } finally {
    syncing.value = false;
  }
}

async function handleDeleteContest() {
  if (!contest.value) {
    return;
  }
  const confirmed = window.confirm(`Delete contest "${contest.value.title}" from local catalog?`);
  if (!confirmed) {
    return;
  }

  deleting.value = true;
  error.value = "";
  feedback.value = "";
  try {
    await deleteCatalogContestRecord(contest.value.id);
    emitCatalogMutated();
    await router.push("/contests");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to delete contest";
  } finally {
    deleting.value = false;
  }
}

watch(contestId, loadContestPage);
onMounted(loadContestPage);
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div v-if="loading" class="notice">loading contest...</div>
        <template v-else-if="contest">
          <div class="panel__header">
            <div class="panel__title">
              <p class="eyebrow">{{ contestEyebrow }}</p>
              <h2>{{ contest.title }}</h2>
              <div class="inline-meta muted tiny">
                <span>{{ coverage?.problemCount ?? contest.problems.length }} problems</span>
                <span>{{ coverage?.freshProblemCount ?? 0 }} fresh</span>
              </div>
            </div>
            <div class="inline-tags">
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
                  <p class="eyebrow">Catalog</p>
                  <h3>比赛元数据与题目列表</h3>
                </div>

                <div class="stat-grid" style="margin-bottom: 18px">
                  <div class="stat-card">
                    <p class="stat-card__label">Problems</p>
                    <div class="stat-card__value">{{ coverage?.problemCount ?? contest.problems.length }}</div>
                  </div>
                  <div class="stat-card">
                    <p class="stat-card__label">Fresh For Team</p>
                    <div class="stat-card__value">{{ coverage?.freshProblemCount ?? 0 }}</div>
                  </div>
                </div>

                <div class="actions" style="margin-top: 0; margin-bottom: 18px">
                  <button class="button" :disabled="syncing" @click="syncProblemsFromCodeforces">
                    {{ syncing ? "Syncing..." : "Sync Problems From Codeforces" }}
                  </button>
                  <button class="button button--ghost" :disabled="saving" @click="editing = !editing">
                    {{ editing ? "Close Editor" : "Edit Contest Metadata" }}
                  </button>
                  <button class="button button--ghost" :disabled="deleting" @click="handleDeleteContest">
                    {{ deleting ? "Deleting..." : "Delete Contest" }}
                  </button>
                  <span v-if="coverage" class="muted tiny">
                    {{ coverage.trackedMembers.length }} tracked members
                  </span>
                </div>

                <div v-if="editing" class="panel" style="box-shadow: none; margin-bottom: 18px">
                  <div class="panel__body">
                    <ContestCatalogEditor
                      :initial-value="contestEditorInitialValue"
                      :existing-tags="existingTags"
                      :busy="saving"
                      submit-label="Save Contest"
                      @submit="saveContestMetadata"
                    />
                  </div>
                </div>

                <div class="table-shell">
                  <table class="coverage-table">
                    <thead>
                      <tr>
                        <th>Problem</th>
                        <th>Title</th>
                        <th>Team Fresh</th>
                        <th
                          v-for="member in coverage?.trackedMembers ?? []"
                          :key="member.memberId"
                        >
                          {{ member.displayName }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="problem in coverage?.problems ?? []" :key="problem.problemId">
                        <td>
                          <strong>{{ problem.ordinal }}</strong>
                        </td>
                        <td>
                          <div>{{ problem.title }}</div>
                        </td>
                        <td>
                          <span
                            class="tag"
                            :class="problem.freshForTeam ? 'tag--warm' : 'tag--neutral'"
                          >
                            {{ problem.freshForTeam ? "fresh" : "touched" }}
                          </span>
                        </td>
                        <td v-for="member in problem.members" :key="`${problem.problemId}-${member.memberId}`">
                          <span class="status-dot" :class="`status-${member.status}`">
                            {{ member.status }}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
                <p v-if="syncWarning" class="notice" style="margin-top: 16px">{{ syncWarning }}</p>
                <p v-if="!(coverage?.problemCount)" class="notice" style="margin-top: 16px">
                  这场比赛还没有本地 problem snapshot。先点上面的按钮从 Codeforces 拉一次题目列表。
                </p>
              </div>
            </div>

            <div class="panel" style="box-shadow: none">
              <div class="panel__body">
                <div class="panel__title" style="margin-bottom: 16px">
                  <p class="eyebrow">Sources</p>
                  <h3>来源与整理说明</h3>
                </div>

                <div class="field">
                  <label>Aggregated Aliases</label>
                  <div class="inline-tags" style="margin-top: 10px">
                    <span
                      v-for="alias in contest.aliases"
                      :key="alias"
                      class="tag"
                    >
                      {{ alias }}
                    </span>
                    <span v-if="!contest.aliases.length" class="muted tiny">No aliases</span>
                  </div>
                </div>

                <div class="field" style="margin-top: 14px">
                  <label>Source Links</label>
                  <div class="list-grid" style="margin-top: 12px">
                    <a
                      v-for="source in contest.sources"
                      :key="`${source.provider}-${source.kind}-${source.provider_contest_id || source.provider_problem_id || source.url}`"
                      class="contest-card"
                      :href="source.url"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div class="contest-card__top">
                        <div>
                          <p class="eyebrow">
                            {{ source.provider }} / {{ source.kind }}
                            <template v-if="source.variant"> / {{ source.variant }}</template>
                          </p>
                          <h3>{{ source.label || source.url }}</h3>
                          <p v-if="source.source_title" class="muted tiny">{{ source.source_title }}</p>
                        </div>
                      </div>
                    </a>
                  </div>
                </div>

                <p v-if="contest.notes" class="notice" style="margin-top: 16px">{{ contest.notes }}</p>
              </div>
            </div>
          </div>
        </template>
        <p v-else-if="error" class="error-box">{{ error }}</p>
      </div>
    </section>
  </div>
</template>
