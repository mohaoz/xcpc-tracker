import type { CatalogSource } from "./catalog";

function normalizeAliasValue(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function dedupeAliasValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeAliasValue(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function mergeAliases(
  primaryTitle: string,
  existingAliases: string[],
  candidates: Array<string | null | undefined>,
): string[] {
  const normalizedPrimaryTitle = normalizeAliasValue(primaryTitle).toLocaleLowerCase();

  return dedupeAliasValues([...existingAliases, ...candidates]).filter(
    (alias) => alias.toLocaleLowerCase() !== normalizedPrimaryTitle,
  );
}

export function aggregateAliasesFromSources(
  primaryTitle: string,
  existingAliases: string[],
  sources: CatalogSource[],
): string[] {
  return mergeAliases(
    primaryTitle,
    existingAliases,
    sources.map((source) => source.source_title),
  );
}

export function getCatalogSourceIdentity(source: CatalogSource): string {
  const providerScopedId = source.provider_problem_id ?? source.provider_contest_id ?? "";
  const fallbackLocator = providerScopedId.trim()
    ? providerScopedId.trim().toLocaleLowerCase()
    : (source.url ?? "").trim().toLocaleLowerCase();
  return [
    source.provider.trim().toLocaleLowerCase(),
    source.kind.trim().toLocaleLowerCase(),
    fallbackLocator,
  ].join("::");
}

export function mergeCatalogSources(existingSources: CatalogSource[], nextSource: CatalogSource): CatalogSource[] {
  const nextIdentity = getCatalogSourceIdentity(nextSource);
  const existingIndex = existingSources.findIndex(
    (source) => getCatalogSourceIdentity(source) === nextIdentity,
  );

  if (existingIndex < 0) {
    return [...existingSources, nextSource];
  }

  const current = existingSources[existingIndex];
  const merged = {
    ...current,
    ...nextSource,
    source_title: nextSource.source_title ?? current.source_title,
    label: nextSource.label ?? current.label,
  } satisfies CatalogSource;

  return existingSources.map((source, index) => (index === existingIndex ? merged : source));
}
