#!/usr/bin/env node

const acceptedStatuses = new Set(["ACCEPTED", "CORRECT", "OK"]);
const pendingStatuses = new Set(["PENDING"]);

function printUsageAndExit() {
  console.error("Usage: node scripts/fetch-xcpcio-award-cutoffs.mjs <board-path-or-url>");
  console.error("Example: node scripts/fetch-xcpcio-award-cutoffs.mjs /icpc/50th/ecfinal");
  process.exit(1);
}

function normalizePath(value) {
  return String(value ?? "").trim().replace(/^\/+|\/+$/gu, "");
}

function toBoardPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith("/data/")) {
      return normalizePath(parsed.pathname.slice("/data/".length).replace(/\/(?:config|team|run)\.json$/u, ""));
    }
    return normalizePath(parsed.pathname);
  } catch {
    return normalizePath(raw);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

function getTeamId(team) {
  const id = team.id ?? team.team_id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function normalizeBoardCollection(value, label) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an array or object map`);
  }
  for (const key of [label, `${label}s`, "data", "rows"]) {
    if (Array.isArray(value[key])) {
      return value[key];
    }
  }
  if (label === "team") {
    return Object.entries(value).map(([id, team]) => (
      team && typeof team === "object" && !Array.isArray(team)
        ? { id, ...team }
        : { id, members: team }
    ));
  }
  return Object.values(value);
}

function getEligibleTeamIds(teams) {
  const officialTeamIds = teams
    .filter((team) => team.group?.includes("official") || team.official === true || team.official === 1)
    .map(getTeamId)
    .filter((id) => id !== null);

  if (officialTeamIds.length > 0) {
    return {
      source: "inferred_official_medal_ratio_10_20_30",
      teamIds: new Set(officialTeamIds),
    };
  }

  return {
    source: "inferred_all_teams_medal_ratio_10_20_30",
    teamIds: new Set(teams.map(getTeamId).filter((id) => id !== null)),
  };
}

function getTimestampDivisor(config) {
  const unit = config.options?.submission_timestamp_unit;
  if (unit === "millisecond") {
    return 60_000;
  }
  if (unit === "minute") {
    return 1;
  }
  return 60;
}

function buildRankedTeams(config, teams, runs) {
  const { source, teamIds } = getEligibleTeamIds(teams);
  const rankedById = new Map([...teamIds].map((teamId) => [
    teamId,
    {
      id: teamId,
      solved: 0,
      penalty: 0,
      problems: new Map(),
    },
  ]));
  const timestampDivisor = getTimestampDivisor(config);

  for (const run of [...runs].sort((left, right) => Number(left.timestamp ?? 0) - Number(right.timestamp ?? 0))) {
    const teamId = typeof run.team_id === "string" || typeof run.team_id === "number" ? String(run.team_id) : null;
    const problemId = typeof run.problem_id === "string" || typeof run.problem_id === "number" ? String(run.problem_id) : null;
    const status = String(run.status ?? "").toUpperCase();
    const team = teamId ? rankedById.get(teamId) : null;
    if (!team || !problemId) {
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

function getCutoffRanks(config, teamCount) {
  const officialMedals = config.medal?.official;
  if (officialMedals?.gold && officialMedals.silver && officialMedals.bronze) {
    return {
      source: "explicit",
      ranks: {
        gold: officialMedals.gold,
        silver: officialMedals.gold + officialMedals.silver,
        bronze: officialMedals.gold + officialMedals.silver + officialMedals.bronze,
      },
    };
  }
  return {
    source: null,
    ranks: {
      gold: Math.floor(teamCount * 0.1),
      silver: Math.floor(teamCount * 0.3),
      bronze: Math.floor(teamCount * 0.6),
    },
  };
}

function getCutoff(rankedTeams, rank) {
  const team = rankedTeams[rank - 1];
  return team
    ? {
        rank,
        solved: team.solved,
        penalty: team.penalty,
        team_id: team.id,
      }
    : null;
}

const boardPath = toBoardPath(process.argv[2]);
if (!boardPath) {
  printUsageAndExit();
}

const baseUrl = `https://board.xcpcio.com/data/${boardPath}`;
const [config, teams, runs] = await Promise.all([
  fetchJson(`${baseUrl}/config.json`),
  fetchJson(`${baseUrl}/team.json`),
  fetchJson(`${baseUrl}/run.json`),
]);

const { source: inferredSource, rankedTeams } = buildRankedTeams(
  config,
  normalizeBoardCollection(teams, "team"),
  normalizeBoardCollection(runs, "run"),
);
const cutoffRanks = getCutoffRanks(config, rankedTeams.length);
const result = {
  board_path: `/${boardPath}`,
  source_url: `https://board.xcpcio.com/${boardPath}`,
  cutoff_source: cutoffRanks.source ?? inferredSource,
  eligible_team_count: rankedTeams.length,
  cutoffs: {
    gold: getCutoff(rankedTeams, cutoffRanks.ranks.gold),
    silver: getCutoff(rankedTeams, cutoffRanks.ranks.silver),
    bronze: getCutoff(rankedTeams, cutoffRanks.ranks.bronze),
  },
};

console.log(JSON.stringify(result, null, 2));
