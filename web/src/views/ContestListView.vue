<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import type { CatalogContestIndexItem } from "../lib/catalog";
import { importBundledCatalogSnapshot } from "../lib/catalog-cache";
import { subscribeCatalogMutated } from "../lib/catalog-events";
import {
  getCatalogDbStatus,
  listDeletedCatalogContestIdsFromDb,
  listCatalogContestsFromDb,
  listContestCoverageSummariesFromDb,
  listMemberPeopleFromDb,
} from "../lib/local-db";
import type {
  LocalCatalogContestRecord,
  LocalContestCoverageSummary,
  LocalMemberPerson,
} from "../lib/local-model";
import { useContestListStore } from "../stores/contest-list";

const contests = ref<CatalogContestIndexItem[]>([]);
const localContestMap = ref(new Map<string, LocalCatalogContestRecord>());
const coverageSummaryMap = ref(new Map<string, LocalContestCoverageSummary>());
const loading = ref(false);
const importingDefaultData = ref(false);
const error = ref("");
const generatedAt = ref("");
const memberOptions = ref<LocalMemberPerson[]>([]);
let latestLoadRequestId = 0;
const pageSize = 12;
let unsubscribeCatalogMutated: (() => void) | null = null;
const contestListStore = useContestListStore();

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

    const summary = coverageSummaryMap.value.get(contest.id);
    const hasSnapshot = !!summary && summary.problemCount > 0;
    const hasTouchedProblems =
      hasSnapshot &&
      ((summary.solvedProblemCount ?? 0) > 0 || (summary.attemptedProblemCount ?? 0) > 0);
    const hasUntouchedProblems = hasSnapshot && !hasTouchedProblems;

    if (contestListStore.mode === "fresh-only") {
      return hasUntouchedProblems;
    }
    if (contestListStore.mode === "non-fresh-only") {
      return hasTouchedProblems;
    }
    return true;
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
    const [localContests, deletedContestIds, coverageSummaries, dbStatus] = await Promise.all([
      listCatalogContestsFromDb(),
      listDeletedCatalogContestIdsFromDb(),
      listContestCoverageSummariesFromDb({ memberIds: contestListStore.selectedMemberIds }),
      getCatalogDbStatus(),
    ]);
    if (requestId !== latestLoadRequestId) {
      return;
    }
    const localContestById = new Map(localContests.map((contest) => [contest.contestId, contest]));
    const localItems: CatalogContestIndexItem[] = localContests
      .filter((contest) => !deletedContestIds.has(contest.contestId))
      .map((contest) => ({
        id: contest.contestId,
        title: contest.title,
        aliases: contest.aliases,
        tags: contest.tags,
        curation_status: contest.curationStatus,
        problem_count:
          coverageSummaries.find((summary) => summary.contestId === contest.contestId)?.problemCount ??
          contest.problemIds.length,
      }));
    contests.value = localItems.sort(compareContestsByTime);
    localContestMap.value = localContestById;
    coverageSummaryMap.value = new Map(
      coverageSummaries.map((summary) => [summary.contestId, summary]),
    );
    generatedAt.value = dbStatus.lastCatalogImportAt ?? "";
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

async function handleImportDefaultData() {
  importingDefaultData.value = true;
  error.value = "";
  try {
    await importBundledCatalogSnapshot({
      mode: "replace",
      includeProblems: true,
    });
    await loadContests();
    window.dispatchEvent(new CustomEvent("xvg:catalog-mutated"));
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to import default catalog";
  } finally {
    importingDefaultData.value = false;
  }
}

function problemStateClass(status: "solved" | "attempted" | "unseen") {
  return `contest-problem-state--${status}`;
}

function contestCodeforcesLabel(contestId: string) {
  const contest = localContestMap.value.get(contestId);
  const source = contest?.sources.find(
    (item) => item.provider === "codeforces" && item.provider_contest_id,
  );
  if (source?.provider_contest_id) {
    return `CODEFORCES / ${source.provider_contest_id}`;
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
watch(() => contestListStore.mode, () => {
  if (contestListStore.page !== 1) {
    contestListStore.page = 1;
  }
});
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
                <span class="mode-switch__label">List Mode</span>
                <div class="mode-switch__rail">
                  <button
                    type="button"
                    class="mode-switch__option"
                    :class="{ 'mode-switch__option--active': contestListStore.mode === 'all' }"
                    @click="contestListStore.mode = 'all'"
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    class="mode-switch__option"
                    :class="{ 'mode-switch__option--active': contestListStore.mode === 'fresh-only' }"
                    @click="contestListStore.mode = 'fresh-only'"
                  >
                    只看未做
                  </button>
                  <button
                    type="button"
                    class="mode-switch__option"
                    :class="{ 'mode-switch__option--active': contestListStore.mode === 'non-fresh-only' }"
                    @click="contestListStore.mode = 'non-fresh-only'"
                  >
                    只看做过
                  </button>
                </div>
              </div>
              <button
                v-if="contestListStore.query.trim()"
                class="button button--ghost"
                type="button"
                @click="clearQuery()"
              >
                Clear Filters
              </button>
            </div>

            <div class="field">
              <label for="contest-query">Search</label>
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

          <div class="contest-toolbar__actions">
            <RouterLink to="/manage" class="button contest-toolbar__primary-action">
              <span class="button__eyebrow">Tools</span>
              <span>Manage Data</span>
            </RouterLink>
            <RouterLink to="/contests/new" class="button button--ghost contest-toolbar__secondary-action">
              <span class="button__eyebrow">Catalog</span>
              <span>Add Contest</span>
            </RouterLink>
            <button class="button button--ghost contest-toolbar__secondary-action" :disabled="loading" @click="loadContests">
              <span class="button__eyebrow">Catalog</span>
              <span>{{ loading ? "Refreshing..." : "Reload Catalog" }}</span>
            </button>
            <p class="muted tiny contest-toolbar__meta">
              <span>上次更新：{{ latestSyncLabel }}</span>
              <span>{{ pageLabel }}</span>
            </p>
          </div>
        </div>

        <p v-if="error" class="error-box" style="margin-bottom: 16px">{{ error }}</p>

        <div v-if="loading" class="notice">loading curated contests...</div>
        <div v-else-if="!contests.length" class="notice">
          <div>当前还没有本地比赛数据。</div>
          <div class="actions" style="margin-top: 12px; margin-bottom: 0">
            <button class="button" :disabled="importingDefaultData" @click="handleImportDefaultData">
              {{ importingDefaultData ? "Importing..." : "导入默认数据" }}
            </button>
          </div>
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
                <p class="eyebrow">{{ contestCodeforcesLabel(contest.id) }}</p>
                <h3>{{ contest.title }}</h3>
              </div>
            </div>

            <div class="contest-card__meta-row">
              <div class="contest-card__meta-main">
                <div class="inline-tags">
                  <span class="tag tag--neutral">
                    {{ coverageSummaryMap.get(contest.id)?.problemCount ?? contest.problem_count }} problems
                  </span>
                  <span class="tag tag--neutral">
                    solved {{ coverageSummaryMap.get(contest.id)?.solvedProblemCount ?? 0 }}
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
                <span v-else class="contest-card__empty-source">数据未同步，请在 Manage 里全量同步</span>
              </div>
              <span class="contest-card__link-mark" aria-hidden="true">open ↗</span>
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
            Previous
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
            Next
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
