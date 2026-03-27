<script setup lang="ts">
import { ref, watch } from "vue";

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
const tagDraft = ref("");
const aliasDraft = ref("");
const validationErrors = ref<string[]>([]);

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

function normalizeVariant(source: Pick<CatalogSource, "provider" | "variant">) {
  if (source.provider === "codeforces") {
    return source.variant === "gym_private" ? "gym_private" : "gym_public";
  }
  return source.variant ?? "";
}

function normalizeSources(value: CatalogSource[]) {
  return value.map((source) => ({
    provider: source.provider ?? "",
    kind: source.kind ?? "contest",
    variant: normalizeVariant(source),
    url: source.url ?? "",
    provider_contest_id: source.provider_contest_id ?? "",
    provider_problem_id: source.provider_problem_id ?? "",
    source_title: source.source_title ?? "",
    label: source.label ?? "",
  }));
}

function normalizeProblems(value: ContestEditorProblem[]) {
  return value.map((problem) => ({
    ordinal: problem.ordinal ?? "",
    title: problem.title ?? "",
    aliases: dedupe(problem.aliases ?? []),
    sources: normalizeSources(problem.sources ?? []),
  }));
}

function resetDraft() {
  title.value = props.initialValue?.title ?? "";
  notes.value = props.initialValue?.notes ?? "";
  tags.value = dedupe(props.initialValue?.tags ?? []);
  aliases.value = dedupe(props.initialValue?.aliases ?? []);
  problems.value = normalizeProblems(props.initialValue?.problems ?? []);
  sources.value = normalizeSources(
    props.initialValue?.sources?.length
      ? props.initialValue.sources
      : [{
          provider: "codeforces",
          kind: "contest",
          variant: "gym_public",
          url: "",
          provider_contest_id: "",
          source_title: "",
          label: "Codeforces Gym",
        }],
  );
  tagDraft.value = "";
  aliasDraft.value = "";
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
    variant: "gym_public",
    url: "",
    provider_contest_id: "",
    source_title: "",
    label: "",
  });
}

function removeSource(index: number) {
  sources.value.splice(index, 1);
}

function normalizeUrl(value: string) {
  return value.trim();
}

function buildSourceKindOptions(provider: string) {
  if (provider === "codeforces" || provider === "qoj") {
    return ["contest", "problem"];
  }
  if (provider === "board_xcpcio") {
    return ["ranking"];
  }
  if (provider === "other") {
    return ["contest", "ranking", "writeup", "problem", "other"];
  }
  return ["contest"];
}

function handleProviderChange(index: number) {
  const source = sources.value[index];
  const allowedKinds = buildSourceKindOptions(source.provider);
  if (!allowedKinds.includes(source.kind)) {
    source.kind = allowedKinds[0] ?? "contest";
  }
  source.variant = normalizeVariant(source);
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
      variant: normalizeVariant({
        provider: source.provider.trim(),
        variant: source.variant?.trim(),
      }),
      url: normalizeUrl(source.url),
      provider_contest_id: source.provider_contest_id?.trim() || "",
      source_title: source.source_title?.trim() || "",
    }))
    .filter((source) => source.provider || source.kind || source.url || source.provider_contest_id || source.source_title || source.variant);

  if (!normalizedSources.length) {
    errors.push("at least one source is required");
  }

  const hasContestSource = normalizedSources.some((source) => source.kind === "contest");
  if (!hasContestSource) {
    errors.push("at least one contest source is required");
  }

  normalizedSources.forEach((source, index) => {
    const allowedKinds = buildSourceKindOptions(source.provider);
    if (!allowedKinds.includes(source.kind)) {
      errors.push(`source ${index + 1}: ${source.provider} does not support kind ${source.kind}`);
    }
    if (!source.url) {
      errors.push(`source ${index + 1}: url is required`);
    }
  });

  const problemOrdinals = new Set<string>();
  problems.value.forEach((problem, index) => {
    const ordinal = problem.ordinal.trim();
    const titleValue = problem.title.trim();
    const hasContent = ordinal || titleValue || problem.sources.some((source) =>
      source.provider.trim() || source.kind.trim() || source.url.trim() || source.provider_problem_id?.trim(),
    );
    if (!hasContent) {
      return;
    }
    if (!ordinal) {
      errors.push(`problem ${index + 1}: ordinal is required`);
    }
    if (!titleValue) {
      errors.push(`problem ${index + 1}: title is required`);
    }
    if (ordinal) {
      if (problemOrdinals.has(ordinal.toLocaleLowerCase())) {
        errors.push(`problem ${index + 1}: duplicate ordinal ${ordinal}`);
      }
      problemOrdinals.add(ordinal.toLocaleLowerCase());
    }
    problem.sources.forEach((source, sourceIndex) => {
      const hasSourceContent = source.provider.trim() || source.kind.trim() || source.url.trim() || source.provider_problem_id?.trim();
      const normalizedVariant = source.variant?.trim();
      const normalizedSourceTitle = source.source_title?.trim();
      const sourceHasExtendedContent = normalizedVariant || normalizedSourceTitle;
      if (!hasSourceContent) {
        if (!sourceHasExtendedContent) {
          return;
        }
      }
      if (!source.provider.trim()) {
        errors.push(`problem ${index + 1} source ${sourceIndex + 1}: provider is required`);
      }
      if (!source.kind.trim()) {
        errors.push(`problem ${index + 1} source ${sourceIndex + 1}: kind is required`);
      }
      if (!source.url.trim()) {
        errors.push(`problem ${index + 1} source ${sourceIndex + 1}: url is required`);
      }
    });
  });

  validationErrors.value = errors;
  return errors.length === 0;
}

function submit() {
  if (!validate()) {
    return;
  }
  emit("submit", {
    contestId: props.initialValue?.contestId,
    title: title.value.trim(),
    aliases: dedupe(aliases.value),
    tags: dedupe(tags.value),
    sources: sources.value
      .map((source) => ({
        provider: source.provider.trim(),
        kind: source.kind.trim(),
        variant: normalizeVariant({
          provider: source.provider.trim(),
          variant: source.variant?.trim(),
        }) || undefined,
        url: source.url.trim(),
        provider_contest_id: source.provider_contest_id?.trim() || undefined,
        provider_problem_id: source.provider_problem_id?.trim() || undefined,
        source_title: source.source_title?.trim() || undefined,
        label: source.label?.trim() || undefined,
      }))
      .filter((source) => source.provider && source.kind && source.url),
    notes: notes.value.trim() || null,
    problems: problems.value.map((problem) => ({
      ordinal: problem.ordinal.trim(),
      title: problem.title.trim(),
      aliases: aggregateAliasesFromSources(
        problem.title.trim(),
        dedupe(problem.aliases),
        problem.sources.map((source) => ({
          ...source,
          source_title: source.source_title?.trim() || undefined,
        })),
      ),
      sources: problem.sources.map((source) => ({
        ...source,
        variant: normalizeVariant({
          provider: source.provider.trim(),
          variant: source.variant?.trim(),
        }) || undefined,
        source_title: source.source_title?.trim() || undefined,
      })),
    })).filter((problem) => problem.ordinal && problem.title),
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
      <label>Sources</label>
      <div class="contest-source-list">
        <div v-for="(source, index) in sources" :key="index" class="contest-source-card">
          <div class="form-grid">
            <div class="field">
              <label>Provider</label>
              <select v-model="source.provider" class="input-select" @change="handleProviderChange(index)">
                <option value="codeforces">codeforces</option>
                <option value="qoj">qoj</option>
                <option value="board_xcpcio">board_xcpcio</option>
                <option value="other">other</option>
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
              <label>Variant</label>
              <select v-model="source.variant" class="input-select">
                <option value="gym_public">gym_public</option>
                <option value="gym_private">gym_private</option>
              </select>
            </div>
            <div class="field">
              <label>Label</label>
              <input v-model="source.label" type="text" placeholder="Codeforces Gym" />
            </div>
            <div class="field">
              <label>Source Title</label>
              <input v-model="source.source_title" type="text" placeholder="Contest title on this source" />
            </div>
            <div class="field" style="grid-column: 1 / -1">
              <label>URL</label>
              <input v-model="source.url" type="text" placeholder="https://codeforces.com/gym/105922" />
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
          Add Source
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
