<script setup lang="ts">
import { useSettingsStore } from '../stores/settings';
import { selectAwardCutoffs } from '../lib/award-policy';
import { ratingClass } from '../lib/rating-colors';
import { computed, onUnmounted, ref, watch } from "vue";
import { liveQuery, type Subscription } from "dexie";
import { useRoute } from "vue-router";
import { useRouter } from "vue-router";

import ContestCatalogEditor from "../components/ContestCatalogEditor.vue";
import {
  type CatalogAwardCutoffs,
  type CatalogSource,
  type CatalogContestDetail,
} from "../lib/catalog";
import { aggregateAliasesFromSources } from "../lib/catalog-sources";
import { useSpoilerStore } from "../stores/spoilers";
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
import type { LocalCatalogContestRecord, LocalCatalogProblemRecord, LocalContestCoverage, LocalMemberPerson } from "../lib/local-model";

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
let coverageSubscription: Subscription | null = null;
let pageGeneration = 0;
let disposed = false;
const settings = useSettingsStore();
const awardCutoffs = computed(() => selectAwardCutoffs(contest.value, settings.allowMedalEstimates));
const spoilers = useSpoilerStore();
const touched = computed(() => coverage.value?.problems.some(p => p.members.some(m => m.status !== 'unseen')) ?? false);
const showSpoilers = computed(() => !loading.value && spoilers.visible(contestId.value, touched.value));

const contestId = computed(() => String(route.params.contestId ?? ""));
const trackedMembers = computed(() => coverage.value?.trackedMembers ?? []);
const memberCoverageRows = computed(() => {
  const problems = coverage.value?.problems ?? [];
  // Build a per-problem member→status index once so each row lookup is O(1).
  const statusByProblem = new Map(
    problems.map(p => [
      p.problemId,
      new Map(p.members.map(m => [m.memberId, m.status])),
    ]),
  );
  return trackedMembers.value.map(member => ({
    ...member,
    cells: problems.map(problem => ({
      problemId: problem.problemId,
      ordinal: problem.ordinal,
      title: problem.title,
      status: statusByProblem.get(problem.problemId)?.get(member.memberId) ?? 'unseen',
    })),
  }));
});
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
    return "";
  }
  if (awardCutoffs.value.source === "inferred_official_medal_ratio_10_20_30") {
    return "按 official 队伍奖牌数量 10% / 20% / 30% 推断";
  }
  return "未识别 official 分组，按全部队伍奖牌数量 10% / 20% / 30% 推断";
});
const contestDateLabel = computed(() =>
  contest.value?.start_at?.match(/^\d{4}-\d{2}-\d{2}/u)?.[0] ?? "",
);
const visibleContestNotes = computed(() => (contest.value?.notes ?? "")
  .replace(/举办日期为\s*\d{4}-\d{2}-\d{2}，具体开赛时刻未确认。/gu, "").trim());
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

// Axis positions for the award timeline.
// Maps each tier to a percentage along [0, axisMax] where axisMax = Au + 20%.
const awardAxis = computed(() => {
  const cutoffs = awardCutoffs.value?.cutoffs;
  if (!cutoffs) return null;
  const cu = cutoffs.bronze?.solved ?? null;
  const ag = cutoffs.silver?.solved ?? null;
  const au = cutoffs.gold?.solved ?? null;
  const max = au != null ? Math.ceil(au * 1.2) : ag != null ? Math.ceil(ag * 1.5) : cu != null ? Math.ceil(cu * 2) : null;
  if (max == null || max === 0) return null;
  const pct = (n: number) => Math.min(100, Math.round((n / max) * 100));
  return {
    max,
    cu: cu != null ? { solved: cu, pct: pct(cu), rank: cutoffs.bronze?.rank, penalty: cutoffs.bronze?.penalty } : null,
    ag: ag != null ? { solved: ag, pct: pct(ag), rank: cutoffs.silver?.rank, penalty: cutoffs.silver?.penalty } : null,
    au: au != null ? { solved: au, pct: pct(au), rank: cutoffs.gold?.rank, penalty: cutoffs.gold?.penalty } : null,
    current: { solved: solvedProblemCount.value, pct: pct(solvedProblemCount.value) },
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
const problemMetadata = computed(() => new Map((contest.value?.problems ?? []).map(p => [p.id, p])));

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
      tags: problem.tags ?? [],
      rating: problem.rating,
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
    tags?: string[];
    rating?: number;
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
    estimatedAwardCutoffs: contestRecord.estimatedAwardCutoffs,
    problems: problems.map((problem) => ({
      id: problem.problemId,
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: "aliases" in problem ? (problem.aliases ?? []) : [],
      tags: "tags" in problem ? (problem.tags ?? []) : [],
      rating: "rating" in problem ? problem.rating : undefined,
      sources: "sources" in problem ? (problem.sources ?? []) : [],
    })),
    notes: contestRecord.notes ?? undefined,
    generated_from: contestRecord.generatedFrom ?? undefined,
    problem_count: problems.length,
  };
}

async function loadContestPage() {
  const id = contestId.value;
  const generation = ++pageGeneration;
  const isCurrent = () => !disposed && generation === pageGeneration && id === contestId.value;
  coverageSubscription?.unsubscribe();
  coverageSubscription = null;
  contest.value = null;
  coverage.value = null;
  markSavingCellKey.value = "";
  error.value = "";
  loading.value = !!id;
  if (!id || disposed) return;

  try {
    const [runtimeDetail, allContests] = await Promise.all([
      getRuntimeCatalogContestDetail(id),
      listRuntimeCatalogContests(),
    ]);
    if (!isCurrent()) return;
    existingTags.value = [...new Set(allContests.contests.flatMap((item) => item.tags))].sort((left, right) =>
      left.localeCompare(right),
    );
    // Dexie observes committed changes from this tab and other tabs. Keep this
    // subscription tied to the loaded contest, not to mutable route parameters.
    coverageSubscription = liveQuery(() => getContestCoverageForCatalog(runtimeDetail.contest, runtimeDetail.problems)).subscribe({
      next(nextCoverage) {
        if (!isCurrent()) return;
        coverage.value = nextCoverage;
        contest.value = mapLocalContestRecordToDetail(runtimeDetail.contest, runtimeDetail.problems);
        loading.value = false;
      },
      error(caught) {
        if (!isCurrent()) return;
        coverage.value = null;
        contest.value = null;
        error.value = caught instanceof Error ? caught.message : "加载做题情况失败";
        loading.value = false;
      },
    });
  } catch (caught) {
    if (!isCurrent()) return;
    error.value = caught instanceof Error ? caught.message : "加载比赛失败";
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
    tags?: string[];
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

  const id = contest.value.id;
  let generation = pageGeneration;
  const isCurrent = () => !disposed && generation === pageGeneration && id === contestId.value;
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
      tags: 'tags' in problem ? (problem.tags ?? []) : (contest.value?.problems.find(p => p.ordinal === problem.ordinal)?.tags ?? []),
      rating: contest.value?.problems.find(p => p.ordinal === problem.ordinal)?.rating,
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
        estimatedAwardCutoffs: contest.value.estimatedAwardCutoffs,
        notes: payload.notes,
        generatedFrom: "manual",
      },
      problems: nextProblems,
    });
    emitCatalogMutated();
    if (!isCurrent()) return;
    const refresh = loadContestPage();
    generation = pageGeneration;
    await refresh;
    if (!isCurrent()) return;
    editing.value = false;
    feedback.value = "比赛信息已更新";
  } catch (caught) {
    if (isCurrent()) error.value = caught instanceof Error ? caught.message : "保存比赛信息失败";
  } finally {
    if (isCurrent()) saving.value = false;
  }
}

async function handleDeleteContest() {
  if (!contest.value) {
    return;
  }
  const confirmed = window.confirm(`确定要从本地目录删除「${contest.value.title}」吗？`);
  if (!confirmed) {
    return;
  }

  const id = contest.value.id;
  const generation = pageGeneration;
  const isCurrent = () => !disposed && generation === pageGeneration && id === contestId.value;
  deleting.value = true;
  error.value = "";
  feedback.value = "";
  try {
    await deleteCatalogContestRecord(id);
    emitCatalogMutated();
    if (isCurrent()) await router.push("/contests");
  } catch (caught) {
    if (isCurrent()) error.value = caught instanceof Error ? caught.message : "删除比赛失败";
  } finally {
    if (isCurrent()) deleting.value = false;
  }
}

function buildCellKey(problemId: string, memberId: string) {
  return `${problemId}:${memberId}`;
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
  member: Pick<LocalMemberPerson, "memberId" | "identityRevision">,
  currentStatus: "solved" | "attempted" | "unseen",
) {
  if (!markMode.value || !contest.value || markSavingCellKey.value) return;
  if (!trackedMembers.value.length || !(coverage.value?.problems.length)) {
    error.value = "当前没有可标记的成员或题目";
    return;
  }

  // Hold the identity that produced this visible row through both awaits. A
  // deleted/recreated member can have the same memberId but is a new person.
  const { memberId, identityRevision } = member;
  const id = contestId.value;
  const generation = pageGeneration;
  const isCurrent = () => !disposed && generation === pageGeneration && id === contestId.value;
  markSavingCellKey.value = buildCellKey(problemId, memberId);
  error.value = "";
  feedback.value = "";
  try {
    const manualStatus = await getManualMemberProblemStatusFromDb(memberId, problemId, identityRevision);
    if (!isCurrent()) return;
    const nextStatus = getNextManualStatus({ currentStatus, manualStatus });
    if (typeof nextStatus === "undefined") return;
    await upsertManualMemberProblemStatus({
      memberId,
      memberIdentityRevision: identityRevision,
      problemId,
      status: nextStatus,
      note: null,
    });
    emitMemberMutated();
    if (isCurrent()) feedback.value = `manual status set to ${nextStatus}`;
  } catch (caught) {
    if (!isCurrent()) return;
    error.value = caught && typeof caught === "object" && "name" in caught && caught.name === "AbortError"
      ? "成员已删除或重新创建，请使用更新后的做题情况重试"
      : caught instanceof Error ? caught.message : "failed to apply manual mark";
  } finally {
    if (isCurrent()) markSavingCellKey.value = "";
  }
}

watch(contestId, () => {
  saving.value = false;
  deleting.value = false;
  markMode.value = false;
  feedback.value = "";
  editing.value = false;
  void loadContestPage();
}, { immediate: true });
onUnmounted(() => {
  disposed = true;
  pageGeneration++;
  coverageSubscription?.unsubscribe();
  coverageSubscription = null;
});
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div v-if="loading" class="notice">正在加载比赛目录...</div>
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
            <div class="contest-detail-controls">
              <button
                type="button"
                role="switch"
                class="spoiler-switch"
                :aria-checked="showSpoilers"
                aria-label="显示剧透信息"
                title="显示牌线、奖牌和题目标签"
                :disabled="!spoilers.loaded || spoilers.saving.includes(contestId)"
                @click="spoilers.toggle(contestId, touched)"
              >
                <span class="spoiler-switch__label">{{ showSpoilers ? '剧透' : '非剧透' }}</span>
                <span class="spoiler-switch__track" aria-hidden="true"><span class="spoiler-switch__thumb"></span></span>
              </button>
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

                <section class="coverage-heatmap-card" aria-label="做题情况">
                <h3 class="detail-section-title">做题情况</h3>
                <div class="coverage-heatmap-shell">
                  <table class="coverage-heatmap">
                    <thead><tr><th>成员</th><th v-for="problem in coverage?.problems ?? []" :key="problem.problemId" :title="problem.title">{{ problem.ordinal }}</th></tr></thead>
                    <tbody>
                      <tr v-for="member in memberCoverageRows" :key="member.memberId">
                        <th :title="member.displayName">{{ member.displayName }}</th>
                        <td v-for="cell in member.cells" :key="cell.problemId">
                          <button type="button" class="coverage-cell-button"
                            :class="[{ 'coverage-cell-button--active': markMode }, `coverage-cell-button--${cell.status}`]"
                            :disabled="!markMode || !!markSavingCellKey"
                            :title="`${member.displayName} · ${cell.ordinal} ${cell.title}：${cell.status === 'solved' ? '已通过' : cell.status === 'attempted' ? '已尝试' : '未做'}`"
                            :aria-label="`${member.displayName} ${cell.ordinal}：${cell.status === 'solved' ? '已通过' : cell.status === 'attempted' ? '已尝试' : '未做'}`"
                            @click="applyMarkToCell(cell.problemId, member, cell.status)">
                            <span class="heatmap-cell-symbol">{{ markSavingCellKey === buildCellKey(cell.problemId, member.memberId) ? '…' : cell.status === 'solved' ? '✓' : cell.status === 'attempted' ? '·' : '' }}</span>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p v-if="!memberCoverageRows.length" class="muted tiny">暂无成员</p>
                </div>
                <div class="heatmap-legend muted tiny"><span><i class="heatmap-key heatmap-key--unseen"></i>未做</span><span><i class="heatmap-key heatmap-key--attempted"></i>尝试</span><span><i class="heatmap-key heatmap-key--solved"></i>通过</span></div>
                </section>
                <p v-if="spoilers.error" class="error-box">{{ spoilers.error }}</p>
                <div
                  v-if="showSpoilers && awardCutoffs && awardAxis"
                  class="award-strip"
                  :class="`award-strip--${awardPlacement?.toLowerCase() ?? 'fe'}`"
                >
                  <!-- Header: current solved + nudge -->
                  <div class="award-strip__head">
                    <div class="award-strip__current">
                      <span
                        v-if="awardPlacement"
                        :class="`contest-medal-badge contest-medal-badge--${awardPlacement.toLowerCase()}`"
                      >{{ awardPlacement }}</span>
                      <strong>{{ solvedProblemCount }} solved</strong>
                    </div>
                    <div v-if="nextAwardTarget" class="award-strip__nudge">
                      +{{ nextAwardTarget.remaining }} → {{ nextAwardTarget.label }}
                    </div>
                    <div v-else-if="awardPlacement === 'Au'" class="award-strip__nudge award-strip__nudge--gold">
                      ★ Au
                    </div>
                  </div>

                  <!-- Axis: horizontal line with Cu/Ag/Au markers and current-position needle -->
                  <div class="award-axis" aria-hidden="true">
                    <div class="award-axis__track">
                      <!-- Filled region up to current solved -->
                      <div class="award-axis__fill" :style="{ width: `${awardAxis.current.pct}%` }"></div>
                      <!-- Tier markers -->
                      <div
                        v-if="awardAxis.cu"
                        class="award-axis__marker award-axis__marker--cu"
                        :style="{ left: `${awardAxis.cu.pct}%` }"
                      ></div>
                      <div
                        v-if="awardAxis.ag"
                        class="award-axis__marker award-axis__marker--ag"
                        :style="{ left: `${awardAxis.ag.pct}%` }"
                      ></div>
                      <div
                        v-if="awardAxis.au"
                        class="award-axis__marker award-axis__marker--au"
                        :style="{ left: `${awardAxis.au.pct}%` }"
                      ></div>
                      <!-- Current position needle -->
                      <div
                        class="award-axis__needle"
                        :style="{ left: `${awardAxis.current.pct}%` }"
                      ></div>
                    </div>
                    <!-- Labels below the axis -->
                    <div class="award-axis__labels">
                      <div
                        v-if="awardAxis.cu"
                        class="award-axis__label"
                        :style="{ left: `${awardAxis.cu.pct}%` }"
                      >
                        <span class="award-axis__label-tier award-axis__label-tier--cu">Cu</span>
                        <span class="award-axis__label-val">{{ awardAxis.cu.solved }}</span>
                        <span v-if="awardAxis.cu.penalty != null" class="award-axis__label-pen muted">{{ awardAxis.cu.penalty }}</span>
                      </div>
                      <div
                        v-if="awardAxis.ag"
                        class="award-axis__label"
                        :style="{ left: `${awardAxis.ag.pct}%` }"
                      >
                        <span class="award-axis__label-tier award-axis__label-tier--ag">Ag</span>
                        <span class="award-axis__label-val">{{ awardAxis.ag.solved }}</span>
                        <span v-if="awardAxis.ag.penalty != null" class="award-axis__label-pen muted">{{ awardAxis.ag.penalty }}</span>
                      </div>
                      <div
                        v-if="awardAxis.au"
                        class="award-axis__label"
                        :style="{ left: `${awardAxis.au.pct}%` }"
                      >
                        <span class="award-axis__label-tier award-axis__label-tier--au">Au</span>
                        <span class="award-axis__label-val">{{ awardAxis.au.solved }}</span>
                        <span v-if="awardAxis.au.penalty != null" class="award-axis__label-pen muted">{{ awardAxis.au.penalty }}</span>
                      </div>
                    </div>
                  </div>

                  <p class="award-strip__source muted tiny">
                    <a :href="awardCutoffs.sourceUrl" target="_blank" rel="noreferrer">{{ awardCutoffs.sourceLabel }}</a>
                    <span v-if="awardCutoffSourceLabel"> · {{ awardCutoffSourceLabel }}</span>
                  </p>
                </div>
                <p v-else-if="showSpoilers" class="muted tiny" style="margin-bottom: 18px">
                  暂无预计算奖牌线。
                </p>



                <h3 class="detail-section-title">题目信息</h3>
                <div class="table-shell">
                  <table class="coverage-table">
                    <thead><tr><th class="coverage-table__title-column">题目</th><th v-if="showSpoilers" class="coverage-table__metadata-column">标签</th><th v-if="showSpoilers" class="coverage-table__rating-column">Rating</th></tr></thead>
                    <tbody>
                      <tr v-for="problem in coverage?.problems ?? []" :key="problem.problemId">
                        <td class="coverage-table__title-column"><div class="coverage-table__problem-title"><span class="problem-ordinal-label">{{ problem.ordinal }}</span><span>{{ problem.title }}</span></div></td>
                        <td v-if="showSpoilers" class="coverage-table__metadata-column"><div class="problem-metadata"><span v-for="tag in problemMetadata.get(problem.problemId)?.tags ?? []" :key="tag" class="problem-tag">{{ tag }}</span><span v-if="!problemMetadata.get(problem.problemId)?.tags?.length" class="muted">—</span></div></td>
                        <td v-if="showSpoilers" class="coverage-table__rating-column"><span v-if="problemMetadata.get(problem.problemId)?.rating != null" class="problem-rating" :class="ratingClass(problemMetadata.get(problem.problemId)?.rating)" title="XCPC Rating">{{ Math.round(problemMetadata.get(problem.problemId)!.rating!) }}</span><span v-else class="muted">—</span></td>
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

                <p v-if="visibleContestNotes" class="notice" style="margin-top: 16px">{{ visibleContestNotes }}</p>
              </div>
            </div>
          </div>
        </template>
        <p v-if="error" class="error-box">{{ error }}</p>
        <div v-if="contest && !loading" class="detail-bottom-actions">
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
        </div>
      </div>
    </section>
  </div>
</template>
