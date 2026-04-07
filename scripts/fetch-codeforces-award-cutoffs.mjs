#!/usr/bin/env node

import fs from "node:fs/promises";

const DEFAULT_CATALOG_PATH = "catalog/default-catalog.min.json";
const DEFAULT_CUTOFFS_OUTPUT_PATH = "data/codeforces-award-cutoffs.json";
const CODEFORCES_API_BASE_URL = "https://codeforces.com/api/contest.standings";
const CODEFORCES_USER_AGENT = "xcpc-tracker catalog tooling";
const REQUEST_DELAY_MS = 350;
const MAX_FETCH_ATTEMPTS = 3;

function readArg(name, fallback) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCodeforcesContestId(source) {
  if (source?.provider !== "codeforces" || source?.kind !== "contest") {
    return null;
  }
  const providerContestId = String(source.provider_contest_id ?? "").trim();
  if (/^\d+$/u.test(providerContestId)) {
    return providerContestId;
  }
  return String(source.url ?? "").match(/codeforces\.com\/gym\/(\d+)/iu)?.[1] ?? null;
}

function getCodeforcesContestSource(contest) {
  return (contest.sources ?? []).find((source) => getCodeforcesContestId(source) !== null) ?? null;
}

function hasUsableAwardCutoffs(contest) {
  return typeof contest.awardCutoffs?.cutoffs?.bronze?.solved === "number" && contest.awardCutoffs.cutoffs.bronze.solved > 0;
}

function shouldFetchCodeforcesCutoff(contest, source) {
  return source && (contest.awardCutoffs?.sourceProvider === "codeforces" || !hasUsableAwardCutoffs(contest));
}

async function fetchCodeforcesStandings(contestId) {
  const url = new URL(CODEFORCES_API_BASE_URL);
  url.searchParams.set("contestId", contestId);
  url.searchParams.set("from", "1");
  url.searchParams.set("count", "100000");
  url.searchParams.set("showUnofficial", "false");

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": CODEFORCES_USER_AGENT,
        },
      });
      if (!response.ok) {
        const retryable = [429, 502, 503, 504].includes(response.status);
        if (!retryable || attempt === MAX_FETCH_ATTEMPTS) {
          throw new Error(`HTTP ${response.status}`);
        }
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        const payload = await response.json();
        if (payload.status !== "OK") {
          throw new Error(String(payload.comment ?? "Codeforces API error"));
        }
        return payload.result;
      }
    } catch (error) {
      lastError = error;
      if (attempt === MAX_FETCH_ATTEMPTS) {
        break;
      }
    }
    await sleep(REQUEST_DELAY_MS * attempt);
  }
  throw lastError ?? new Error("Codeforces API request failed");
}

function getTeamId(row) {
  const party = row.party ?? {};
  if (party.teamId !== undefined && party.teamId !== null) {
    return String(party.teamId);
  }
  if (party.teamName) {
    return String(party.teamName);
  }
  if (Array.isArray(party.members) && party.members.length > 0) {
    return party.members.map((member) => member.handle).filter(Boolean).join(",");
  }
  if (party.participantId !== undefined && party.participantId !== null) {
    return String(party.participantId);
  }
  return String(row.rank ?? "");
}

function getSolvedCount(row) {
  if (Number.isFinite(row.points) && Number.isInteger(row.points)) {
    return Number(row.points);
  }
  return (row.problemResults ?? []).filter((problem) => Number(problem.points ?? 0) > 0).length;
}

function getPenalty(row) {
  if (Number.isFinite(row.penalty)) {
    return Number(row.penalty);
  }
  let penalty = 0;
  for (const problem of row.problemResults ?? []) {
    if (Number(problem.points ?? 0) <= 0 || !Number.isFinite(problem.bestSubmissionTimeSeconds)) {
      continue;
    }
    penalty += Math.floor(Number(problem.bestSubmissionTimeSeconds) / 60);
    penalty += Number(problem.rejectedAttemptCount ?? 0) * 20;
  }
  return penalty;
}

function getOfficialRows(rows) {
  const withParticipantType = rows.filter((row) => typeof row.party?.participantType === "string");
  if (withParticipantType.length === 0) {
    return rows;
  }
  return rows.filter((row) => row.party?.participantType === "CONTESTANT");
}

function toRankedTeams(rows) {
  return rows
    .map((row, index) => ({
      id: getTeamId(row),
      rank: Number(row.rank ?? index + 1),
      solved: getSolvedCount(row),
      penalty: getPenalty(row),
    }))
    .filter((team) => team.id)
    .sort((left, right) =>
      left.rank - right.rank ||
      right.solved - left.solved ||
      left.penalty - right.penalty ||
      left.id.localeCompare(right.id),
    );
}

function getCutoff(rankedTeams, rank) {
  const team = rankedTeams[rank - 1];
  return team
    ? {
        rank: team.rank,
        solved: team.solved,
        penalty: team.penalty,
        teamId: team.id,
      }
    : null;
}

function getCutoffRecord(contest, source, standings) {
  const contestId = getCodeforcesContestId(source);
  const officialRows = getOfficialRows(standings.rows ?? []);
  const rankedTeams = toRankedTeams(officialRows);
  if (rankedTeams.length === 0) {
    throw new Error("No official Codeforces standings rows found");
  }
  const ranks = {
    gold: Math.floor(rankedTeams.length * 0.1),
    silver: Math.floor(rankedTeams.length * 0.3),
    bronze: Math.floor(rankedTeams.length * 0.6),
  };
  const cutoffs = {
    gold: getCutoff(rankedTeams, ranks.gold),
    silver: getCutoff(rankedTeams, ranks.silver),
    bronze: getCutoff(rankedTeams, ranks.bronze),
  };
  if (!cutoffs.bronze || cutoffs.bronze.solved <= 0) {
    throw new Error("No usable bronze cutoff from official Codeforces standings rows");
  }
  return {
    contest_id: contest.contestId,
    title: contest.title,
    codeforces_contest_id: contestId,
    source_url: source.url ?? `https://codeforces.com/gym/${contestId}`,
    source_provider: "codeforces",
    source_label: source.label ?? "Codeforces Gym",
    cutoff_source: "inferred_official_medal_ratio_10_20_30",
    eligible_team_count: rankedTeams.length,
    cutoffs,
  };
}

function toCatalogAwardCutoffs(cutoffRecord) {
  return {
    source: cutoffRecord.cutoff_source,
    sourceProvider: cutoffRecord.source_provider,
    sourceLabel: cutoffRecord.source_label,
    sourceUrl: cutoffRecord.source_url,
    eligibleTeamCount: cutoffRecord.eligible_team_count,
    cutoffs: cutoffRecord.cutoffs,
  };
}

const catalogPath = readArg("--catalog", DEFAULT_CATALOG_PATH);
const outputPath = readArg("--output", catalogPath);
const cutoffsOutputPath = readArg("--cutoffs-output", DEFAULT_CUTOFFS_OUTPUT_PATH);
const apply = hasFlag("--apply");
const maxContests = Number(readArg("--max-contests", "0"));

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
const candidates = (catalog.contests ?? [])
  .map((contest) => ({
    contest,
    source: getCodeforcesContestSource(contest),
  }))
  .filter(({ contest, source }) => shouldFetchCodeforcesCutoff(contest, source));

const limitedCandidates = maxContests > 0 ? candidates.slice(0, maxContests) : candidates;
const cutoffRecords = [];
const errors = [];

for (const [index, { contest, source }] of limitedCandidates.entries()) {
  const codeforcesContestId = getCodeforcesContestId(source);
  try {
    const standings = await fetchCodeforcesStandings(codeforcesContestId);
    cutoffRecords.push(getCutoffRecord(contest, source, standings));
  } catch (error) {
    errors.push({
      contest_id: contest.contestId,
      title: contest.title,
      codeforces_contest_id: codeforcesContestId,
      source_url: source.url ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (index < limitedCandidates.length - 1) {
    await sleep(REQUEST_DELAY_MS);
  }
}

if (apply) {
  const cutoffsByContestId = new Map(cutoffRecords.map((record) => [record.contest_id, record]));
  for (const contest of catalog.contests ?? []) {
    if (contest.awardCutoffs?.sourceProvider === "codeforces" && !hasUsableAwardCutoffs(contest)) {
      delete contest.awardCutoffs;
    }
    const cutoffRecord = cutoffsByContestId.get(contest.contestId);
    if (!cutoffRecord || (hasUsableAwardCutoffs(contest) && contest.awardCutoffs?.sourceProvider !== "codeforces")) {
      continue;
    }
    contest.awardCutoffs = toCatalogAwardCutoffs(cutoffRecord);
  }
  await fs.writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

const result = {
  generated_at: new Date().toISOString(),
  catalog_path: catalogPath,
  output_path: apply ? outputPath : null,
  cutoffs_output_path: cutoffsOutputPath,
  source_provider: "codeforces",
  apply,
  candidate_count: candidates.length,
  fetched_count: cutoffRecords.length,
  error_count: errors.length,
  cutoffs: cutoffRecords,
  errors,
};
await fs.writeFile(cutoffsOutputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
