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
import { emitMemberMutated } from "../lib/member-events";
import {
  deleteCatalogContestRecord,
  getCatalogContestDetailFromDb,
  getContestCoverageFromDb,
  getManualMemberProblemStatusFromDb,
  hasDeletedCatalogContestId,
  listCatalogContestsFromDb,
  replaceManualCatalogContest,
  upsertManualMemberProblemStatus,
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
const qojScriptFeedback = ref("");
const editing = ref(false);
const saving = ref(false);
const deleting = ref(false);
const existingTags = ref<string[]>([]);
const markMode = ref(false);
const markSavingCellKey = ref("");

const contestId = computed(() => String(route.params.contestId ?? ""));
const hasCodeforcesContestSource = computed(() =>
  contest.value?.sources.some((source) => source.provider === "codeforces" && source.kind === "contest") ?? false,
);
const qojContestSource = computed(() =>
  contest.value?.sources.find((source) => source.provider === "qoj" && source.kind === "contest") ?? null,
);
const trackedMembers = computed(() => coverage.value?.trackedMembers ?? []);
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

async function refreshCoverageOnly() {
  if (!contestId.value) {
    return;
  }
  coverage.value = await getContestCoverageFromDb(contestId.value);
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

function buildQojManualSyncScript() {
  if (!contest.value || !qojContestSource.value) {
    return "";
  }

  const serializedContest = JSON.stringify({
    contestId: contest.value.id,
    title: contest.value.title,
    aliases: contest.value.aliases,
    tags: contest.value.tags,
    startAt: contest.value.start_at ?? null,
    curationStatus: contest.value.curation_status,
    sources: contest.value.sources,
    notes: contest.value.notes ?? null,
    generatedFrom: contest.value.generated_from ?? "catalog",
  });
  const serializedProblems = JSON.stringify(
    contest.value.problems.map((problem) => ({
      problemId: problem.id,
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: problem.aliases,
      sources: problem.sources,
    })),
  );
  const expectedContestId = qojContestSource.value.provider_contest_id ?? "";

  return `(() => {
  const embeddedContest = ${serializedContest};
  const embeddedProblems = ${serializedProblems};
  const expectedContestId = ${JSON.stringify(expectedContestId)};

  function cleanText(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function normalizeTitle(value) {
    return cleanText(value).toLowerCase();
  }

  function dedupeStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const normalized = cleanText(value);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
    }
    return result;
  }

  function sourceIdentity(source) {
    return [
      cleanText(source.provider).toLowerCase(),
      cleanText(source.kind).toLowerCase(),
      cleanText(source.provider_problem_id || source.provider_contest_id || source.url).toLowerCase(),
    ].join("::");
  }

  function mergeSourceList(existingSources, nextSource) {
    const items = [...(existingSources || [])];
    const nextKey = sourceIdentity(nextSource);
    const index = items.findIndex((source) => sourceIdentity(source) === nextKey);
    if (index < 0) {
      items.push(nextSource);
      return items;
    }
    items[index] = {
      ...items[index],
      ...nextSource,
      source_title: nextSource.source_title || items[index].source_title,
      label: nextSource.label || items[index].label,
    };
    return items;
  }

  function looksLikeOrdinal(value) {
    const text = cleanText(value);
    return /^([A-Z]|[A-Z][0-9]|[0-9]+|[A-Z]{2,3})$/u.test(text);
  }

  function extractOrdinalFromRow(row, anchor) {
    const cells = Array.from(row.querySelectorAll("td"));
    for (const cell of cells) {
      const text = cleanText(cell.textContent);
      if (looksLikeOrdinal(text)) {
        return text;
      }
    }
    const previousCell = anchor.closest("td")?.previousElementSibling;
    if (previousCell) {
      const text = cleanText(previousCell.textContent);
      if (looksLikeOrdinal(text)) {
        return text;
      }
    }
    return null;
  }

  function extractProblems() {
    const rows = Array.from(document.querySelectorAll("tr"));
    const problems = [];
    const seen = new Set();
    let fallbackIndex = 1;

    for (const row of rows) {
      const anchors = Array.from(row.querySelectorAll('a[href]'));
      const anchor = anchors.find((item) => /\\/contest\\/\\d+\\/problem\\/\\d+$/i.test(item.href));
      if (!anchor) continue;

      const title = cleanText(anchor.textContent);
      const url = anchor.href;
      const providerProblemIdMatch = url.match(/\\/problem\\/(\\d+)$/i);
      const providerProblemId = providerProblemIdMatch ? providerProblemIdMatch[1] : "";
      if (!title || !providerProblemId) continue;

      let ordinal = extractOrdinalFromRow(row, anchor);
      if (!ordinal) {
        ordinal = String.fromCharCode(64 + fallbackIndex);
      }
      fallbackIndex += 1;

      const key = \`\${ordinal}@@\${providerProblemId}\`;
      if (seen.has(key)) continue;
      seen.add(key);

      problems.push({ ordinal, title, url, providerProblemId });
    }

    return problems;
  }

  const currentContestMatch = location.pathname.match(/\\/contest\\/(\\d+)/i);
  const currentContestId = currentContestMatch ? currentContestMatch[1] : "";
  if (!currentContestId) {
    throw new Error("当前页面不是 QOJ contest 页面");
  }
  if (expectedContestId && currentContestId !== expectedContestId) {
    throw new Error(\`这不是目标比赛页面。期望 contest/\${expectedContestId}，实际是 contest/\${currentContestId}\`);
  }

  const qojContestTitle = cleanText(document.querySelector("h1")?.textContent) || embeddedContest.title;
  const qojContestUrl = location.href.replace(/[#?].*$/u, "");
  const qojContestSource = {
    provider: "qoj",
    kind: "contest",
    url: qojContestUrl,
    provider_contest_id: currentContestId,
    source_title: qojContestTitle,
    label: "QOJ contest",
  };

  const qojProblems = extractProblems();
  const usedProblemIds = new Set();
  const existingById = new Map(embeddedProblems.map((problem) => [problem.problemId, problem]));
  const existingByOrdinal = new Map(embeddedProblems.map((problem) => [cleanText(problem.ordinal).toLowerCase(), problem]));
  const existingByTitle = new Map(embeddedProblems.map((problem) => [normalizeTitle(problem.title), problem]));
  const mergedProblems = [];

  for (const qojProblem of qojProblems) {
    const matched = existingByOrdinal.get(cleanText(qojProblem.ordinal).toLowerCase()) ||
      existingByTitle.get(normalizeTitle(qojProblem.title)) ||
      null;
    const nextSource = {
      provider: "qoj",
      kind: "problem",
      url: qojProblem.url,
      provider_problem_id: qojProblem.providerProblemId,
      source_title: qojProblem.title,
      label: \`QOJ \${qojProblem.ordinal}\`,
    };

    if (matched) {
      usedProblemIds.add(matched.problemId);
      mergedProblems.push({
        ...matched,
        ordinal: matched.ordinal || qojProblem.ordinal,
        title: matched.title || qojProblem.title,
        aliases: dedupeStrings([...(matched.aliases || []), qojProblem.title !== matched.title ? qojProblem.title : null]),
        sources: mergeSourceList(matched.sources || [], nextSource),
      });
      continue;
    }

    const problemId = \`\${embeddedContest.contestId}:\${qojProblem.ordinal}\`;
    usedProblemIds.add(problemId);
    mergedProblems.push({
      problemId,
      ordinal: qojProblem.ordinal,
      title: qojProblem.title,
      aliases: [],
      sources: [nextSource],
    });
  }

  for (const problem of embeddedProblems) {
    if (usedProblemIds.has(problem.problemId)) continue;
    mergedProblems.push(problem);
  }

  mergedProblems.sort((left, right) => left.ordinal.localeCompare(right.ordinal));

  const payload = {
    schemaVersion: 1,
    exportKind: "local_catalog_snapshot",
    exportedAt: new Date().toISOString(),
    contests: [
      {
        contestId: embeddedContest.contestId,
        title: embeddedContest.title,
        aliases: embeddedContest.aliases || [],
        tags: embeddedContest.tags || [],
        startAt: embeddedContest.startAt,
        curationStatus: mergedProblems.length ? "problem_listed" : embeddedContest.curationStatus,
        problemIds: mergedProblems.map((problem) => problem.problemId),
        sources: mergeSourceList(embeddedContest.sources || [], qojContestSource),
        notes: embeddedContest.notes,
        generatedFrom: embeddedContest.generatedFrom || "catalog",
        deletedAt: null,
      },
    ],
    problems: mergedProblems.map((problem) => ({
      problemId: problem.problemId,
      contestId: embeddedContest.contestId,
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: problem.aliases || [],
      sources: problem.sources || [],
    })),
  };

  const text = JSON.stringify(payload, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    alert("这场比赛的 QOJ 导入 JSON 已复制到剪贴板。回到 xcpc-tracker 的 Manage 页面直接粘贴导入。");
  }).catch(() => {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = \`qoj-contest-\${currentContestId}.json\`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    alert("剪贴板复制失败，已回退为下载 JSON 文件。");
  });

  console.log("QOJ contest export ready", {
    contestId: embeddedContest.contestId,
    qojContestId: currentContestId,
    problemCount: mergedProblems.length,
  });
})();`;
}

async function copyQojManualSyncScript() {
  if (!qojContestSource.value) {
    return;
  }
  qojScriptFeedback.value = "";
  error.value = "";
  feedback.value = "";
  try {
    await navigator.clipboard.writeText(buildQojManualSyncScript());
    qojScriptFeedback.value = "QOJ 同步脚本已复制。去对应的 QOJ contest 页面控制台执行，然后回 Manage 页面粘贴导入，并保持导入模式为 merge。";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "failed to copy QOJ sync script";
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
  memberId: string,
  currentStatus: "solved" | "attempted" | "unseen",
) {
  if (!markMode.value || !contest.value) {
    return;
  }
  if (!trackedMembers.value.length || !(coverage.value?.problems.length)) {
    error.value = "no members or problems available for marking";
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
                  <button v-if="hasCodeforcesContestSource" class="button" :disabled="syncing" @click="syncProblemsFromCodeforces">
                    {{ syncing ? "Syncing..." : "Sync" }}
                  </button>
                  <button v-if="qojContestSource" class="button button--ghost" type="button" @click="copyQojManualSyncScript">
                    Copy QOJ Sync Script
                  </button>
                  <button
                    :class="markMode ? 'button' : 'button button--ghost'"
                    :disabled="!coverage?.trackedMembers.length || !coverage?.problemCount"
                    @click="markMode = !markMode"
                  >
                    {{ markMode ? "Cancel Mark Mode" : "Enter Mark Mode" }}
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
                                  ? "saving..."
                                  : member.status
                              }}
                            </span>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p v-if="feedback" class="notice" style="margin-top: 16px">{{ feedback }}</p>
                <p v-if="qojScriptFeedback" class="notice" style="margin-top: 16px">{{ qojScriptFeedback }}</p>
                <p v-if="syncWarning" class="notice" style="margin-top: 16px">{{ syncWarning }}</p>
                <p v-if="qojContestSource" class="muted tiny" style="margin-top: 16px">
                  QOJ 手动同步脚本会为当前比赛生成一份单场 `local_catalog_snapshot`。回到 Manage 页面导入时保持 `merge`，这样只会把 QOJ source 和题目并进当前比赛，不会覆盖已有的 Codeforces 数据。
                </p>
                <p v-if="!(coverage?.problemCount)" class="notice" style="margin-top: 16px">
                  这场比赛还没有题目列表。可以在编辑器里手动补题，或者如果存在 Codeforces source 再同步。
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
                          <h3>{{ source.label || source.url || "Manual Source" }}</h3>
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
