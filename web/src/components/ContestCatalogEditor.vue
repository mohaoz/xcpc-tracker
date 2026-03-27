<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { CatalogSource } from "../lib/catalog";
import { aggregateAliasesFromSources } from "../lib/catalog-sources";

type ContestEditorProblem = {
  ordinal: string;
  title: string;
  aliases: string[];
  sources: CatalogSource[];
};

type ContestEditorValue = {
  contestId?: string;
  title: string;
  aliases: string[];
  tags: string[];
  sources: CatalogSource[];
  notes: string | null;
  problems?: ContestEditorProblem[];
};

const props = withDefaults(defineProps<{
  initialValue?: ContestEditorValue;
  existingTags?: string[];
  submitLabel?: string;
  busy?: boolean;
}>(), {
  initialValue: undefined,
  existingTags: () => [],
  submitLabel: "Save Contest",
  busy: false,
});

const emit = defineEmits<{
  submit: [value: ContestEditorValue];
}>();

const title = ref("");
const notes = ref("");
const tags = ref<string[]>([]);
const aliases = ref<string[]>([]);
const sources = ref<CatalogSource[]>([]);
const problems = ref<ContestEditorProblem[]>([]);
const manualProblemsJson = ref("");
const tagDraft = ref("");
const aliasDraft = ref("");
const validationErrors = ref<string[]>([]);
const showManualProblemsEditor = computed(() =>
  sources.value.some((source) => source.provider.trim() === "manual"),
);

function dedupe(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim();
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

function normalizeSource(source: CatalogSource): CatalogSource {
  return {
    provider: source.provider ?? "",
    kind: source.kind ?? "contest",
    url: source.url ?? "",
    provider_contest_id: source.provider_contest_id ?? "",
    provider_problem_id: source.provider_problem_id ?? "",
    source_title: source.source_title ?? "",
    label: source.label ?? "",
  };
}

function normalizeSources(value: CatalogSource[]) {
  return value.map(normalizeSource);
}

function normalizeProblem(problem: ContestEditorProblem): ContestEditorProblem {
  return {
    ordinal: problem.ordinal ?? "",
    title: problem.title ?? "",
    aliases: dedupe(problem.aliases ?? []),
    sources: normalizeSources(problem.sources ?? []),
  };
}

function normalizeProblems(value: ContestEditorProblem[]) {
  return value.map(normalizeProblem);
}

function serializeProblemsForEditor(value: ContestEditorProblem[]) {
  return JSON.stringify(
    value.map((problem) => ({
      ordinal: problem.ordinal,
      title: problem.title,
      aliases: dedupe(problem.aliases ?? []),
    })),
    null,
    2,
  );
}

function resetDraft() {
  title.value = props.initialValue?.title ?? "";
  notes.value = props.initialValue?.notes ?? "";
  tags.value = dedupe(props.initialValue?.tags ?? []);
  aliases.value = dedupe(props.initialValue?.aliases ?? []);
  sources.value = normalizeSources(props.initialValue?.sources ?? []);
  problems.value = normalizeProblems(props.initialValue?.problems ?? []);
  manualProblemsJson.value = serializeProblemsForEditor(problems.value);
  tagDraft.value = "";
  aliasDraft.value = "";
  validationErrors.value = [];
}

watch(
  () => props.initialValue,
  () => {
    resetDraft();
  },
  { immediate: true },
);

function addTag(raw: string) {
  const normalized = raw.trim().replace(/,+$/g, "").trim();
  if (!normalized) {
    return;
  }
  tags.value = dedupe([...tags.value, normalized]);
  tagDraft.value = "";
}

function removeTag(tag: string) {
  tags.value = tags.value.filter((item) => item.toLocaleLowerCase() !== tag.toLocaleLowerCase());
}

function addAlias(raw: string) {
  const normalized = raw.trim().replace(/,+$/g, "").trim();
  if (!normalized) {
    return;
  }
  aliases.value = dedupe([...aliases.value, normalized]);
  aliasDraft.value = "";
}

function removeAlias(alias: string) {
  aliases.value = aliases.value.filter((item) => item.toLocaleLowerCase() !== alias.toLocaleLowerCase());
}

function addSource() {
  sources.value.push({
    provider: "codeforces",
    kind: "contest",
    url: "",
    provider_contest_id: "",
    source_title: "",
    label: "",
  });
}

function removeSource(index: number) {
  sources.value.splice(index, 1);
}

function buildSourceProviderOptions(currentProvider: string) {
  const options = ["manual", "codeforces", "qoj", "board_xcpcio", "other"];
  if (currentProvider && !options.includes(currentProvider)) {
    return [currentProvider, ...options];
  }
  return options;
}

function buildSourceKindOptions(provider: string) {
  if (provider === "manual") {
    return ["contest"];
  }
  if (provider === "codeforces" || provider === "qoj") {
    return ["contest"];
  }
  if (provider === "board_xcpcio") {
    return ["ranking"];
  }
  if (provider === "other") {
    return ["contest", "ranking", "writeup", "other"];
  }
  return ["contest"];
}

function handleProviderChange(index: number) {
  const source = sources.value[index];
  const allowedKinds = buildSourceKindOptions(source.provider);
  if (!allowedKinds.includes(source.kind)) {
    source.kind = allowedKinds[0] ?? "contest";
  }
  if (showManualProblemsEditor.value) {
    manualProblemsJson.value = serializeProblemsForEditor(problems.value);
  }
}

function isPrimaryManualSource(index: number) {
  return sources.value.findIndex((source) => source.provider.trim() === "manual") === index;
}

function normalizeUrl(value: string) {
  return value.trim();
}

function normalizeProblemSources(problem: ContestEditorProblem): CatalogSource[] {
  const normalizedSources = (problem.sources ?? [])
    .map((source) => ({
      provider: source.provider.trim(),
      kind: source.kind.trim() || "problem",
      url: (source.url ?? "").trim() || undefined,
      provider_contest_id: source.provider_contest_id?.trim() || undefined,
      provider_problem_id: source.provider_problem_id?.trim() || undefined,
      source_title: source.source_title?.trim() || undefined,
      label: source.label?.trim() || undefined,
    }))
    .filter((source) => source.provider && source.kind && (source.url || source.provider === "manual"));

  if (normalizedSources.length === 0) {
    return [{
      provider: "manual",
      kind: "problem",
      source_title: problem.title.trim(),
      label: "Manual Entry",
    }];
  }

  return normalizedSources.map((source) => {
    if (source.provider !== "manual") {
      return source;
    }
    return {
      ...source,
      kind: "problem",
      url: undefined,
      source_title: source.source_title || problem.title.trim(),
      label: source.label || "Manual Entry",
    };
  });
}

function parseManualProblemsJson() {
  const trimmed = manualProblemsJson.value.trim();
  if (!trimmed) {
    return {
      problems: [] as ContestEditorProblem[],
      errors: [] as string[],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      problems: [] as ContestEditorProblem[],
      errors: ["manual problems JSON is invalid"],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      problems: [] as ContestEditorProblem[],
      errors: ["manual problems JSON must be an array"],
    };
  }

  const errors: string[] = [];
  const problemOrdinals = new Set<string>();
  const existingProblemByOrdinal = new Map(
    problems.value.map((problem) => [problem.ordinal.trim().toLocaleLowerCase(), problem] as const),
  );

  const nextProblems = parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      errors.push(`problem ${index + 1}: must be an object`);
      return {
        ordinal: "",
        title: "",
        aliases: [],
        sources: [],
      } satisfies ContestEditorProblem;
    }

    const rawOrdinal = "ordinal" in entry && typeof entry.ordinal === "string" ? entry.ordinal.trim() : "";
    const rawTitle = "title" in entry && typeof entry.title === "string" ? entry.title.trim() : "";
    const rawAliases =
      "aliases" in entry && Array.isArray(entry.aliases)
        ? entry.aliases.filter((alias: unknown): alias is string => typeof alias === "string")
        : [];

    if (!rawOrdinal) {
      errors.push(`problem ${index + 1}: ordinal is required`);
    }
    if (!rawTitle) {
      errors.push(`problem ${index + 1}: title is required`);
    }
    if (rawOrdinal) {
      const key = rawOrdinal.toLocaleLowerCase();
      if (problemOrdinals.has(key)) {
        errors.push(`problem ${index + 1}: duplicate ordinal ${rawOrdinal}`);
      }
      problemOrdinals.add(key);
    }

    const existingProblem = existingProblemByOrdinal.get(rawOrdinal.toLocaleLowerCase());
    return {
      ordinal: rawOrdinal,
      title: rawTitle,
      aliases: dedupe(rawAliases),
      sources: normalizeSources(existingProblem?.sources ?? []),
    } satisfies ContestEditorProblem;
  });

  return {
    problems: nextProblems.filter((problem) => problem.ordinal || problem.title || problem.aliases.length > 0),
    errors,
  };
}

function validate() {
  const errors: string[] = [];
  if (!title.value.trim()) {
    errors.push("contest title is required");
  }

  const normalizedSources = sources.value
    .map((source) => ({
      provider: source.provider.trim(),
      kind: source.kind.trim(),
      url: normalizeUrl(source.url ?? ""),
      provider_contest_id: source.provider_contest_id?.trim() || "",
      source_title: source.source_title?.trim() || "",
      label: source.label?.trim() || "",
    }))
    .filter((source) => source.provider || source.kind || source.url || source.provider_contest_id || source.source_title || source.label);

  normalizedSources.forEach((source, index) => {
    const allowedKinds = buildSourceKindOptions(source.provider);
    if (!allowedKinds.includes(source.kind)) {
      errors.push(`source ${index + 1}: ${source.provider} does not support kind ${source.kind}`);
    }
    if (source.provider !== "manual" && !source.url) {
      errors.push(`source ${index + 1}: url is required`);
    }
  });

  if (showManualProblemsEditor.value) {
    const parsed = parseManualProblemsJson();
    errors.push(...parsed.errors);
  }

  validationErrors.value = errors;
  return errors.length === 0;
}

function submit() {
  if (!validate()) {
    return;
  }

  const parsedManualProblems = showManualProblemsEditor.value ? parseManualProblemsJson().problems : problems.value;

  emit("submit", {
    contestId: props.initialValue?.contestId,
    title: title.value.trim(),
    aliases: dedupe(aliases.value),
    tags: dedupe(tags.value),
    sources: sources.value
      .map((source) => ({
        provider: source.provider.trim(),
        kind: source.kind.trim(),
        url: (source.url ?? "").trim() || undefined,
        provider_contest_id: source.provider_contest_id?.trim() || undefined,
        provider_problem_id: source.provider_problem_id?.trim() || undefined,
        source_title: source.source_title?.trim() || undefined,
        label: source.label?.trim() || undefined,
      }))
      .filter((source) => source.provider && source.kind && (source.url || source.provider === "manual")),
    notes: notes.value.trim() || null,
    problems: parsedManualProblems
      .map((problem) => {
        const problemTitle = problem.title.trim();
        const nextSources = normalizeProblemSources(problem);
        return {
          ordinal: problem.ordinal.trim(),
          title: problemTitle,
          aliases: aggregateAliasesFromSources(
            problemTitle,
            dedupe(problem.aliases),
            nextSources,
          ),
          sources: nextSources,
        };
      })
      .filter((problem) => problem.ordinal && problem.title),
  });
}
</script>

<template>
  <div class="contest-editor">
    <div class="form-grid">
      <div class="field" style="grid-column: 1 / -1">
        <label>Title</label>
        <input v-model="title" type="text" placeholder="Contest title" />
      </div>

      <div class="field" style="grid-column: 1 / -1">
        <label>Tags</label>
        <div class="tag-editor">
          <button
            v-for="tag in tags"
            :key="tag"
            type="button"
            class="tag-chip tag-chip--card"
            @click="removeTag(tag)"
          >
            {{ tag }} ×
          </button>
          <input
            v-model="tagDraft"
            class="tag-editor__input"
            type="text"
            placeholder="Type a tag and press Enter"
            @keydown.enter.prevent="addTag(tagDraft)"
          />
        </div>
      </div>

      <div class="field" style="grid-column: 1 / -1">
        <label>Aliases</label>
        <div class="tag-editor">
          <button
            v-for="alias in aliases"
            :key="alias"
            type="button"
            class="tag-chip tag-chip--card"
            @click="removeAlias(alias)"
          >
            {{ alias }} ×
          </button>
          <input
            v-model="aliasDraft"
            class="tag-editor__input"
            type="text"
            placeholder="Add alias and press Enter"
            @keydown.enter.prevent="addAlias(aliasDraft)"
          />
        </div>
      </div>
    </div>

    <div class="field" style="margin-top: 16px">
      <label>Contest Sources</label>
      <div class="contest-source-list">
        <div v-for="(source, index) in sources" :key="index" class="contest-source-card">
          <div class="form-grid">
            <div class="field">
              <label>Provider</label>
              <select v-model="source.provider" class="input-select" @change="handleProviderChange(index)">
                <option
                  v-for="provider in buildSourceProviderOptions(source.provider)"
                  :key="provider"
                  :value="provider"
                >
                  {{ provider }}
                </option>
              </select>
            </div>
            <div class="field">
              <label>Kind</label>
              <select v-model="source.kind" class="input-select">
                <option
                  v-for="kind in buildSourceKindOptions(source.provider)"
                  :key="kind"
                  :value="kind"
                >
                  {{ kind }}
                </option>
              </select>
            </div>
            <div class="field">
              <label>Provider Contest Id</label>
              <input v-model="source.provider_contest_id" type="text" placeholder="105922" />
            </div>
            <div class="field">
              <label>Label</label>
              <input v-model="source.label" type="text" placeholder="Codeforces Gym" />
            </div>
            <div class="field">
              <label>Source Title</label>
              <input v-model="source.source_title" type="text" placeholder="Contest title on this source" />
            </div>
            <div v-if="source.provider !== 'manual'" class="field" style="grid-column: 1 / -1">
              <label>URL</label>
              <input v-model="source.url" type="text" placeholder="https://codeforces.com/gym/105922" />
            </div>
            <div
              v-if="source.provider === 'manual' && isPrimaryManualSource(index)"
              class="field"
              style="grid-column: 1 / -1"
            >
              <label>Manual Problems JSON</label>
              <textarea
                v-model="manualProblemsJson"
                class="input-textarea"
                rows="14"
                placeholder='[{"ordinal":"A","title":"Problem A","aliases":["Alias A"]}]'
              />
              <p class="muted tiny" style="margin-top: 10px">
                填 JSON 数组。字段支持 `ordinal`、`title`、可选 `aliases`。保存后没有外部 source 的题目会自动补 `manual / problem` source。
              </p>
            </div>
          </div>
          <div class="actions" style="margin-top: 12px">
            <button
              type="button"
              class="button button--ghost"
              @click="removeSource(index)"
            >
              Remove Source
            </button>
          </div>
        </div>
      </div>
      <div class="actions" style="margin-top: 12px">
        <button type="button" class="button button--ghost" @click="addSource">
          Add Contest Source
        </button>
      </div>
    </div>

    <div class="field" style="margin-top: 16px">
      <label>Notes</label>
      <textarea
        v-model="notes"
        class="input-textarea"
        rows="4"
        placeholder="Optional notes"
      />
    </div>

    <div class="actions">
      <span v-if="validationErrors.length" class="editor-validation">
        {{ validationErrors[0] }}
      </span>
      <button type="button" class="button button--ghost" :disabled="busy" @click="submit">
        {{ submitLabel }}
      </button>
    </div>
  </div>
</template>
