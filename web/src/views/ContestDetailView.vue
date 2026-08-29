<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useRouter } from "vue-router";

import ContestCatalogEditor from "../components/ContestCatalogEditor.vue";
import {
  type CatalogAwardCutoffs,
  type CatalogSource,
  type CatalogContestDetail,
} from "../lib/catalog";
import { aggregateAliasesFromSources } from "../lib/catalog-sources";
import { getRuntimeCatalogContestDetail, listRuntimeCatalogContests } from "../lib/catalog-runtime";
import { emitCatalogMutated } from "../lib/catalog-events";
import { emitMemberMutated } from "../lib/member-events";
import {
  deleteCatalogContestRecord,
  getContestCoverageForCatalog,
  getManualMemberProblemStatusFromDb,
  replaceManualCatalogContest,
  upsertManualMemberProblemStatus,
} from "../lib/local-db";
import type { LocalCatalogContestRecord, LocalCatalogProblemRecord, LocalContestCoverage } from "../lib/local-model";

const route = useRoute();
const router = useRouter();
const contest = ref<CatalogContestDetail | null>(null);
const coverage = ref<LocalContestCoverage | null>(null);
const loading = ref(false);
const error = ref("");
const feedback = ref("");
const editing = ref(false);
const saving = ref(false);
const deleting = ref(false);
const existingTags = ref<string[]>([]);
const markMode = ref(false);
const markSavingCellKey = ref("");
const awardCutoffs = ref<CatalogAwardCutoffs | null>(null);

const contestId = computed(() => String(route.params.contestId ?? ""));
const trackedMembers = computed(() => coverage.value?.trackedMembers ?? []);
const awardCutoffRows = computed(() => {
  const cutoffs = awardCutoffs.value?.cutoffs;
  return [
    { key: "bronze" as const, label: "Cu", cutoff: cutoffs?.bronze ?? null },
    { key: "silver" as const, label: "Ag", cutoff: cutoffs?.silver ?? null },
    { key: "gold" as const, label: "Au", cutoff: cutoffs?.gold ?? null },
  ];
});
const awardCutoffSourceLabel = computed(() => {
  if (!awardCutoffs.value) {
    return "";
  }
  if (awardCutoffs.value.source === "explicit") {
    return "使用 standings 官方 medal 配置";
  }
  if (awardCutoffs.value.source === "inferred_official_medal_ratio_10_20_30") {
    return "按 official 队伍奖牌数量 10% / 20% / 30% 推断";
  }
  return "未识别 official 分组，按全部队伍奖牌数量 10% / 20% / 30% 推断";
});
const contestDateLabel = computed(() =>
  contest.value?.start_at?.match(/^\d{4}-\d{2}-\d{2}/u)?.[0] ?? "",
);
const solvedProblemCount = computed(() =>
  coverage.value?.problems.filter((problem) => problem.members.some((member) => member.status === "solved")).length ?? 0,
);
const awardPlacement = computed(() => {
  const cutoffs = awardCutoffs.value?.cutoffs;
  if (!cutoffs) {
    return null;
  }
  const solved = solvedProblemCount.value;
  if (cutoffs.gold && solved >= cutoffs.gold.solved) {
    return "Au";
  }
  if (cutoffs.silver && solved >= cutoffs.silver.solved) {
    return "Ag";
  }
  if (cutoffs.bronze && solved >= cutoffs.bronze.solved) {
    return "Cu";
  }
  return "Fe";
});
const nextAwardTarget = computed(() => {
  const cutoffs = awardCutoffs.value?.cutoffs;
  const placement = awardPlacement.value;
  if (!cutoffs || !placement || placement === "Au") {
    return null;
  }
  const nextCutoff = placement === "Fe" ? cutoffs.bronze : placement === "Cu" ? cutoffs.silver : cutoffs.gold;
  const nextLabel = placement === "Fe" ? "Cu" : placement === "Cu" ? "Ag" : "Au";
  const currentCutoff = placement === "Fe" ? null : placement === "Cu" ? cutoffs.bronze : cutoffs.silver;
  if (!nextCutoff) {
    return null;
  }
  const baseSolved = currentCutoff?.solved ?? 0;
  const targetGap = Math.max(1, nextCutoff.solved - baseSolved);
  const solvedWithinLevel = Math.max(0, Math.min(targetGap, solvedProblemCount.value - baseSolved));
  return {
    label: nextLabel,
    remaining: Math.max(0, nextCutoff.solved - solvedProblemCount.value),
    solved: nextCutoff.solved,
    progressPercent: 50 + Math.round((solvedWithinLevel / targetGap) * 50),
  };
});
const contestEyebrow = computed(() => {
  const sources = contest.value?.sources ?? [];
  const preferredSources = sources.some((item) => item.kind === "contest")
    ? sources.filter((item) => item.kind === "contest")
    : sources;
  const sourceLabels = preferredSources
    .map((item) => {
      const provider = item.provider.trim().toUpperCase();
      const providerId = (item.provider_contest_id ?? "").trim();
      if (providerId) {
        return `${provider} / ${providerId}`;
      }
      const sourceTitle = (item.source_title ?? item.label ?? "").trim();
      return sourceTitle ? `${provider} / ${sourceTitle}` : provider;
    });
  if (sourceLabels.length) {
    return sourceLabels.join(" | ");
  }
  return "CURATED CONTEST";
});

function loadAwardCutoffs() {
  awardCutoffs.value = contest.value?.awardCutoffs ?? null;
}
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
    awardCutoffs: contestRecord.awardCutoffs,
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
    const [runtimeDetail, allContests] = await Promise.all([
      getRuntimeCatalogContestDetail(contestId.value),
      listRuntimeCatalogContests(),
    ]);
    existingTags.value = [...new Set(allContests.contests.flatMap((item) => item.tags))].sort((left, right) =>
      left.localeCompare(right),
    );
    coverage.value = await getContestCoverageForCatalog(runtimeDetail.contest, runtimeDetail.problems);
    contest.value = mapLocalContestRecordToDetail(runtimeDetail.contest, runtimeDetail.problems);
    loadAwardCutoffs();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "加载比赛失败";
  } finally {
    loading.value = false;
  }
}

async function refreshCoverageOnly() {
  if (!contestId.value || !contest.value) {
    return;
  }
  const runtimeDetail = await getRuntimeCatalogContestDetail(contestId.value);
  coverage.value = await getContestCoverageForCatalog(runtimeDetail.contest, runtimeDetail.problems);
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
    error.value = "比赛标题不能为空";
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
        awardCutoffs: contest.value.awardCutoffs,
        notes: payload.notes,
        generatedFrom: "manual",
      },
      problems: nextProblems,
    });
    emitCatalogMutated();
    await loadContestPage();
    editing.value = false;
    feedback.value = "比赛信息已更新";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "保存比赛信息失败";
  } finally {
    saving.value = false;
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
    error.value = caught instanceof Error ? caught.message : "删除比赛失败";
  } finally {
    deleting.value = false;
  }
}

function buildCellKey(problemId: string, memberId: string) {
  return `${problemId}:${memberId}`;
}

function getProblemAggregateStatus(problem: LocalContestCoverage["problems"][number]) {
  if (problem.members.some((member) => member.status === "solved")) {
    return "solved";
  }
  if (problem.members.some((member) => member.status === "attempted")) {
    return "attempted";
  }
  return "unseen";
}

function getNextManualStatus(payload: {
  currentStatus: "solved" | "attempted" | "unseen";
  manualStatus: "solved" | "attempted" | null;
}) {
  if (payload.manualStatus === "solved") {
    return null;
  }
  if (payload.manualStatus === "attempted") {
    return payload.currentStatus === "solved" ? null : "solved";
  }
  if (payload.currentStatus === "unseen") {
    return "attempted" as const;
  }
  if (payload.currentStatus === "attempted") {
    return "solved" as const;
  }
  return undefined;
}

async function applyMarkToCell(
  problemId: string,
  memberId: string,
  currentStatus: "solved" | "attempted" | "unseen",
) {
  if (!markMode.value || !contest.value) {
    return;
  }
  if (!trackedMembers.value.length || !(coverage.value?.problems.length)) {
    error.value = "当前没有可标记的成员或题目";
    return;
  }

  const cellKey = buildCellKey(problemId, memberId);
  const manualStatus = await getManualMemberProblemStatusFromDb(memberId, problemId);
  const nextStatus = getNextManualStatus({
    currentStatus,
    manualStatus,
  });
  if (typeof nextStatus === "undefined") {
    return;
  }
  markSavingCellKey.value = cellKey;
  error.value = "";
  feedback.value = "";
  try {
    await upsertManualMemberProblemStatus({
      memberId,
      problemId,
      status: nextStatus,
      note: null,
    });
    emitMemberMutated();
    await refreshCoverageOnly();
    feedback.value = `manual status set to ${nextStatus}`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to apply manual mark";
  } finally {
    markSavingCellKey.value = "";
  }
}

watch(contestId, loadContestPage);
onMounted(loadContestPage);
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div v-if="loading" class="notice">catalog loading...</div>
        <template v-else-if="contest">
          <div class="panel__header">
            <div class="panel__title">
              <p class="eyebrow">{{ contestEyebrow }}</p>
              <h2>{{ contest.title }}</h2>
              <div class="inline-meta muted tiny">
                <span>{{ coverage?.problemCount ?? contest.problems.length }} problems</span>
                <span>{{ coverage?.freshProblemCount ?? 0 }} fresh</span>
                <span v-if="contestDateLabel">{{ contestDateLabel }}</span>
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
                  <p class="eyebrow">目录</p>
                  <h3>比赛元数据与题目列表</h3>
                </div>

                <div class="stat-grid" style="margin-bottom: 18px">
                  <div class="stat-card">
                    <p class="stat-card__label">题目数</p>
                    <div class="stat-card__value">{{ coverage?.problemCount ?? contest.problems.length }}</div>
                  </div>
                  <div class="stat-card">
                    <p class="stat-card__label">队伍未做</p>
                    <div class="stat-card__value">{{ coverage?.freshProblemCount ?? 0 }}</div>
                  </div>
                </div>

                <div
                  v-if="awardCutoffs"
                  :class="[
                    'award-cutoff-card',
                    `award-cutoff-card--${awardPlacement?.toLowerCase() ?? 'fe'}`,
                    `award-cutoff-card--target-${nextAwardTarget?.label.toLowerCase() ?? awardPlacement?.toLowerCase() ?? 'fe'}`,
                  ]"
                  :style="{ '--award-progress': awardPlacement === 'Au' ? '100%' : nextAwardTarget ? `${nextAwardTarget.progressPercent}%` : '0%' }"
                >
                  <div class="award-cutoff-card__header">
                    <div class="award-cutoff-card__current">
                      <span
                        v-if="awardPlacement"
                        :class="`contest-medal-badge contest-medal-badge--${awardPlacement.toLowerCase()}`"
                      >
                        {{ awardPlacement }}
                      </span>
                      <div>
                        <strong>{{ solvedProblemCount }} solved</strong>
                      </div>
                    </div>
                    <div
                      v-if="nextAwardTarget"
                      class="award-cutoff-card__progress"
                    >
                      <span>
                        NEXT +{{ nextAwardTarget.remaining }}
                        {{ nextAwardTarget.remaining === 1 ? "prob" : "probs" }}
                      </span>
                    </div>
                    <div v-if="awardPlacement === 'Au'" class="award-cutoff-card__next">
                      <span class="award-cutoff-card__next-crown">★</span>
                    </div>
                    <div v-else-if="nextAwardTarget" class="award-cutoff-card__next">
                      <span class="award-cutoff-card__next-count">{{ nextAwardTarget.solved }} solved</span>
                      <span :class="`contest-medal-badge contest-medal-badge--${nextAwardTarget.label.toLowerCase()}`">
                        {{ nextAwardTarget.label }}
                      </span>
                    </div>
                  </div>
                  <div class="award-cutoff-card__grid">
                    <div
                      v-for="row in awardCutoffRows"
                      :key="row.key"
                      class="award-cutoff-card__item"
                    >
                      <span :class="`contest-medal-badge contest-medal-badge--${row.label.toLowerCase()}`">
                        {{ row.label }}
                      </span>
                      <div>
                        <strong>{{ row.cutoff ? `${row.cutoff.solved} solved` : "—" }}</strong>
                        <p v-if="row.cutoff" class="muted tiny">
                          第 {{ row.cutoff.rank }} 名，罚时 {{ row.cutoff.penalty }}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p class="award-cutoff-card__source">
                    来源：<a :href="awardCutoffs.sourceUrl" target="_blank" rel="noreferrer">
                      {{ awardCutoffs.sourceLabel }}
                    </a>。{{ awardCutoffSourceLabel }}，{{ awardCutoffs.eligibleTeamCount }} official teams。
                  </p>
                </div>
                <p v-else class="muted tiny" style="margin-bottom: 18px">
                  暂无预计算奖牌线。
                </p>

                <div class="actions" style="margin-top: 0; margin-bottom: 18px">
                  <button
                    :class="markMode ? 'button' : 'button button--ghost'"
                    :disabled="!coverage?.trackedMembers.length || !coverage?.problemCount"
                    @click="markMode = !markMode"
                  >
                    {{ markMode ? "退出标记模式" : "进入标记模式" }}
                  </button>
                  <button class="button button--ghost" :disabled="saving" @click="editing = !editing">
                    {{ editing ? "关闭编辑器" : "编辑比赛信息" }}
                  </button>
                  <button class="button button--ghost" :disabled="deleting" @click="handleDeleteContest">
                    {{ deleting ? "删除中..." : "删除比赛" }}
                  </button>
                </div>

                <div v-if="editing" class="panel" style="box-shadow: none; margin-bottom: 18px">
                  <div class="panel__body">
                    <ContestCatalogEditor
                      :initial-value="contestEditorInitialValue"
                      :existing-tags="existingTags"
                      :busy="saving"
                      submit-label="保存比赛"
                      @submit="saveContestMetadata"
                    />
                  </div>
                </div>

                <div class="table-shell">
                  <table class="coverage-table">
                    <thead>
                      <tr>
                        <th class="coverage-table__title-column">标题</th>
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
                        <td class="coverage-table__title-column">
                          <div class="coverage-table__problem-title">
                            <span
                              class="contest-problem-state coverage-table__problem-ordinal"
                              :class="`contest-problem-state--${getProblemAggregateStatus(problem)}`"
                            >
                              {{ problem.ordinal }}
                            </span>
                            <span class="coverage-table__problem-name">{{ problem.title }}</span>
                          </div>
                        </td>
                        <td v-for="member in problem.members" :key="`${problem.problemId}-${member.memberId}`">
                          <button
                            type="button"
                            class="coverage-cell-button"
                            :class="{ 'coverage-cell-button--active': markMode }"
                            :disabled="!markMode || !!markSavingCellKey"
                            @click="applyMarkToCell(problem.problemId, member.memberId, member.status)"
                          >
                            <span class="status-dot" :class="`status-${member.status}`">
                              {{
                                markSavingCellKey === buildCellKey(problem.problemId, member.memberId)
                                  ? "..."
                                  : member.status === "solved"
                                    ? "+"
                                    : member.status === "attempted"
                                      ? "-"
                                      : ""
                              }}
                            </span>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
                <p v-if="!(coverage?.problemCount)" class="notice" style="margin-top: 16px">
                  这场比赛还没有题目列表。可以在编辑器里手动补题，或者回到 Manage 页面导入补丁 JSON。
                </p>
              </div>
            </div>

            <div class="panel" style="box-shadow: none">
              <div class="panel__body">
                <div class="panel__title" style="margin-bottom: 16px">
                  <p class="eyebrow">来源</p>
                  <h3>来源与整理说明</h3>
                </div>

                <div class="field">
                  <label>别名</label>
                  <div class="inline-tags" style="margin-top: 10px">
                    <span
                      v-for="alias in contest.aliases"
                      :key="alias"
                      class="tag"
                    >
                      {{ alias }}
                    </span>
                    <span v-if="!contest.aliases.length" class="muted tiny">暂无别名</span>
                  </div>
                </div>

                <div class="field" style="margin-top: 14px">
                  <label>来源链接</label>
                  <div class="list-grid" style="margin-top: 12px">
                    <component
                      v-for="source in contest.sources"
                      :key="`${source.provider}-${source.kind}-${source.provider_contest_id || source.provider_problem_id || source.url}`"
                      :is="source.url ? 'a' : 'div'"
                      class="contest-card"
                      :href="source.url"
                      :target="source.url ? '_blank' : undefined"
                      :rel="source.url ? 'noreferrer' : undefined"
                    >
                      <div class="contest-card__top">
                        <div>
                          <p class="eyebrow">{{ source.provider }} / {{ source.kind }}</p>
                          <h3>{{ source.label || source.url || "手动来源" }}</h3>
                          <p v-if="source.source_title" class="muted tiny">{{ source.source_title }}</p>
                        </div>
                      </div>
                    </component>
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

<style scoped>
.coverage-cell-button {
  width: 100%;
  border: none;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: default;
  font: inherit;
}

.coverage-cell-button--active {
  cursor: pointer;
}

.coverage-cell-button:disabled {
  opacity: 1;
}
</style>
