#!/usr/bin/env node

import fs from "node:fs/promises";

const DEFAULT_CATALOG_PATH = "catalog/default-catalog.min.json";
const DEFAULT_BOARD_INDEX_URL = "https://board.xcpcio.com/data/index/contest_list.json";
const DEFAULT_RAW_OUTPUT_PATH = "data/xcpcio-board-raw.json";
const DEFAULT_NORMALIZED_OUTPUT_PATH = "data/xcpcio-board-contests.json";
const DEFAULT_CUTOFFS_OUTPUT_PATH = "data/xcpcio-board-award-cutoffs.json";
const acceptedStatuses = new Set(["ACCEPTED", "CORRECT", "OK"]);
const pendingStatuses = new Set(["PENDING"]);

const genericTags = new Set([
  "icpc",
  "ccpc",
  "ec",
  "省赛",
  "区域赛",
  "邀请赛",
  "总决赛",
  "网络赛",
  "热身赛",
  "多省",
  "女生专场",
  "高职专场",
]);
const locationPatterns = [
  ["北京", /北京|beijing/iu],
  ["上海", /上海|shanghai/iu],
  ["天津", /天津|tianjin/iu],
  ["重庆", /重庆|chongqing/iu],
  ["武汉", /武汉|wuhan/iu],
  ["沈阳", /沈阳|shenyang/iu],
  ["南京", /南京|nanjing/iu],
  ["杭州", /杭州|hangzhou/iu],
  ["济南", /济南|jinan/iu],
  ["威海", /威海|weihai/iu],
  ["桂林", /桂林|guilin/iu],
  ["哈尔滨", /哈尔滨|harbin/iu],
  ["郑州", /郑州|zhengzhou/iu],
  ["南昌", /南昌|nanchang/iu],
  ["长春", /长春|changchun/iu],
  ["湘潭", /湘潭|xiangtan/iu],
  ["成都", /成都|chengdu/iu],
  ["广州", /广州|guangzhou/iu],
  ["深圳", /深圳|shenzhen/iu],
  ["西安", /西安|xi'?an|xian/iu],
  ["福州", /福州|fuzhou/iu],
  ["宁波", /宁波|ningbo/iu],
  ["大连", /大连|dalian/iu],
  ["秦皇岛", /秦皇岛|qinhuangdao/iu],
  ["绵阳", /绵阳|mianyang/iu],
  ["银川", /银川|yinchuan/iu],
  ["澳门", /澳门|macau/iu],
  ["香港", /香港|hong kong|hongkong/iu],
  ["合肥", /合肥|hefei|ustc/iu],
  ["哈尔滨", /哈尔滨|harbin|hit|hrbeu|hrbust/iu],
  ["昆明", /昆明|kunming/iu],
  ["华南", /华南|south china/iu],
  ["四川", /四川|sichuan/iu],
  ["东北", /东北|northeast|northeastern/iu],
  ["江苏", /江苏|jiangsu/iu],
  ["浙江", /浙江|zhejiang/iu],
  ["山东", /山东|shandong/iu],
  ["湖南", /湖南|hunan/iu],
  ["湖北", /湖北|hubei/iu],
  ["江西", /江西|jiangxi/iu],
  ["吉林", /吉林|jilin/iu],
  ["黑龙江", /黑龙江|heilongjiang/iu],
  ["辽宁", /辽宁|liaoning/iu],
  ["广东", /广东|guangdong/iu],
  ["福建", /福建|fujian/iu],
  ["新疆", /新疆|xinjiang/iu],
  ["河北", /河北|hebei/iu],
  ["河南", /河南|henan/iu],
  ["贵州", /贵州|guizhou/iu],
  ["广西", /广西|guangxi/iu],
  ["陕西", /陕西|shaanxi|shanxi/iu],
];

function readArg(name, fallback) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizePath(value) {
  return String(value ?? "").trim().replace(/^\/+|\/+$/gu, "");
}

function normalizeTitle(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[`~!@#$%^*+=|\\:;"'<>,.?/[\]{}]/gu, " ")
    .replace(/[（）()【】「」“”《》]/gu, " ")
    .replace(/\bthe\b|\bcontest\b|\bofficial\b|\bonsite\b|\bsite\b|\bstage\b/giu, " ")
    .replace(/第|届|年|杯|站|赛区|正式赛|现场赛|大学生|程序设计|竞赛|中国|国际|亚洲|区域|邀请|省|市/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function getYearFromText(value) {
  return String(value ?? "").match(/(?:19|20)\d{2}/u)?.[0] ?? null;
}

function getYearFromBoardPath(value) {
  const boardPath = toBoardPath(value);
  return boardPath.match(/^(?:ccpc|icpc|provincial-contest)\/((?:19|20)\d{2})(?:\/|$)/u)?.[1] ?? null;
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseChineseInteger(value) {
  const normalized = String(value ?? "").trim();
  if (/^\d+$/u.test(normalized)) {
    return Number(normalized);
  }

  const digits = new Map([
    ["零", 0],
    ["一", 1],
    ["二", 2],
    ["两", 2],
    ["三", 3],
    ["四", 4],
    ["五", 5],
    ["六", 6],
    ["七", 7],
    ["八", 8],
    ["九", 9],
  ]);
  if (!normalized.includes("十")) {
    return digits.get(normalized) ?? null;
  }

  const [tensRaw, onesRaw] = normalized.split("十");
  const tens = tensRaw ? digits.get(tensRaw) : 1;
  const ones = onesRaw ? digits.get(onesRaw) : 0;
  if (tens === undefined || ones === undefined) {
    return null;
  }
  return tens * 10 + ones;
}

function extractCcpcEdition(value) {
  const haystack = String(value ?? "");
  if (!/ccpc|中国大学生程序设计竞赛/iu.test(haystack)) {
    return null;
  }

  const pathEdition = haystack.match(/\/ccpc\/(\d+)(?:st|nd|rd|th)\//iu)?.[1];
  if (pathEdition) {
    return Number(pathEdition);
  }

  const chineseEdition = haystack.match(/第\s*([一二两三四五六七八九十\d]+)\s*届/iu)?.[1];
  if (chineseEdition) {
    return parseChineseInteger(chineseEdition);
  }

  const englishEdition = haystack.match(/\b(?:the\s*)?(\d+)(?:st|nd|rd|th)\s+CCPC\b/iu)?.[1];
  if (englishEdition) {
    return Number(englishEdition);
  }

  const englishFullNameEdition = haystack.match(
    /\b(?:the\s*)?(\d+)(?:st|nd|rd|th)\s+(?:China\s+)?Collegiate\s+Programming\s+Contest\b/iu,
  )?.[1];
  return englishFullNameEdition ? Number(englishFullNameEdition) : null;
}

function extractIcpcEdition(value) {
  const haystack = String(value ?? "");
  if (!/\bicpc\b|acm-icpc/iu.test(haystack)) {
    return null;
  }

  const pathEdition = haystack.match(/\/icpc\/(\d+)(?:st|nd|rd|th)\//iu)?.[1];
  if (pathEdition) {
    return Number(pathEdition);
  }

  const chineseEdition = haystack.match(/第\s*([一二两三四五六七八九十\d]+)\s*届[^，。；;]*?(?:ACM-)?ICPC/iu)?.[1];
  if (chineseEdition) {
    return parseChineseInteger(chineseEdition);
  }

  const englishEdition = haystack.match(/\b(?:the\s*)?(\d+)(?:st|nd|rd|th)\s+(?:ACM-)?ICPC\b/iu)?.[1];
  return englishEdition ? Number(englishEdition) : null;
}

function getYearFromSeriesEdition(value) {
  const ccpcEdition = extractCcpcEdition(value);
  if (ccpcEdition) {
    return String(ccpcEdition + 2014);
  }
  const icpcEdition = extractIcpcEdition(value);
  if (icpcEdition) {
    return String(icpcEdition + 1975);
  }
  return null;
}

function isPureNationalInvitational(value) {
  const haystack = String(value ?? "");
  return (
    /National Invitational|全国邀请赛|国邀/iu.test(haystack) &&
    !/Provincial|Collegiate|省赛|省大学生|省程序设计|地区大学生|Multi-Provincial|多省/iu.test(haystack)
  );
}

function extractEdition(value) {
  const haystack = String(value ?? "");
  const chineseEdition = haystack.match(/第\s*([一二两三四五六七八九十\d]+)\s*届/iu)?.[1];
  if (chineseEdition) {
    return parseChineseInteger(chineseEdition);
  }

  const englishEdition = haystack.match(/\b(\d+)(?:st|nd|rd|th)\b/iu)?.[1];
  return englishEdition ? Number(englishEdition) : null;
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

function inferBoardTags(item) {
  const title = String(item.title ?? item.config?.contest_name ?? "");
  const link = String(item.board_link ?? item.url ?? "");
  const haystack = `${title} ${link}`;
  const tags = [];
  const year = getYearFromText(title) ?? getYearFromBoardPath(link) ?? getYearFromSeriesEdition(haystack);
  if (year) tags.push(year);
  if (/icpc/iu.test(haystack) || link.includes("/icpc/")) tags.push("icpc");
  if (/ccpc/iu.test(haystack) || link.includes("/ccpc/")) tags.push("ccpc");
  if (/provincial-contest|northeastern/iu.test(link) || /省|东北地区/iu.test(title)) tags.push("省赛");
  if (/regional|区域|现场赛|onsite|\bsite\b|(?<!正式)赛区|站/iu.test(title)) tags.push("区域赛");
  if (/East Continent|EC-Final|China-Final|ECL-Final|EC\s*Final/iu.test(haystack)) tags.push("ec");
  if (/invitational|邀请/iu.test(title)) tags.push("邀请赛");
  if (/final|总决赛/iu.test(title)) tags.push("总决赛");
  if (/online|网络/iu.test(haystack)) tags.push("网络赛");
  if (/\((?:I|1)\)|online-qualification-1|Phase\s*1|第一场/iu.test(haystack)) tags.push("第一场");
  if (/\((?:II|2)\)|online-qualification-2|Phase\s*2|第二场/iu.test(haystack)) tags.push("第二场");
  if (/warmup|warm-up|practice|热身|练习/iu.test(haystack)) tags.push("热身赛");
  if (/Women|Female|女生/iu.test(title)) tags.push("女生专场");
  if (/Vocational|高职/iu.test(title)) tags.push("高职专场");
  for (const [tag, pattern] of locationPatterns) {
    if (pattern.test(haystack)) tags.push(tag);
  }
  return dedupe(tags);
}

function flattenBoardIndex(root) {
  const items = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (value.config && value.board_link) {
      const title = String(value.config.contest_name ?? "");
      const url = `https://board.xcpcio.com${value.board_link}`;
      items.push({
        board_link: value.board_link,
        title,
        url,
        tags: inferBoardTags(value),
        normalizedTitle: normalizeTitle(title),
        config: value.config,
      });
      return;
    }
    for (const child of Object.values(value)) {
      walk(child);
    }
  };
  walk(root);
  return items;
}

function normalizeBoardItems(rawItems) {
  return rawItems
    .map((item) => ({
      title: item.title,
      url: item.url,
      board_link: item.board_link,
      start_time: item.config?.start_time ?? null,
      source_provider: "xcpcio_board",
    }))
    .filter((item) => item.title && item.url);
}

function boardItemsFromNormalizedContests(contests) {
  return contests.map((contest) => ({
    board_link: contest.board_link ?? new URL(contest.url).pathname,
    title: contest.title,
    url: contest.url,
    tags: inferBoardTags(contest),
    normalizedTitle: normalizeTitle(contest.title),
    config: {
      contest_name: contest.title,
      start_time: contest.start_time ?? null,
    },
  }));
}

function titleOverlapScore(left, right) {
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 100;
  }
  if (left.includes(right) || right.includes(left)) {
    return 45;
  }
  const leftTokens = new Set(left.split(/\s+/gu).filter((token) => token.length >= 2));
  const rightTokens = new Set(right.split(/\s+/gu).filter((token) => token.length >= 2));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return Math.round((70 * 2 * intersection) / (leftTokens.size + rightTokens.size));
}

function scoreCandidate(contest, boardItem) {
  const contestTags = contest.tags ?? [];
  const contestYear =
    contestTags.find((tag) => /^(?:19|20)\d{2}$/u.test(tag)) ??
    getYearFromText(contest.title) ??
    getYearFromSeriesEdition(contest.title);
  const boardYear = boardItem.tags.find((tag) => /^(?:19|20)\d{2}$/u.test(tag));
  const contestIsWarmup = contestTags.includes("热身赛") || /warm ?up|practice|热身|练习/iu.test(contest.title);
  const boardIsWarmup = boardItem.tags.includes("热身赛");
  const contestIsOnline = contestTags.includes("网络赛") || /online|网络/iu.test(contest.title);
  const boardIsOnline = boardItem.tags.includes("网络赛");
  const contestIsFinal = contestTags.includes("总决赛") || /final|总决赛/iu.test(contest.title);
  const boardIsFinal = boardItem.tags.includes("总决赛");
  const contestIsRegional = contestTags.includes("区域赛") || /regional|区域|onsite|\bsite\b|站/iu.test(contest.title);
  const boardIsRegional = boardItem.tags.includes("区域赛");
  const contestIsInvitational = contestTags.includes("邀请赛") || /invitational|邀请/iu.test(contest.title);
  const boardIsInvitational = boardItem.tags.includes("邀请赛");
  const contestIsProvincial =
    !isPureNationalInvitational(contest.title) &&
    (contestTags.includes("省赛") || /provincial|省赛|省大学生|省程序设计|市大学生/iu.test(contest.title));
  const boardIsProvincial = boardItem.tags.includes("省赛");
  const contestIsWomen = contestTags.includes("女生专场") || /women|female|女生/iu.test(contest.title);
  const boardIsWomen = boardItem.tags.includes("女生专场");
  const contestIsVocational = contestTags.includes("高职专场") || /vocational|高职/iu.test(contest.title);
  const boardIsVocational = boardItem.tags.includes("高职专场");
  const contestCcpcEdition = extractCcpcEdition(contest.title);
  const boardCcpcEdition = extractCcpcEdition(`${boardItem.title} ${boardItem.board_link} ${boardItem.url ?? ""}`);
  const contestIcpcEdition = extractIcpcEdition(contest.title);
  const boardIcpcEdition = extractIcpcEdition(`${boardItem.title} ${boardItem.board_link} ${boardItem.url ?? ""}`);
  const contestEdition = extractEdition(contest.title);
  const boardEdition = extractEdition(boardItem.title);

  if (contestIsWarmup !== boardIsWarmup) {
    return null;
  }
  if (contestIsOnline !== boardIsOnline && (contestIsOnline || boardIsOnline)) {
    return null;
  }
  if (contestIsFinal !== boardIsFinal && (contestIsFinal || boardIsFinal)) {
    return null;
  }
  if (contestIsWomen !== boardIsWomen && (contestIsWomen || boardIsWomen)) {
    return null;
  }
  if (contestIsVocational !== boardIsVocational && (contestIsVocational || boardIsVocational)) {
    return null;
  }
  if (
    contestIsInvitational !== boardIsInvitational &&
    (contestIsInvitational || boardIsInvitational) &&
    !(contestIsProvincial && boardIsProvincial)
  ) {
    return null;
  }
  if (
    !(contestIsInvitational && boardIsInvitational) &&
    contestIsRegional !== boardIsRegional &&
    (contestIsRegional || boardIsRegional)
  ) {
    return null;
  }
  if (contestIsProvincial !== boardIsProvincial && (contestIsProvincial || boardIsProvincial)) {
    return null;
  }
  if (contestIsProvincial && boardIsProvincial && contestYear && boardYear && contestYear !== boardYear) {
    return null;
  }
  if (contestIsProvincial && boardIsProvincial && contestEdition && boardEdition && contestEdition !== boardEdition) {
    return null;
  }

  let score = titleOverlapScore(normalizeTitle(contest.title), boardItem.normalizedTitle);
  const reasons = [];
  if (score > 0) {
    reasons.push(`title:${score}`);
  }
  if (contestCcpcEdition && boardCcpcEdition && contestCcpcEdition === boardCcpcEdition) {
    score += 70;
    reasons.push(`ccpc_edition:${contestCcpcEdition}`);
  } else if (contestCcpcEdition && boardCcpcEdition && contestCcpcEdition !== boardCcpcEdition) {
    return null;
  }
  if (contestIcpcEdition && boardIcpcEdition && contestIcpcEdition === boardIcpcEdition) {
    score += 70;
    reasons.push(`icpc_edition:${contestIcpcEdition}`);
  } else if (contestIcpcEdition && boardIcpcEdition && contestIcpcEdition !== boardIcpcEdition) {
    return null;
  }
  const contestSpecificTags = contestTags.filter((tag) => !genericTags.has(tag) && !/^(?:19|20)\d{2}$/u.test(tag));
  const hasSpecificTagIntersection = contestSpecificTags.some((tag) => boardItem.tags.includes(tag));
  const contestSeries = contestTags.find((tag) => tag === "icpc" || tag === "ccpc");
  const boardSeries = boardItem.tags.find((tag) => tag === "icpc" || tag === "ccpc");
  if (contestSpecificTags.length > 0 && !hasSpecificTagIntersection && score < 90) {
    return null;
  }

  if (contestYear && boardYear && contestYear === boardYear) {
    score += 30;
    reasons.push("year");
  } else if (contestYear && boardYear && contestYear !== boardYear) {
    score -= 80;
    reasons.push("year_mismatch");
  }

  for (const tag of contestTags) {
    if (!boardItem.tags.includes(tag)) {
      continue;
    }
    const delta = genericTags.has(tag) ? 6 : 22;
    score += delta;
    reasons.push(`tag:${tag}`);
  }

  if (contestSpecificTags.length > 0 && contestSpecificTags.every((tag) => boardItem.tags.includes(tag))) {
    score += 24;
    reasons.push("all_specific_tags");
  }
  if (
    contestYear &&
    boardYear &&
    contestYear === boardYear &&
    contestSeries &&
    boardSeries &&
    contestSeries === boardSeries &&
    contestSpecificTags.length > 0 &&
    contestSpecificTags.every((tag) => boardItem.tags.includes(tag))
  ) {
    score += 15;
    reasons.push("year_series_all_specific_tags");
  }
  if (
    contestYear &&
    boardYear &&
    contestYear === boardYear &&
    contestSeries &&
    boardSeries &&
    contestSeries === boardSeries &&
    ["ec", "网络赛", "女生专场", "高职专场"].some((tag) => contestTags.includes(tag) && boardItem.tags.includes(tag))
  ) {
    score += 25;
    reasons.push("year_series_event_type");
  }
  if (
    contestYear &&
    boardYear &&
    contestYear === boardYear &&
    contestSeries &&
    boardSeries &&
    contestSeries === boardSeries &&
    contestTags.includes("ec") &&
    boardItem.tags.includes("ec") &&
    contestIsFinal &&
    boardIsFinal
  ) {
    score += 30;
    reasons.push("ec_final_year_series");
  }
  if (
    contestYear &&
    boardYear &&
    contestYear === boardYear &&
    contestSeries &&
    boardSeries &&
    contestSeries === boardSeries &&
    contestIsOnline &&
    boardIsOnline
  ) {
    score += 35;
    reasons.push("online_year_series");
  }
  if (contestIsProvincial && boardIsProvincial && contestEdition && boardEdition && contestEdition === boardEdition) {
    score += 40;
    reasons.push(`edition:${contestEdition}`);
  }
  if (
    contestIsProvincial &&
    boardIsProvincial &&
    contestYear &&
    boardYear &&
    contestYear === boardYear &&
    contestSpecificTags.length > 0 &&
    contestSpecificTags.every((tag) => boardItem.tags.includes(tag))
  ) {
    score += 20;
    reasons.push("provincial_year_specific_tags");
  }
  if (
    contestIsProvincial &&
    boardIsProvincial &&
    contestIsInvitational !== boardIsInvitational &&
    contestYear &&
    boardYear &&
    contestYear === boardYear &&
    contestSeries &&
    boardSeries &&
    contestSeries === boardSeries &&
    hasSpecificTagIntersection
  ) {
    score += 25;
    reasons.push("provincial_invitational_alias");
  }

  if (contestSeries && boardSeries && contestSeries !== boardSeries) {
    score -= 25;
    reasons.push("series_mismatch");
  }
  if (
    contestIsInvitational &&
    boardIsInvitational &&
    contestYear &&
    boardYear &&
    contestYear === boardYear &&
    contestSeries &&
    boardSeries &&
    contestSeries === boardSeries &&
    hasSpecificTagIntersection
  ) {
    score += 25;
    reasons.push("invitational_year_series_specific_tag");
  }

  return {
    score,
    reasons,
  };
}

async function readJsonFromPathOrUrl(pathOrUrl) {
  if (/^https?:\/\//iu.test(pathOrUrl)) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) {
      throw new Error(`${pathOrUrl}: HTTP ${response.status}`);
    }
    return response.json();
  }
  return JSON.parse(await fs.readFile(pathOrUrl, "utf8"));
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

function getPenaltyTimestampDivisor(config) {
  if (config.options?.submission_timestamp_unit === "millisecond") {
    return 60_000;
  }
  if (config.options?.submission_timestamp_unit === "minute") {
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
  const timestampDivisor = getPenaltyTimestampDivisor(config);

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
        teamId: team.id,
      }
    : null;
}

async function fetchAwardCutoffs(match) {
  const boardPath = toBoardPath(match.suggested_source.provider_contest_id ?? match.suggested_source.url);
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
  return {
    contest_id: match.contest_id,
    title: match.title,
    board_path: `/${boardPath}`,
    source_url: match.suggested_source.url,
    source_provider: match.suggested_source.provider,
    source_label: match.suggested_source.label ?? "XCPCIO Board",
    cutoff_source: cutoffRanks.source ?? inferredSource,
    eligible_team_count: rankedTeams.length,
    cutoffs: {
      gold: getCutoff(rankedTeams, cutoffRanks.ranks.gold),
      silver: getCutoff(rankedTeams, cutoffRanks.ranks.silver),
      bronze: getCutoff(rankedTeams, cutoffRanks.ranks.bronze),
    },
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
const boardIndexPathOrUrl = readArg("--board-index", DEFAULT_BOARD_INDEX_URL);
const rawOutputPath = readArg("--raw-output", DEFAULT_RAW_OUTPUT_PATH);
const normalizedPathOrUrl = readArg("--normalized", DEFAULT_NORMALIZED_OUTPUT_PATH);
const normalizedOutputPath = readArg("--normalized-output", DEFAULT_NORMALIZED_OUTPUT_PATH);
const minScore = Number(readArg("--min-score", "80"));
const includeAmbiguous = hasFlag("--include-ambiguous");
const applyMatches = hasFlag("--apply");
const outputPath = readArg("--output", catalogPath);
const applyConfidence = new Set(readArg("--apply-confidence", "high").split(",").map((value) => value.trim()).filter(Boolean));
const fetchCutoffs = hasFlag("--fetch-cutoffs");
const fetchRaw = hasFlag("--fetch-raw");
const normalizeRaw = hasFlag("--normalize");
const cutoffsOutputPath = readArg("--cutoffs-output", DEFAULT_CUTOFFS_OUTPUT_PATH);

const [catalog, boardInput] = await Promise.all([
  readJsonFromPathOrUrl(catalogPath),
  fetchRaw || normalizeRaw
    ? readJsonFromPathOrUrl(boardIndexPathOrUrl)
    : readJsonFromPathOrUrl(normalizedPathOrUrl),
]);
const originalCatalogJson = JSON.stringify(catalog);

if (fetchRaw) {
  await fs.writeFile(rawOutputPath, `${JSON.stringify(boardInput, null, 2)}\n`, "utf8");
}

const boardItems = fetchRaw || normalizeRaw
  ? flattenBoardIndex(boardInput)
  : boardItemsFromNormalizedContests(Array.isArray(boardInput) ? boardInput : boardInput.contests ?? []);

if (fetchRaw || normalizeRaw) {
  await fs.writeFile(normalizedOutputPath, `${JSON.stringify(normalizeBoardItems(boardItems), null, 2)}\n`, "utf8");
}

const matches = [];
const boardItemsByPath = new Map(
  boardItems.map((boardItem) => [toBoardPath(boardItem.board_link ?? boardItem.url), boardItem]),
);

for (const contest of catalog.contests ?? []) {
  const existingBoardSource = (contest.sources ?? []).find((source) => source.provider === "xcpcio_board");
  const existingBoardItem = existingBoardSource
    ? boardItemsByPath.get(toBoardPath(existingBoardSource.provider_contest_id ?? existingBoardSource.url))
    : null;
  if (existingBoardItem) {
    matches.push({
      contest_id: contest.contestId,
      title: contest.title,
      tags: contest.tags ?? [],
      confidence: "high",
      suggested_source: {
        provider: "xcpcio_board",
        kind: "standings",
        url: existingBoardItem.url,
        provider_contest_id: existingBoardItem.board_link,
        source_title: existingBoardItem.title,
        label: "XCPCIO Board",
      },
      candidates: [
        {
          score: 200,
          board_link: existingBoardItem.board_link,
          board_title: existingBoardItem.title,
          board_tags: existingBoardItem.tags,
          reasons: ["existing_source_path"],
        },
      ],
    });
    continue;
  }

  const candidates = boardItems
    .map((boardItem) => {
      const scored = scoreCandidate(contest, boardItem);
      if (!scored || scored.score < minScore) {
        return null;
      }
      return {
        score: scored.score,
        board_link: boardItem.board_link,
        url: boardItem.url,
        board_title: boardItem.title,
        board_tags: boardItem.tags,
        reasons: scored.reasons,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.board_link.localeCompare(right.board_link));

  if (!candidates.length) {
    continue;
  }

  const top = candidates[0];
  const runnerUp = candidates[1] ?? null;
  const ambiguous = runnerUp !== null && top.score - runnerUp.score < 20;
  if (ambiguous && !includeAmbiguous) {
    continue;
  }

  matches.push({
    contest_id: contest.contestId,
    title: contest.title,
    tags: contest.tags ?? [],
    confidence: ambiguous ? "ambiguous" : top.score >= 120 ? "high" : "medium",
    suggested_source: {
      provider: "xcpcio_board",
      kind: "standings",
      url: top.url ?? `https://board.xcpcio.com${top.board_link}`,
      provider_contest_id: top.board_link,
      source_title: top.board_title,
      label: "XCPCIO Board",
    },
    candidates: candidates.slice(0, 3),
  });
}

function getSourceDedupeKey(source) {
  const provider = String(source.provider ?? "").trim();
  const providerContestId = String(source.provider_contest_id ?? "").replace(/^\/+|\/+$/gu, "");
  const url = String(source.url ?? "").trim().replace(/\/$/u, "");
  return `${provider}:${providerContestId || url}`;
}

function isXcpcioBoardSource(source) {
  return source?.provider === "xcpcio_board";
}

let appliedCount = 0;
let skippedByConfidenceCount = 0;
let cutoffCount = 0;
const cutoffRecords = [];
const cutoffErrors = [];

if (fetchCutoffs) {
  for (const match of matches) {
    if (!applyConfidence.has(match.confidence)) {
      continue;
    }
    try {
      cutoffRecords.push(await fetchAwardCutoffs(match));
    } catch (error) {
      cutoffErrors.push({
        contest_id: match.contest_id,
        title: match.title,
        board_path: match.suggested_source.provider_contest_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  cutoffCount = cutoffRecords.length;
  await fs.writeFile(cutoffsOutputPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    board_index: fetchRaw || normalizeRaw ? boardIndexPathOrUrl : normalizedPathOrUrl,
    raw_output_path: fetchRaw ? rawOutputPath : null,
    normalized_output_path: fetchRaw || normalizeRaw ? normalizedOutputPath : null,
    source_provider: "xcpcio_board",
    match_count: matches.length,
    cutoff_count: cutoffRecords.length,
    error_count: cutoffErrors.length,
    cutoffs: cutoffRecords,
    errors: cutoffErrors,
  }, null, 2)}\n`, "utf8");
}

if (applyMatches) {
  const matchesByContestId = new Map(matches.map((match) => [match.contest_id, match]));
  const cutoffsByContestId = new Map(cutoffRecords.map((cutoffRecord) => [cutoffRecord.contest_id, cutoffRecord]));
  for (const contest of catalog.contests ?? []) {
    const existingSources = contest.sources ?? [];
    const nextSources = existingSources.filter((source) => !isXcpcioBoardSource(source));
    if (nextSources.length !== existingSources.length) {
      contest.sources = nextSources;
    }
    if (contest.awardCutoffs?.sourceProvider === "xcpcio_board") {
      delete contest.awardCutoffs;
    }

    const match = matchesByContestId.get(contest.contestId);
    if (!match) {
      continue;
    }
    if (!applyConfidence.has(match.confidence)) {
      skippedByConfidenceCount += 1;
      continue;
    }
    const cutoffRecord = cutoffsByContestId.get(contest.contestId);
    if (cutoffRecord) {
      contest.awardCutoffs = toCatalogAwardCutoffs(cutoffRecord);
    }
    const sources = contest.sources ?? [];
    const existingKeys = new Set(sources.map(getSourceDedupeKey));
    const nextSource = match.suggested_source;
    const nextKey = getSourceDedupeKey(nextSource);
    if (existingKeys.has(nextKey)) {
      continue;
    }
    contest.sources = [...sources, nextSource];
    appliedCount += 1;
  }
}

const catalogChanged = JSON.stringify(catalog) !== originalCatalogJson;
if (catalogChanged) {
  catalog.exportedAt = new Date().toISOString();
}
if (applyMatches && (catalogChanged || outputPath !== catalogPath)) {
  await fs.writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  catalog_path: catalogPath,
  board_index: boardIndexPathOrUrl,
  normalized: fetchRaw || normalizeRaw ? normalizedOutputPath : normalizedPathOrUrl,
  fetched_raw: fetchRaw,
  normalized_raw: fetchRaw || normalizeRaw,
  raw_output_path: fetchRaw ? rawOutputPath : null,
  normalized_output_path: fetchRaw || normalizeRaw ? normalizedOutputPath : null,
  min_score: minScore,
  applied: applyMatches,
  output_path: applyMatches ? outputPath : null,
  catalog_changed: catalogChanged,
  apply_confidence: applyMatches ? [...applyConfidence] : null,
  applied_count: appliedCount,
  skipped_by_confidence_count: skippedByConfidenceCount,
  fetched_cutoffs: fetchCutoffs,
  cutoffs_output_path: fetchCutoffs ? cutoffsOutputPath : null,
  cutoff_count: cutoffCount,
  cutoff_error_count: cutoffErrors.length,
  contest_count: catalog.contests?.length ?? 0,
  board_contest_count: boardItems.length,
  match_count: matches.length,
  matches,
}, null, 2));

if (fetchCutoffs && cutoffErrors.length > 0) {
  process.exitCode = 1;
}
