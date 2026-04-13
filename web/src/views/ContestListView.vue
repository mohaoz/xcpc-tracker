<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import type { CatalogContestIndexItem } from "../lib/catalog";
import { subscribeCatalogMutated } from "../lib/catalog-events";
import { listRuntimeCatalogContests, listRuntimeContestCoveragePayload, type RuntimeCatalogContestListRecord } from "../lib/catalog-runtime";
import {
  listContestCoverageSummariesForCatalog,
  listMemberPeopleFromDb,
} from "../lib/local-db";
import type {
  LocalContestCoverageSummary,
  LocalMemberPerson,
} from "../lib/local-model";
import { contestListModes, type ContestListMode, useContestListStore } from "../stores/contest-list";

const contests = ref<CatalogContestIndexItem[]>([]);
const localContestMap = ref(new Map<string, RuntimeCatalogContestListRecord>());
const coverageSummaryMap = ref(new Map<string, LocalContestCoverageSummary>());
const loading = ref(false);
const error = ref("");
const generatedAt = ref("");
const memberOptions = ref<LocalMemberPerson[]>([]);
let latestLoadRequestId = 0;
const pageSize = 12;
let unsubscribeCatalogMutated: (() => void) | null = null;
const contestListStore = useContestListStore();
const listModeButtonLabels: Record<ContestListMode, string> = {
  UNSEEN: "未做",
  "NONE-MEDAL-DATA": "已做",
  FE: "铁牌",
  CU: "铜牌",
  AG: "银牌",
  AU: "金牌",
};
const listModeBadgeLabels: Record<ContestListMode, string> = {
  UNSEEN: "-",
  "NONE-MEDAL-DATA": "?",
  FE: "Fe",
  CU: "Cu",
  AG: "Ag",
  AU: "Au",
};
const listModeTips: Record<ContestListMode, string> = {
  "NONE-MEDAL-DATA": "No medal cutoff data",
  UNSEEN: "No selected member has tried any problem in this contest",
  FE: "The selected members have tried this contest but combined coverage is below the bronze cutoff",
  CU: "The selected members' combined coverage reached the bronze cutoff",
  AG: "The selected members' combined coverage reached the silver cutoff",
  AU: "The selected members' combined coverage reached the gold cutoff",
};

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

  return [contest.title, ...contest.aliases, ...contest.tags, ...sourceTokens]
    .map((value) => value.toLocaleLowerCase());
}

const queryTokens = computed(() =>
  contestListStore.query
    .split(/\s+/)
    .map((token) => token.trim().toLocaleLowerCase())
    .filter(Boolean),
);
const includeQueryTokens = computed(() =>
  queryTokens.value.filter((token) => token !== "-" && !token.startsWith("-")),
);
const excludeQueryTokens = computed(() =>
  queryTokens.value
    .filter((token) => token.startsWith("-") && token.length > 1)
    .map((token) => token.slice(1)),
);
const allMembersSelected = computed(() => {
  if (!memberOptions.value.length) {
    return true;
  }
  return contestListStore.selectedMemberIds.length === memberOptions.value.length;
});
function getSolvedCutoff(
  contest: RuntimeCatalogContestListRecord | undefined,
  medal: "gold" | "silver" | "bronze",
) {
  const solved = contest?.awardCutoffs?.cutoffs[medal]?.solved;
  return typeof solved === "number" ? solved : null;
}

function getContestListMode(contestId: string): ContestListMode {
  const localContest = localContestMap.value.get(contestId);
  const summary = coverageSummaryMap.value.get(contestId);
  const solvedProblemCount = summary?.solvedProblemCount ?? 0;
  const attemptedProblemCount = summary?.attemptedProblemCount ?? 0;
  const bronzeSolved = getSolvedCutoff(localContest, "bronze");
  const goldSolved = getSolvedCutoff(localContest, "gold");
  const silverSolved = getSolvedCutoff(localContest, "silver");

  if (solvedProblemCount === 0 && attemptedProblemCount === 0) {
    return "UNSEEN";
  }
  if (bronzeSolved === null) {
    return "NONE-MEDAL-DATA";
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

function getContestAwardRange(contestId: string) {
  const localContest = localContestMap.value.get(contestId);
  const mode = getContestListMode(contestId);
  const bronzeSolved = getSolvedCutoff(localContest, "bronze");
  const silverSolved = getSolvedCutoff(localContest, "silver");
  const goldSolved = getSolvedCutoff(localContest, "gold");

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

const filteredContests = computed(() => {
  return contests.value.filter((contest) => {
    if (queryTokens.value.length) {
      const haystacks = getContestSearchHaystacks(contest);

      const includeMatch = includeQueryTokens.value.every((token) =>
        haystacks.some((value) => value.includes(token)),
      );
      if (!includeMatch) {
        return false;
      }

      const excludeMatch = excludeQueryTokens.value.some((token) =>
        haystacks.some((value) => value.includes(token)),
      );
      if (excludeMatch) {
        return false;
      }
    }

    return contestListStore.selectedModes.includes(getContestListMode(contest.id));
  });
});
const totalCount = computed(() => filteredContests.value.length);
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize)));
const pageButtons = computed<(number | string)[]>(() => {
  const total = totalPages.value;
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const current = contestListStore.page;
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (current >= total - 2) {
    pages.add(total - 1);
    pages.add(total - 2);
    pages.add(total - 3);
  }
  const sorted = [...pages]
    .filter((value) => value >= 1 && value <= total)
    .sort((left, right) => left - right);
  const result: Array<number | string> = [];
  for (const value of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && value - previous > 1) {
      result.push("...");
    }
    result.push(value);
  }
  return result;
});

const visibleContests = computed(() => {
  const start = (contestListStore.page - 1) * pageSize;
  return filteredContests.value.slice(start, start + pageSize);
});

const pageLabel = computed(() => {
  if (!totalCount.value) {
    return "0 of 0";
  }
  const start = (contestListStore.page - 1) * pageSize + 1;
  const end = Math.min(contestListStore.page * pageSize, totalCount.value);
  return `${start}-${end} of ${totalCount.value}`;
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
  const requestId = ++latestLoadRequestId;
  loading.value = true;
  error.value = "";
  try {
    const localMembers = await listMemberPeopleFromDb();
    if (requestId !== latestLoadRequestId) {
      return;
    }
    memberOptions.value = localMembers;
    const availableMemberIds = new Set(localMembers.map((member) => member.memberId));
    const hasInvalidSelection = contestListStore.selectedMemberIds.some((memberId) => !availableMemberIds.has(memberId));
    const shouldInitializeSelection =
      !contestListStore.memberSelectionInitialized && memberOptions.value.length > 0;
    if (shouldInitializeSelection || hasInvalidSelection) {
      contestListStore.selectedMemberIds = localMembers.map((member) => member.memberId);
      contestListStore.memberSelectionInitialized = true;
    }
    const [runtimeCatalog, coveragePayload] = await Promise.all([
      listRuntimeCatalogContests(),
      listRuntimeContestCoveragePayload(),
    ]);
    const coverageSummaries = await listContestCoverageSummariesForCatalog(coveragePayload, {
      memberIds: contestListStore.selectedMemberIds,
    });
    if (requestId !== latestLoadRequestId) {
      return;
    }
    const localContestById = new Map(runtimeCatalog.contests.map((contest) => [contest.contestId, contest]));
    const localItems: CatalogContestIndexItem[] = runtimeCatalog.contests.map((contest) => ({
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
      problem_count:
        coverageSummaries.find((summary) => summary.contestId === contest.contestId)?.problemCount ??
        contest.problemCount,
    }));
    contests.value = localItems.sort(compareContestsByTime);
    localContestMap.value = localContestById;
    coverageSummaryMap.value = new Map(
      coverageSummaries.map((summary) => [summary.contestId, summary]),
    );
    generatedAt.value = runtimeCatalog.generatedAt ?? "";
    if (contestListStore.page > totalPages.value) {
      contestListStore.page = totalPages.value;
    }
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

function toggleMember(memberId: string) {
  if (contestListStore.selectedMemberIds.includes(memberId)) {
    contestListStore.selectedMemberIds = contestListStore.selectedMemberIds.filter((id) => id !== memberId);
    return;
  }
  contestListStore.selectedMemberIds = [...contestListStore.selectedMemberIds, memberId];
}

function toggleAllMembers() {
  if (allMembersSelected.value) {
    contestListStore.selectedMemberIds = [];
    return;
  }
  contestListStore.selectedMemberIds = memberOptions.value.map((member) => member.memberId);
}

function toggleListMode(mode: ContestListMode) {
  if (contestListStore.selectedModes.includes(mode)) {
    contestListStore.selectedModes = contestListStore.selectedModes.filter((item) => item !== mode);
    return;
  }
  contestListStore.selectedModes = contestListModes.filter(
    (item) => item === mode || contestListStore.selectedModes.includes(item),
  );
}

function listModeBadgeClass(mode: ContestListMode) {
  return `contest-medal-badge--${mode.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
}

function awardRangeClass(mode: ContestListMode) {
  return `contest-award-range--${mode.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
}

function problemStateClass(status: "solved" | "attempted" | "unseen") {
  return `contest-problem-state--${status}`;
}

function contestSourceLabel(contestId: string) {
  const contest = localContestMap.value.get(contestId);
  const sourceLabels = (contest?.sources ?? [])
    .filter((item) => item.kind === "contest")
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
}

function goToPage(nextPage: number) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === contestListStore.page) {
    return;
  }
  contestListStore.page = nextPage;
}

function clearQuery() {
  contestListStore.query = "";
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

onMounted(() => {
  unsubscribeCatalogMutated = subscribeCatalogMutated(() => {
    void loadContests();
  });
  void loadContests();
});
onUnmounted(() => {
  unsubscribeCatalogMutated?.();
  unsubscribeCatalogMutated = null;
});
watch(queryTokens, () => {
  if (contestListStore.page !== 1) {
    contestListStore.page = 1;
  }
});
watch(() => contestListStore.selectedMemberIds, () => {
  if (contestListStore.page !== 1) {
    contestListStore.page = 1;
  }
  void loadContests();
}, { deep: true });
watch(() => contestListStore.selectedModes, () => {
  if (contestListStore.page !== 1) {
    contestListStore.page = 1;
  }
}, { deep: true });
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div class="panel__header">
          <div></div>
          <div></div>
        </div>

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
                    :class="{ 'mode-switch__option--active': contestListStore.selectedModes.includes(mode) }"
                    @click="toggleListMode(mode)"
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
                placeholder="搜索标题、alias、tags 或平台如 qoj / cf；用 -2025 这类写法排除"
              />
            </div>

            <div class="field">
              <label>Members</label>
              <div class="member-filter-picker">
                <button
                  type="button"
                  class="member-filter-chip member-filter-chip--action"
                  :class="{
                    'member-filter-chip--action-active': allMembersSelected,
                    'member-filter-chip--action-empty': !allMembersSelected,
                  }"
                  @click="toggleAllMembers"
                >
                  全选
                </button>
                <button
                  v-for="member in memberOptions"
                  :key="member.memberId"
                  type="button"
                  class="member-filter-chip"
                  :class="{ 'member-filter-chip--selected': contestListStore.selectedMemberIds.includes(member.memberId) }"
                  @click="toggleMember(member.memberId)"
                  >
                    {{ member.displayName }}
                  </button>
                  <RouterLink
                    v-if="!memberOptions.length"
                    to="/members/new"
                    class="member-filter-chip member-filter-chip--hint"
                  >
                    去导入成员
                  </RouterLink>
              </div>
            </div>

          </div>
        </div>

        <p v-if="error" class="error-box" style="margin-bottom: 16px">{{ error }}</p>

        <div v-if="loading" class="notice">catalog loading...</div>
        <div v-else-if="!contests.length" class="notice">
          当前没有可显示的比赛数据。
        </div>
        <div v-else-if="!visibleContests.length" class="notice">
          当前标签筛选下没有匹配的比赛。
        </div>
        <div v-else class="list-grid">
          <RouterLink
            v-for="contest in visibleContests"
            :key="contest.id"
            :to="`/contests/${contest.id}`"
            class="contest-card"
          >
            <div class="contest-card__top">
              <div>
                <p class="eyebrow">{{ contestSourceLabel(contest.id) }}</p>
                <h3>{{ contest.title }}</h3>
              </div>
            </div>

            <div class="contest-card__meta-row">
              <div class="contest-card__meta-main">
                <div class="inline-tags">
                  <span
                    v-if="getContestAwardRange(contest.id)"
                    class="contest-award-range"
                    :class="[
                      awardRangeClass(getContestAwardRange(contest.id)?.mode ?? 'FE'),
                      {
                        'contest-award-range--no-lower': getContestAwardRange(contest.id)?.lower === null,
                        'contest-award-range--no-upper': getContestAwardRange(contest.id)?.upper === null,
                      },
                    ]"
                    :title="listModeTips[getContestListMode(contest.id)]"
                  >
                    <sub
                      v-if="getContestAwardRange(contest.id)?.lower !== null"
                      class="contest-award-range__bound contest-award-range__bound--lower"
                    >
                      {{ getContestAwardRange(contest.id)?.lower }}
                    </sub>
                    <span class="contest-award-range__label">
                      {{ getContestAwardRange(contest.id)?.label }}
                    </span>
                    <sup
                      v-if="getContestAwardRange(contest.id)?.upper !== null"
                      class="contest-award-range__bound contest-award-range__bound--upper"
                    >
                      {{ getContestAwardRange(contest.id)?.upper }}
                    </sup>
                  </span>
                  <span
                    v-else
                    class="contest-medal-badge"
                    :class="listModeBadgeClass(getContestListMode(contest.id))"
                    :title="listModeTips[getContestListMode(contest.id)]"
                  >
                    {{ listModeBadgeLabels[getContestListMode(contest.id)] }}
                  </span>
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
              <span class="contest-card__link-mark" aria-hidden="true">查看 ↗</span>
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

        <div v-if="totalPages > 1" class="pagination-bar">
          <button class="button button--ghost" :disabled="loading || contestListStore.page <= 1" @click="goToPage(contestListStore.page - 1)">
            上一页
          </button>
          <div class="pagination-pages">
            <button
              v-for="(item, index) in pageButtons"
              :key="`${item}-${index}`"
              class="pagination-page"
              :class="{ 'pagination-page--active': item === contestListStore.page, 'pagination-page--ellipsis': item === '...' }"
              :disabled="loading || item === '...'"
              @click="typeof item === 'number' && goToPage(item)"
            >
              {{ item }}
            </button>
          </div>
          <button class="button button--ghost" :disabled="loading || contestListStore.page >= totalPages" @click="goToPage(contestListStore.page + 1)">
            下一页
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
