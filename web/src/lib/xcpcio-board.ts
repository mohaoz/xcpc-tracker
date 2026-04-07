import type { CatalogSource } from "./catalog";

type XcpcioLocalizedText = string | {
  fallback_lang?: string;
  texts?: Record<string, string>;
};

type XcpcioBoardConfig = {
  contest_name?: XcpcioLocalizedText;
  problem_id?: string[];
  problem_quantity?: number;
  medal?: {
    official?: Partial<Record<XcpcioMedal, number>>;
  };
  options?: {
    submission_timestamp_unit?: "millisecond" | "second" | "minute" | string;
  };
};

type XcpcioBoardTeam = {
  id?: string | number;
  team_id?: string | number;
  group?: string[];
  official?: boolean | number;
};

type XcpcioBoardRun = {
  team_id?: string | number;
  problem_id?: string | number;
  timestamp?: number;
  status?: string;
};

type XcpcioMedal = "gold" | "silver" | "bronze";

export type XcpcioAwardCutoff = {
  rank: number;
  solved: number;
  penalty: number;
  teamId: string;
};

export type XcpcioAwardCutoffSummary = {
  source: "explicit" | "inferred_official_medal_ratio_10_20_30" | "inferred_all_teams_medal_ratio_10_20_30";
  eligibleTeamCount: number;
  cutoffs: Record<XcpcioMedal, XcpcioAwardCutoff | null>;
  sourceUrl: string;
};

type RankedTeam = {
  id: string;
  solved: number;
  penalty: number;
  problems: Map<string, {
    wrongAttempts: number;
    solved: boolean;
  }>;
};

const acceptedStatuses = new Set(["ACCEPTED", "CORRECT", "OK"]);
const pendingStatuses = new Set(["PENDING"]);

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

function buildDataBaseUrl(source: CatalogSource) {
  const path = sourceToBoardPath(source);
  if (!path) {
    throw new Error("XCPCIO Board source is missing a contest path");
  }
  return `https://board.xcpcio.com/data/${path}`;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`XCPCIO Board HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function getTeamId(team: XcpcioBoardTeam): string | null {
  const id = team.id ?? team.team_id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function getEligibleTeamIds(teams: XcpcioBoardTeam[]) {
  const officialTeamIds = teams
    .filter((team) => team.group?.includes("official") || team.official === true || team.official === 1)
    .map(getTeamId)
    .filter((id): id is string => id !== null);

  if (officialTeamIds.length > 0) {
    return {
      teamIds: new Set(officialTeamIds),
      source: "inferred_official_medal_ratio_10_20_30" as const,
    };
  }

  return {
    teamIds: new Set(teams.map(getTeamId).filter((id): id is string => id !== null)),
    source: "inferred_all_teams_medal_ratio_10_20_30" as const,
  };
}

function getPenaltyTimestampDivisor(config: XcpcioBoardConfig) {
  if (config.options?.submission_timestamp_unit === "millisecond") {
    return 60_000;
  }
  if (config.options?.submission_timestamp_unit === "second") {
    return 60;
  }
  if (config.options?.submission_timestamp_unit === "minute") {
    return 1;
  }
  return 60;
}

function buildRankedTeams(config: XcpcioBoardConfig, teams: XcpcioBoardTeam[], runs: XcpcioBoardRun[]) {
  const { teamIds, source } = getEligibleTeamIds(teams);
  const rankedById = new Map<string, RankedTeam>();
  for (const teamId of teamIds) {
    rankedById.set(teamId, {
      id: teamId,
      solved: 0,
      penalty: 0,
      problems: new Map(),
    });
  }

  const timestampDivisor = getPenaltyTimestampDivisor(config);
  for (const run of [...runs].sort((left, right) => Number(left.timestamp ?? 0) - Number(right.timestamp ?? 0))) {
    const teamId = typeof run.team_id === "string" || typeof run.team_id === "number" ? String(run.team_id) : null;
    const problemId = typeof run.problem_id === "string" || typeof run.problem_id === "number" ? String(run.problem_id) : null;
    const status = (run.status ?? "").toUpperCase();
    if (!teamId || !problemId) {
      continue;
    }
    const team = rankedById.get(teamId);
    if (!team) {
      continue;
    }

    const problem = team.problems.get(problemId) ?? {
      wrongAttempts: 0,
      solved: false,
    };
    team.problems.set(problemId, problem);
    if (problem.solved) {
      continue;
    }

    if (acceptedStatuses.has(status)) {
      const penalty = Math.floor(Number(run.timestamp ?? 0) / timestampDivisor) + problem.wrongAttempts * 20;
      problem.solved = true;
      team.solved += 1;
      team.penalty += penalty;
    } else if (!pendingStatuses.has(status)) {
      problem.wrongAttempts += 1;
    }
  }

  return {
    source,
    rankedTeams: [...rankedById.values()].sort(
      (left, right) =>
        right.solved - left.solved ||
        left.penalty - right.penalty ||
        left.id.localeCompare(right.id),
    ),
  };
}

function getExplicitCutoffRanks(config: XcpcioBoardConfig): Record<XcpcioMedal, number> | null {
  const officialMedals = config.medal?.official;
  if (!officialMedals?.gold || !officialMedals.silver || !officialMedals.bronze) {
    return null;
  }
  return {
    gold: officialMedals.gold,
    silver: officialMedals.gold + officialMedals.silver,
    bronze: officialMedals.gold + officialMedals.silver + officialMedals.bronze,
  };
}

function getInferredCutoffRanks(teamCount: number): Record<XcpcioMedal, number> {
  return {
    gold: Math.floor(teamCount * 0.1),
    silver: Math.floor(teamCount * 0.3),
    bronze: Math.floor(teamCount * 0.6),
  };
}

function getCutoff(rankedTeams: RankedTeam[], rank: number): XcpcioAwardCutoff | null {
  if (rank < 1) {
    return null;
  }
  const team = rankedTeams[rank - 1];
  if (!team) {
    return null;
  }
  return {
    rank,
    solved: team.solved,
    penalty: team.penalty,
    teamId: team.id,
  };
}

export async function fetchXcpcioAwardCutoffs(
  source: CatalogSource,
  signal?: AbortSignal,
): Promise<XcpcioAwardCutoffSummary> {
  const baseUrl = buildDataBaseUrl(source);
  const [config, teams, runs] = await Promise.all([
    fetchJson<XcpcioBoardConfig>(`${baseUrl}/config.json`, signal),
    fetchJson<XcpcioBoardTeam[]>(`${baseUrl}/team.json`, signal),
    fetchJson<XcpcioBoardRun[]>(`${baseUrl}/run.json`, signal),
  ]);

  const { source: inferredSource, rankedTeams } = buildRankedTeams(config, teams, runs);
  const explicitCutoffRanks = getExplicitCutoffRanks(config);
  const cutoffRanks = explicitCutoffRanks ?? getInferredCutoffRanks(rankedTeams.length);
  const summarySource = explicitCutoffRanks ? "explicit" : inferredSource;

  return {
    source: summarySource,
    eligibleTeamCount: rankedTeams.length,
    sourceUrl: source.url ?? `https://board.xcpcio.com/${sourceToBoardPath(source) ?? ""}`,
    cutoffs: {
      gold: getCutoff(rankedTeams, cutoffRanks.gold),
      silver: getCutoff(rankedTeams, cutoffRanks.silver),
      bronze: getCutoff(rankedTeams, cutoffRanks.bronze),
    },
  };
}
