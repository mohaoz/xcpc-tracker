<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import {
  fetchContests,
  type ContestListItem,
} from "../lib/api";

type PoolScope = "all" | "whole-contest-fresh" | "no-fresh-only";

const contests = ref<ContestListItem[]>([]);
const loading = ref(false);
const error = ref("");
const poolScope = ref<PoolScope>("all");
let latestLoadRequestId = 0;
const page = ref(1);
const pageSize = 12;
const totalCount = ref(0);
const totalPages = ref(1);
const route = useRoute();
const router = useRouter();
let syncingFromRoute = false;
const tagDraft = ref("");

const filterForm = ref({
  tags: "",
});

function dedupeTags(tags: string[]) {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const normalized = tag.trim();
    if (!normalized) {
      return false;
    }
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function serializeTags(tags: string[]) {
  return dedupeTags(tags).join(", ");
}

function parseTags(value: string) {
  return dedupeTags(
    value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  );
}

const activeTags = computed(() => parseTags(filterForm.value.tags));
const pageButtons = computed<(number | string)[]>(() => {
  const total = totalPages.value;
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const current = page.value;
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
  return contests.value;
});

const pageLabel = computed(() => {
  if (!totalCount.value) {
    return "0 of 0";
  }
  const start = (page.value - 1) * pageSize + 1;
  const end = Math.min(page.value * pageSize, totalCount.value);
  return `${start}-${end} of ${totalCount.value}`;
});

const latestSyncLabel = computed(() => {
  const latest = contests.value[0]?.updated_at;
  if (!latest) {
    return "还没有同步记录";
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

function parsePositiveInt(value: unknown, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function applyRouteQuery() {
  syncingFromRoute = true;
  const tags = route.query.tags;
  filterForm.value.tags = Array.isArray(tags) ? tags[0] ?? "" : String(tags ?? "");
  tagDraft.value = "";
  const scope = Array.isArray(route.query.scope) ? route.query.scope[0] ?? "" : String(route.query.scope ?? "");
  poolScope.value =
    scope === "whole-contest-fresh" || scope === "no-fresh-only" ? scope : "all";
  page.value = parsePositiveInt(route.query.page, 1);
  syncingFromRoute = false;
}

function syncRouteQuery() {
  if (syncingFromRoute) {
    return;
  }

  const nextQuery: Record<string, string> = {};
  const normalizedTags = filterForm.value.tags.trim();
  if (normalizedTags) {
    nextQuery.tags = normalizedTags;
  }
  if (poolScope.value !== "all") {
    nextQuery.scope = poolScope.value;
  }
  if (page.value > 1) {
    nextQuery.page = String(page.value);
  }

  const currentQuery = route.query;
  const currentTags = Array.isArray(currentQuery.tags) ? currentQuery.tags[0] ?? "" : String(currentQuery.tags ?? "");
  const currentScope = Array.isArray(currentQuery.scope) ? currentQuery.scope[0] ?? "" : String(currentQuery.scope ?? "");
  const currentPage = Array.isArray(currentQuery.page) ? currentQuery.page[0] ?? "" : String(currentQuery.page ?? "");

  if (
    currentTags === (nextQuery.tags ?? "") &&
    currentScope === (nextQuery.scope ?? "") &&
    currentPage === (nextQuery.page ?? "")
  ) {
    return;
  }

  router.replace({
    query: nextQuery,
  });
}

async function loadContests() {
  const requestId = ++latestLoadRequestId;
  loading.value = true;
  error.value = "";
  try {
    const payload = await fetchContests({
      tags: activeTags.value,
      withCoverage: true,
      wholeContestFreshOnly: poolScope.value === "whole-contest-fresh",
      noFreshOnly: poolScope.value === "no-fresh-only",
      page: page.value,
      pageSize,
    });
    if (requestId !== latestLoadRequestId) {
      return;
    }
    contests.value = payload.contests;
    page.value = payload.page;
    totalCount.value = payload.total_count;
    totalPages.value = payload.total_pages;
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

function goToPage(nextPage: number) {
  if (nextPage < 1 || nextPage > totalPages.value || nextPage === page.value) {
    return;
  }
  page.value = nextPage;
}

function setPoolScope(nextScope: PoolScope) {
  if (poolScope.value === nextScope) {
    return;
  }
  poolScope.value = nextScope;
}

function problemStateClass(status: string) {
  return `contest-problem-state--${status}`;
}

function addTag(rawTag: string) {
  const normalized = rawTag.trim().replace(/,+$/g, "").trim();
  if (!normalized) {
    return;
  }
  filterForm.value.tags = serializeTags([...activeTags.value, normalized]);
  tagDraft.value = "";
}

function removeTag(tagToRemove: string) {
  filterForm.value.tags = serializeTags(
    activeTags.value.filter((tag) => tag.toLocaleLowerCase() !== tagToRemove.toLocaleLowerCase()),
  );
}

function clearTags() {
  filterForm.value.tags = "";
  tagDraft.value = "";
}

function commitTagDraft() {
  addTag(tagDraft.value);
}

function handleTagKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    commitTagDraft();
    return;
  }
  if (event.key === "Backspace" && !tagDraft.value && activeTags.value.length > 0) {
    removeTag(activeTags.value[activeTags.value.length - 1]);
  }
}

applyRouteQuery();
onMounted(loadContests);
watch(activeTags, () => {
  if (page.value !== 1) {
    page.value = 1;
    return;
  }
  loadContests();
});
watch(poolScope, () => {
  if (page.value !== 1) {
    page.value = 1;
    return;
  }
  loadContests();
});
watch(page, loadContests);
watch(
  () => route.query,
  () => {
    applyRouteQuery();
    loadContests();
  },
);
watch(
  [() => filterForm.value.tags, poolScope, page],
  () => {
    syncRouteQuery();
  },
);
</script>

<template>
  <div class="view-stack">
    <section class="panel">
      <div class="panel__body">
        <div class="panel__header">
          <div class="panel__title">
            <p class="eyebrow">Contest Pool</p>
            <h2>按整场看 VP 价值</h2>
            <p class="muted">
              最近同步：{{ latestSyncLabel }}。当前池子共 {{ totalCount }} 场，先按整场 freshness 快速筛一遍。
            </p>
          </div>
          <div class="inline-tags">
            <span class="tag tag--neutral">{{ visibleContests.length }} shown</span>
            <span class="tag tag--neutral">{{ pageLabel }}</span>
            <span v-for="tag in activeTags" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </div>

        <div class="contest-toolbar">
          <div class="contest-toolbar__filters">
            <div class="filter-toggle-row">
              <div class="mode-switch">
                <span class="mode-switch__label">Pool Scope</span>
                <div class="mode-switch__rail">
                  <button
                    type="button"
                    class="mode-switch__option"
                    :class="{ 'mode-switch__option--active': poolScope === 'all' }"
                    @click="setPoolScope('all')"
                  >
                    All Contests
                  </button>
                  <button
                    type="button"
                    class="mode-switch__option"
                    :class="{ 'mode-switch__option--active': poolScope === 'whole-contest-fresh' }"
                    @click="setPoolScope('whole-contest-fresh')"
                  >
                    Whole-Contest Fresh
                  </button>
                  <button
                    type="button"
                    class="mode-switch__option"
                    :class="{ 'mode-switch__option--active': poolScope === 'no-fresh-only' }"
                    @click="setPoolScope('no-fresh-only')"
                  >
                    No-Fresh-Only
                  </button>
                </div>
              </div>
              <button
                v-if="activeTags.length"
                class="button button--ghost"
                type="button"
                @click="clearTags"
              >
                Clear Tags
              </button>
            </div>

            <div class="field">
              <label for="contest-tags">Filter Tags</label>
              <div class="tag-editor">
                <button
                  v-for="tag in activeTags"
                  :key="tag"
                  type="button"
                  class="tag-chip tag-chip--active"
                  @click="removeTag(tag)"
                >
                  <span>{{ tag }}</span>
                  <span aria-hidden="true">×</span>
                </button>
                <input
                  id="contest-tags"
                  v-model="tagDraft"
                  class="tag-editor__input"
                  placeholder="输入 tag 后按回车，或直接点比赛上的标签"
                  @keydown="handleTagKeydown"
                  @blur="commitTagDraft"
                />
              </div>
            </div>
          </div>

          <div class="contest-toolbar__actions">
            <RouterLink to="/contests/intake" class="button contest-toolbar__primary-action">
              <span class="button__eyebrow">Manage</span>
              <span>Add Contest</span>
            </RouterLink>
            <button class="button button--ghost contest-toolbar__secondary-action" :disabled="loading" @click="loadContests">
              <span class="button__eyebrow">Sync</span>
              <span>{{ loading ? "Refreshing..." : "Refresh List" }}</span>
            </button>
          </div>
        </div>

        <div v-if="loading" class="notice">loading contests...</div>
        <div v-else-if="!visibleContests.length && poolScope === 'whole-contest-fresh'" class="notice">
          当前筛选下没有“整场 fresh”的比赛。
        </div>
        <div v-else-if="!visibleContests.length && poolScope === 'no-fresh-only'" class="notice">
          当前筛选下没有“队内做过至少一题”的比赛。
        </div>
        <div v-else-if="!contests.length" class="notice">
          还没有比赛，先从 Add Contest 把一场 Gym 拉进来。
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
              </div>
            </div>

            <div class="contest-card__meta-row">
              <div class="contest-card__meta-main">
                <div class="inline-tags">
                  <span class="tag tag--neutral">{{ contest.problem_count ?? 0 }} problems</span>
                  <span class="tag tag--neutral">solved {{ contest.solved_problem_count ?? 0 }}</span>
                </div>
                <div v-if="contest.problem_states?.length" class="contest-problem-strip">
                  <span
                    v-for="problem in contest.problem_states"
                    :key="`${contest.contest_id}-${problem.ordinal}`"
                    class="contest-problem-state"
                    :class="problemStateClass(problem.status)"
                    :title="`${problem.ordinal}: ${problem.status}`"
                  >
                    {{ problem.ordinal }}
                  </span>
                </div>
              </div>
              <span class="contest-card__link-mark" aria-hidden="true">open ↗</span>
            </div>

            <div v-if="contest.tags.length" class="inline-tags" style="margin-top: 16px">
              <button
                v-for="tag in contest.tags"
                :key="tag"
                type="button"
                class="tag-chip tag-chip--card"
                @click.prevent.stop="addTag(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </RouterLink>
        </div>

        <div v-if="totalPages > 1" class="pagination-bar">
          <button class="button button--ghost" :disabled="loading || page <= 1" @click="goToPage(page - 1)">
            Previous
          </button>
          <div class="pagination-pages">
            <button
              v-for="(item, index) in pageButtons"
              :key="`${item}-${index}`"
              class="pagination-page"
              :class="{ 'pagination-page--active': item === page, 'pagination-page--ellipsis': item === '...' }"
              :disabled="loading || item === '...'"
              @click="typeof item === 'number' && goToPage(item)"
            >
              {{ item }}
            </button>
          </div>
          <button class="button button--ghost" :disabled="loading || page >= totalPages" @click="goToPage(page + 1)">
            Next
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
