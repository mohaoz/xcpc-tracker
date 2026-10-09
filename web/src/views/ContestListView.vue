<script setup lang="ts">
import { useSettingsStore } from '../stores/settings';
import { selectAwardCutoffs } from '../lib/award-policy';
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import type { CatalogContestIndexItem } from "../lib/catalog";
import { listRuntimeCatalogContests, listRuntimeContestCoveragePayload, type RuntimeCatalogContestListRecord } from "../lib/catalog-runtime";
import {
  readMemberCoverageInputFromDb,
  subscribeCoverageDataMutated,
} from "../lib/local-db";
import { summarizeCatalogCoverage, type ContestCoverageInput, type MemberCoverageInput } from "../lib/local-coverage";
import type { LocalMemberPerson } from "../lib/local-model";
import { isContestTouched } from "../lib/spoiler-policy";
import { useSpoilerStore } from "../stores/spoilers";
import { contestListModes, isContestListMode, type ContestListMode, useContestListStore } from "../stores/contest-list";
import MemberPicker from "../components/MemberPicker.vue";

const contests = shallowRef<CatalogContestIndexItem[]>([]);
const localContestMap = shallowRef(new Map<string, RuntimeCatalogContestListRecord>());
const coverageInput = shallowRef<MemberCoverageInput | null>(null);
const coveragePayload = shallowRef<ContestCoverageInput[]>([]);
const loading = ref(false);
const error = ref("");
const generatedAt = ref("");
const memberOptions = shallowRef<LocalMemberPerson[]>([]);
let latestLoadRequestId = 0;
let unsubscribeCoverageDataMutated: (() => void) | null = null;
let active = false;
let needsReload = true;
const hasLoaded = ref(false);
const contestListStore = useContestListStore();
const spoilers = useSpoilerStore();
const settings = useSettingsStore();
const route = useRoute();
const router = useRouter();
const coverageSummaryMap = computed(() => new Map(
  coverageInput.value
    ? summarizeCatalogCoverage(coveragePayload.value, coverageInput.value, {
        memberIds: contestListStore.selectedMemberIds,
      }).map((summary) => [summary.contestId, summary])
    : [],
));

// Spoiler defaults follow the selected members, like "未做" and placement.
const touched = (id: string) => isContestTouched(coverageSummaryMap.value.get(id));
const showSpoilers = (id: string) => spoilers.visible(id, touched(id));

function normalizeContestListState() {
  if (!isContestListMode(contestListStore.selectedMode)) {
    contestListStore.selectedMode = "ALL";
  }
  if (!Array.isArray(contestListStore.selectedMemberIds)) {
    contestListStore.selectedMemberIds = [];
  }
  if (typeof contestListStore.query !== "string") {
    contestListStore.query = "";
  }
}

const listModeButtonLabels: Record<ContestListMode, string> = {
  ALL: "全部",
  UNSEEN: "未做",
  DONE: "已做",
};
// Compact symbols that share the 40px slot with the Fe/Cu/Ag/Au range badges;
// their meaning is explained in the hover title and on the help page.
const listModeBadgeLabels: Record<ContestListMode, string> = {
  ALL: "·",
  UNSEEN: "-",
  DONE: "✓",
};
const listModeTips: Record<ContestListMode, string> = {
  ALL: "全部比赛",
  UNSEEN: "所选成员均未尝试或通过本场任何题目",
  DONE: "至少一位所选成员尝试或通过了本场题目",
};

const awardSearchAliases = {
  FE: ["fe", "铁", "铁牌"],
  CU: ["cu", "铜", "铜牌"],
  AG: ["ag", "银", "银牌"],
  AU: ["au", "金", "金牌"],
} as const;

type ContestAwardMode = keyof typeof awardSearchAliases;

const awardModeTips: Record<ContestAwardMode, string> = {
  FE: "所选成员碰过本场，但通过数低于铜牌线（只有尝试也算）",
  CU: "所选成员组合覆盖达到铜牌线",
  AG: "所选成员组合覆盖达到银牌线",
  AU: "所选成员组合覆盖达到金牌线",
};

function getAwardModeFromSearchToken(token: string): ContestAwardMode | null {
  for (const [mode, aliases] of Object.entries(awardSearchAliases) as Array<[ContestAwardMode, readonly string[]]>) {
    if (aliases.includes(token)) {
      return mode;
    }
  }
  return null;
}

function isNoMedalDataSearchToken(token: string) {
  return token === "?" || token === "无奖牌" || token === "无奖牌数据";
}

type QueryAlternative = {
  token: string;
  negated: boolean;
};

function parseQueryGroup(token: string): QueryAlternative[] {
  return token
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item && item !== "-")
    .map((item) => ({
      token: item.startsWith("-") ? item.slice(1) : item,
      negated: item.startsWith("-"),
    }))
    .filter((item) => item.token.length > 0);
}

function extractContestYear(contest: Pick<CatalogContestIndexItem, "title" | "tags">) {
  for (const tag of contest.tags) {
    const match = tag.match(/^(19|20)\d{2}$/);
    if (match) {
      return Number.parseInt(match[0], 10);
    }
  }

  const titleMatch = contest.title.match(/\b(19|20)\d{2}\b/);
  if (titleMatch) {
    return Number.parseInt(titleMatch[0], 10);
  }

  return -1;
}

function compareContestsByTime(left: CatalogContestIndexItem, right: CatalogContestIndexItem) {
  const yearDiff = extractContestYear(right) - extractContestYear(left);
  if (yearDiff !== 0) {
    return yearDiff;
  }
  const leftStart = left.start_at ? Date.parse(left.start_at) : Number.NaN;
  const rightStart = right.start_at ? Date.parse(right.start_at) : Number.NaN;
  if (Number.isFinite(leftStart) || Number.isFinite(rightStart)) {
    if (!Number.isFinite(leftStart)) return 1;
    if (!Number.isFinite(rightStart)) return -1;
    if (leftStart !== rightStart) return rightStart - leftStart;
  }
  return left.title.localeCompare(right.title);
}

function getContestSearchHaystacks(contest: CatalogContestIndexItem) {
  const sourceTokens: string[] = [];
  const localContest = localContestMap.value.get(contest.id);
  for (const source of localContest?.sources ?? []) {
    sourceTokens.push(source.provider);
    if (source.provider === "codeforces") {
      sourceTokens.push("cf");
      sourceTokens.push("codeforces");
    }
    if (source.provider === "qoj") {
      sourceTokens.push("qoj");
    }
    if (source.kind) {
      sourceTokens.push(source.kind);
    }
    if (source.source_title) {
      sourceTokens.push(source.source_title);
    }
  }

  return [contest.title, ...contest.aliases, ...contest.tags, contest.start_at ?? "", ...sourceTokens]
    .map((value) => value.toLocaleLowerCase());
}

const queryTokens = computed(() =>
  contestListStore.query
    .split(/\s+/)
    .map((token) => token.trim().toLocaleLowerCase())
    .filter(Boolean),
);
const queryGroups = computed(() =>
  queryTokens.value.map(parseQueryGroup).filter((group) => group.length > 0),
);
function getSolvedCutoff(
  contest: RuntimeCatalogContestListRecord | undefined,
  medal: "gold" | "silver" | "bronze",
) {
  const solved = selectAwardCutoffs(contest, settings.allowMedalEstimates)?.cutoffs[medal]?.solved;
  return typeof solved === "number" ? solved : null;
}

function getContestListMode(contestId: string): ContestListMode {
  const summary = coverageSummaryMap.value.get(contestId);
  return isContestTouched(summary) ? "DONE" : "UNSEEN";
}

function getContestAwardMode(contestId: string): ContestAwardMode | null {
  if (!showSpoilers(contestId)) return null;
  const localContest = localContestMap.value.get(contestId);
  const summary = coverageSummaryMap.value.get(contestId);
  const solvedProblemCount = summary?.solvedProblemCount ?? 0;
  const bronzeSolved = getSolvedCutoff(localContest, "bronze");
  const goldSolved = getSolvedCutoff(localContest, "gold");
  const silverSolved = getSolvedCutoff(localContest, "silver");

  if (!isContestTouched(summary)) {
    return null;
  }
  if (bronzeSolved === null) {
    return null;
  }
  if (goldSolved !== null && solvedProblemCount >= goldSolved) {
    return "AU";
  }
  if (silverSolved !== null && solvedProblemCount >= silverSolved) {
    return "AG";
  }
  if (solvedProblemCount >= bronzeSolved) {
    return "CU";
  }
  return "FE";
}

function getContestBadgeMode(contestId: string): ContestListMode | "NONE-MEDAL-DATA" {
  const listMode = getContestListMode(contestId);
  if (showSpoilers(contestId) && listMode === "DONE" && !getContestAwardMode(contestId)) {
    return "NONE-MEDAL-DATA";
  }
  return listMode;
}

function getContestBadgeLabel(contestId: string) {
  return getContestBadgeMode(contestId) === "NONE-MEDAL-DATA" ? "?" : listModeBadgeLabels[getContestListMode(contestId)];
}

function getContestBadgeTitle(contestId: string) {
  return getContestBadgeMode(contestId) === "NONE-MEDAL-DATA"
    ? "暂无奖牌线数据"
    : listModeTips[getContestListMode(contestId)];
}

function getContestBadgeSearchToken(contestId: string) {
  return getContestBadgeMode(contestId) === "NONE-MEDAL-DATA" ? "?" : null;
}

function getContestAwardRange(contestId: string) {
  const localContest = localContestMap.value.get(contestId);
  const mode = getContestAwardMode(contestId);
  const bronzeSolved = getSolvedCutoff(localContest, "bronze");
  const silverSolved = getSolvedCutoff(localContest, "silver");
  const goldSolved = getSolvedCutoff(localContest, "gold");

  if (!mode) {
    return null;
  }

  if (mode === "FE" && bronzeSolved !== null) {
    return { mode, label: "Fe", lower: 0, upper: bronzeSolved };
  }
  if (mode === "CU" && bronzeSolved !== null) {
    return { mode, label: "Cu", lower: bronzeSolved, upper: silverSolved };
  }
  if (mode === "AG" && silverSolved !== null) {
    return { mode, label: "Ag", lower: silverSolved, upper: goldSolved };
  }
  if (mode === "AU" && goldSolved !== null) {
    return { mode, label: "Au", lower: goldSolved, upper: "∞" };
  }
  return null;
}

// Pre-compute award range and source label for each contest once per
// render cycle so the template doesn't call these functions repeatedly
// for every card binding.
const contestAwardRangeMap = computed(() => {
  const map = new Map<string, ReturnType<typeof getContestAwardRange>>();
  for (const contest of contests.value) {
    map.set(contest.id, getContestAwardRange(contest.id));
  }
  return map;
});

const contestSourceLabelMap = computed(() => {
  const map = new Map<string, string>();
  for (const [id, contest] of localContestMap.value) {
    const sources = contest.sources ?? [];
    const preferred = sources.some(s => s.kind === "contest")
      ? sources.filter(s => s.kind === "contest")
      : sources;
    const labels = preferred.map(s => {
      const provider = s.provider.trim().toUpperCase();
      const pid = (s.provider_contest_id ?? "").trim();
      if (pid) return `${provider} / ${pid}`;
      const title = (s.source_title ?? s.label ?? "").trim();
      return title ? `${provider} / ${title}` : provider;
    });
    map.set(id, labels.length ? labels.join(" | ") : "CURATED CONTEST");
  }
  return map;
});

const filteredContests = computed(() => {
  return contests.value.filter((contest) => {
    if (queryTokens.value.length) {
      const haystacks = getContestSearchHaystacks(contest);
      const awardMode = getContestAwardMode(contest.id);
      const hasNoMedalData = getContestBadgeMode(contest.id) === "NONE-MEDAL-DATA";

      const matchesToken = (token: string) => {
        const tokenAwardMode = getAwardModeFromSearchToken(token);
        if (tokenAwardMode) {
          return awardMode === tokenAwardMode;
        }
        if (isNoMedalDataSearchToken(token)) {
          return hasNoMedalData;
        }
        return haystacks.some((value) => value.includes(token));
      };

      const queryMatch = queryGroups.value.every((group) =>
        group.some((alternative) => {
          if (!showSpoilers(contest.id) && (getAwardModeFromSearchToken(alternative.token) || isNoMedalDataSearchToken(alternative.token))) return false;
          return alternative.negated !== matchesToken(alternative.token);
        }),
      );
      if (!queryMatch) {
        return false;
      }
    }

    return contestListStore.selectedMode === "ALL" || contestListStore.selectedMode === getContestListMode(contest.id);
  });
});
const detailQuery = computed(() => {
  const members = contestListStore.memberQuery();
  return members ? { members } : {};
});
const totalCount = computed(() => filteredContests.value.length);

const pageLabel = computed(() => {
  if (!totalCount.value) return "0 场";
  return `${totalCount.value} 场`;
});

const latestSyncLabel = computed(() => {
  const latest = generatedAt.value;
  if (!latest) {
    return "还没有 catalog 生成记录";
  }

  const parsed = new Date(latest);
  if (Number.isNaN(parsed.getTime())) {
    return latest;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
});

async function loadContests() {
  if (loading.value || !needsReload) return;
  const requestId = ++latestLoadRequestId;
  needsReload = false;
  loading.value = true;
  error.value = "";
  try {
    const [membersInput, runtimeCatalog, nextCoveragePayload] = await Promise.all([
      readMemberCoverageInputFromDb(),
      listRuntimeCatalogContests(),
      listRuntimeContestCoveragePayload(),
    ]);
    if (requestId !== latestLoadRequestId) return;
    const localMembers = membersInput.members;
    memberOptions.value = localMembers;
    contestListStore.syncAvailableMembers(localMembers.map((member) => member.memberId));
    coverageInput.value = membersInput;
    coveragePayload.value = nextCoveragePayload;
    const summaries = coverageSummaryMap.value;
    localContestMap.value = new Map(runtimeCatalog.contests.map((contest) => [contest.contestId, contest]));
    contests.value = runtimeCatalog.contests.map((contest): CatalogContestIndexItem => ({
      id: contest.contestId,
      title: contest.title,
      aliases: contest.aliases,
      tags: contest.tags,
      start_at: contest.startAt,
      curation_status: contest.curationStatus,
      sources: contest.sources,
      awardCutoffs: contest.awardCutoffs ?? null,
      notes: contest.notes ?? null,
      generated_from: contest.generatedFrom ?? "catalog",
      problem_count: summaries.get(contest.contestId)?.problemCount ?? contest.problemCount,
    })).sort(compareContestsByTime);
    generatedAt.value = runtimeCatalog.generatedAt ?? "";
    hasLoaded.value = true;
  } catch (caught) {
    if (requestId !== latestLoadRequestId) return;
    needsReload = true;
    error.value = caught instanceof Error ? caught.message : "failed to load contests";
  } finally {
    if (requestId === latestLoadRequestId) {
      loading.value = false;
      // A write during this read needs another snapshot, but failures wait for a retry.
      if (needsReload && active && !error.value) void loadContests();
    }
  }
}

function invalidateCoverageData() {
  needsReload = true;
  if (active) void loadContests();
}

function setListMode(mode: ContestListMode) {
  contestListStore.selectedMode = mode;
}

function contestBadgeClass(contestId: string) {
  return `contest-medal-badge--${getContestBadgeMode(contestId).toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
}

function awardRangeClass(mode: ContestAwardMode) {
  return `contest-award-range--${mode.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
}

function awardRangeTitle(contestId: string) {
  const mode = getContestAwardMode(contestId);
  return mode ? awardModeTips[mode] : "";
}

function problemStateClass(status: "solved" | "attempted" | "unseen") {
  return `contest-problem-state--${status}`;
}

function clearQuery() {
  contestListStore.query = "";
  contestListStore.selectedMode = "ALL";
}

function appendSearchToken(rawToken: string) {
  const normalized = rawToken.trim();
  if (!normalized) {
    return;
  }
  const existing = new Set(queryTokens.value);
  if (existing.has(normalized.toLocaleLowerCase())) {
    return;
  }
  contestListStore.query = [contestListStore.query.trim(), normalized].filter(Boolean).join(" ");
}

// Sync store state to/from URL query parameters
function syncFromUrl() {
  const q = route.query.q;
  if (typeof q === 'string') contestListStore.query = q;

  const mode = route.query.mode;
  if (typeof mode === 'string' && isContestListMode(mode)) contestListStore.selectedMode = mode;

  contestListStore.applyMemberQuery(route.query.members);
}

function syncToUrl() {
  const query: Record<string, string> = {};
  if (contestListStore.query) query.q = contestListStore.query;
  if (contestListStore.selectedMode !== 'ALL') query.mode = contestListStore.selectedMode;
  const members = contestListStore.memberQuery();
  if (members) query.members = members;

  router.replace({ query }).catch(() => {});
}

let urlSyncScheduled = false;
function scheduleUrlSync() {
  // The list stays alive while detail is open; never rewrite another page's URL.
  if (!active || urlSyncScheduled) return;
  urlSyncScheduled = true;
  requestAnimationFrame(() => {
    urlSyncScheduled = false;
    syncToUrl();
  });
}

onMounted(() => {
  syncFromUrl();
  normalizeContestListState();
  unsubscribeCoverageDataMutated = subscribeCoverageDataMutated(invalidateCoverageData);
});
onActivated(() => {
  active = true;
  // While the app runs, the shared selection is the source of truth: the URL is
  // read only on first mount, and re-activation (including browser back from
  // detail) rewrites the list URL from the shared state.
  scheduleUrlSync();
  void loadContests();
});
onDeactivated(() => {
  active = false;
});
onUnmounted(() => {
  ++latestLoadRequestId;
  unsubscribeCoverageDataMutated?.();
});
watch(queryTokens, () => { scheduleUrlSync(); });
watch(() => contestListStore.selectedMemberIds, () => { scheduleUrlSync(); }, { deep: true });
watch(() => contestListStore.selectedMode, () => { scheduleUrlSync(); });
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div class="contest-toolbar">
          <div class="contest-toolbar__filters">
            <div class="filter-toggle-row">
              <div class="mode-switch">
                <span class="mode-switch__label">列表模式</span>
                <div class="mode-switch__rail">
                  <button
                    v-for="mode in contestListModes"
                    :key="mode"
                    type="button"
                    class="mode-switch__option"
                    :class="{ 'mode-switch__option--active': contestListStore.selectedMode === mode }"
                    :aria-pressed="contestListStore.selectedMode === mode"
                    @click="setListMode(mode)"
                  >
                    {{ listModeButtonLabels[mode] }}
                  </button>
                </div>
              </div>
              <div class="filter-toggle-row__actions">
                <div class="inline-tags">
                  <span class="tag tag--neutral">{{ pageLabel }}</span>
                </div>
                <button
                  v-if="contestListStore.query.trim()"
                  class="button button--ghost"
                  type="button"
                  @click="clearQuery()"
                >
                  清空筛选
                </button>
              </div>
            </div>

            <div class="field">
              <label for="contest-query">搜索</label>
              <input
                id="contest-query"
                v-model="contestListStore.query"
                placeholder="标题、标签、年份、平台、奖牌"
                aria-describedby="contest-query-help"
              />
              <p id="contest-query-help" class="muted tiny search-help">
                空格分隔多个条件（都要满足）· <code>-</code> 排除，如 <code>-省赛</code> · <code>|</code> 表示或，如 <code>南京|沈阳</code> · 奖牌区间 <code>fe</code> <code>cu</code> <code>ag</code> <code>au</code> · <code>?</code> 无牌线（奖牌条件仅在剧透下生效）
              </p>
            </div>

            <MemberPicker :members="memberOptions" />

          </div>
        </div>

        <div v-if="error" class="error-box" style="margin-bottom: 16px">
          {{ error }}
          <button type="button" class="button button--ghost" :disabled="loading" @click="loadContests">重试</button>
        </div>

        <p v-if="spoilers.error" class="error-box">{{ spoilers.error }}</p>
        <div v-if="loading && !hasLoaded" class="notice">正在加载比赛…</div>
        <div v-else-if="!contests.length" class="notice">
          当前没有可显示的比赛数据。
        </div>
        <div v-else-if="!filteredContests.length" class="notice">
          当前标签筛选下没有匹配的比赛。
        </div>
        <div v-else class="list-grid">
          <RouterLink
            v-for="contest in filteredContests"
            :key="contest.id"
            v-memo="[contest.id, coverageSummaryMap.get(contest.id), contestAwardRangeMap.get(contest.id), showSpoilers(contest.id)]"
            :to="{ path: `/contests/${contest.id}`, query: detailQuery }"
            class="contest-card"
          >
            <div class="contest-card__top">
              <div>
                <p class="contest-source-label">{{ contestSourceLabelMap.get(contest.id) }}</p>
                <h3>{{ contest.title }}</h3>
              </div>
            </div>

            <div class="contest-card__meta-row">
              <div class="contest-card__meta-main">
                <div class="inline-tags">
                  <button
                    v-if="contestAwardRangeMap.get(contest.id)"
                    type="button"
                    class="contest-award-range"
                    :class="[
                      awardRangeClass(contestAwardRangeMap.get(contest.id)!.mode),
                      {
                        'contest-award-range--no-lower': contestAwardRangeMap.get(contest.id)!.lower === null,
                        'contest-award-range--no-upper': contestAwardRangeMap.get(contest.id)!.upper === null,
                      },
                    ]"
                    :title="awardRangeTitle(contest.id)"
                    @click.prevent.stop="appendSearchToken(contestAwardRangeMap.get(contest.id)!.label ?? '')"
                  >
                    <sub
                      v-if="contestAwardRangeMap.get(contest.id)!.lower !== null"
                      class="contest-award-range__bound contest-award-range__bound--lower"
                    >{{ contestAwardRangeMap.get(contest.id)!.lower }}</sub>
                    <span class="contest-award-range__label">{{ contestAwardRangeMap.get(contest.id)!.label }}</span>
                    <sup
                      v-if="contestAwardRangeMap.get(contest.id)!.upper !== null"
                      class="contest-award-range__bound contest-award-range__bound--upper"
                    >{{ contestAwardRangeMap.get(contest.id)!.upper }}</sup>
                  </button>
                  <button
                    v-else
                    type="button"
                    class="contest-medal-badge"
                    :class="contestBadgeClass(contest.id)"
                    :title="getContestBadgeTitle(contest.id)"
                    @click.prevent.stop="appendSearchToken(getContestBadgeSearchToken(contest.id) ?? '')"
                  >
                    {{ getContestBadgeLabel(contest.id) }}
                  </button>
                  <span class="tag tag--neutral">
                    {{ coverageSummaryMap.get(contest.id)?.problemCount ?? contest.problem_count }} 题
                  </span>
                  <span class="tag tag--neutral">
                    已做 {{ coverageSummaryMap.get(contest.id)?.solvedProblemCount ?? 0 }}
                  </span>
                </div>
                <div
                  v-if="coverageSummaryMap.get(contest.id)?.problemStates.length"
                  class="contest-problem-strip"
                >
                  <span
                    v-for="problem in coverageSummaryMap.get(contest.id)?.problemStates ?? []"
                    :key="`${contest.id}-${problem.ordinal}`"
                    class="contest-problem-state"
                    :class="problemStateClass(problem.status)"
                    :title="`${problem.ordinal}: ${problem.status}`"
                  >
                    {{ problem.ordinal }}
                  </span>
                </div>
                <span v-else class="contest-card__empty-source">本地目录里还没有这场的题目数据</span>
              </div>
              <span class="contest-card__link-mark" aria-hidden="true">查看 →</span>
            </div>

            <div v-if="contest.tags.length" class="inline-tags" style="margin-top: 16px">
              <button
                v-for="tag in contest.tags"
                :key="tag"
                type="button"
                class="tag-chip tag-chip--card"
                @click.prevent.stop="appendSearchToken(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </RouterLink>
        </div>

      </div>
    </section>
  </div>
</template>
