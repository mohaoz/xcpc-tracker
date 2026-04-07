import type { CatalogSource } from "./catalog";

function normalizePath(path: string) {
  return path.replace(/^\/+|\/+$/gu, "");
}

function sourceToBoardPath(source: CatalogSource): string | null {
  const providerContestId = (source.provider_contest_id ?? "").trim();
  if (providerContestId) {
    return normalizePath(providerContestId);
  }

  const url = (source.url ?? "").trim();
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const dataPrefix = "/data/";
    if (parsed.pathname.startsWith(dataPrefix)) {
      const withoutDataPrefix = parsed.pathname.slice(dataPrefix.length);
      return normalizePath(withoutDataPrefix.replace(/\/(?:config|team|run)\.json$/u, ""));
    }
    return normalizePath(parsed.pathname);
  } catch {
    return normalizePath(url);
  }
}

export function findXcpcioBoardStandingsSource(sources: CatalogSource[]): CatalogSource | null {
  return sources.find(
    (source) =>
      (source.provider === "xcpcio_board" || source.provider === "board_xcpcio") &&
      (source.kind === "standings" || source.kind === "ranking" || source.kind === "contest") &&
      sourceToBoardPath(source) !== null,
    ) ?? null;
}
