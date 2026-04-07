#!/usr/bin/env node

import fs from "node:fs/promises";

const DEFAULT_CATALOG_PATH = "catalog/default-catalog.min.json";
const DEFAULT_BOARD_INDEX_URL = "https://board.xcpcio.com/data/index/contest_list.json";

const genericTags = new Set(["icpc", "ccpc", "省赛", "区域赛", "邀请赛", "总决赛", "网络赛", "热身赛", "多省"]);
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
  ["华南", /华南|south china/iu],
  ["四川", /四川|sichuan/iu],
  ["江苏", /江苏|jiangsu/iu],
  ["浙江", /浙江|zhejiang/iu],
  ["山东", /山东|shandong/iu],
  ["湖南", /湖南|hunan/iu],
  ["湖北", /湖北|hubei/iu],
  ["江西", /江西|jiangxi/iu],
  ["吉林", /吉林|jilin/iu],
  ["辽宁", /辽宁|liaoning/iu],
  ["广东", /广东|guangdong/iu],
  ["河北", /河北|hebei/iu],
  ["河南", /河南|henan/iu],
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

function getYearFromTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const milliseconds = timestamp > 1e12 ? timestamp : timestamp * 1000;
  return String(new Date(milliseconds).getUTCFullYear());
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferBoardTags(item) {
  const title = String(item.config?.contest_name ?? "");
  const link = String(item.board_link ?? "");
  const haystack = `${title} ${link}`;
  const tags = [];
  const year = getYearFromText(title) ?? getYearFromTimestamp(item.config?.start_time);
  if (year) tags.push(year);
  if (/icpc/iu.test(haystack) || link.includes("/icpc/")) tags.push("icpc");
  if (/ccpc/iu.test(haystack) || link.includes("/ccpc/")) tags.push("ccpc");
  if (/provincial-contest/iu.test(link) || /省/iu.test(title)) tags.push("省赛");
  if (/regional|区域/iu.test(title)) tags.push("区域赛");
  if (/invitational|邀请/iu.test(title)) tags.push("邀请赛");
  if (/final|总决赛/iu.test(title)) tags.push("总决赛");
  if (/online|网络/iu.test(haystack)) tags.push("网络赛");
  if (/warmup|warm-up|practice|热身|练习/iu.test(haystack)) tags.push("热身赛");
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
      items.push({
        board_link: value.board_link,
        title,
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
  const contestYear = contestTags.find((tag) => /^(?:19|20)\d{2}$/u.test(tag)) ?? getYearFromText(contest.title);
  const boardYear = boardItem.tags.find((tag) => /^(?:19|20)\d{2}$/u.test(tag));
  const contestIsWarmup = contestTags.includes("热身赛") || /warm ?up|practice|热身|练习/iu.test(contest.title);
  const boardIsWarmup = boardItem.tags.includes("热身赛");
  const contestIsOnline = contestTags.includes("网络赛") || /online|网络/iu.test(contest.title);
  const boardIsOnline = boardItem.tags.includes("网络赛");

  if (contestIsWarmup !== boardIsWarmup) {
    return null;
  }
  if (contestIsOnline !== boardIsOnline && (contestIsOnline || boardIsOnline)) {
    return null;
  }

  let score = titleOverlapScore(normalizeTitle(contest.title), boardItem.normalizedTitle);
  const reasons = [];
  if (score > 0) {
    reasons.push(`title:${score}`);
  }
  const contestSpecificTags = contestTags.filter((tag) => !genericTags.has(tag) && !/^(?:19|20)\d{2}$/u.test(tag));
  const hasSpecificTagIntersection = contestSpecificTags.some((tag) => boardItem.tags.includes(tag));
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

  const contestSeries = contestTags.find((tag) => tag === "icpc" || tag === "ccpc");
  const boardSeries = boardItem.tags.find((tag) => tag === "icpc" || tag === "ccpc");
  if (contestSeries && boardSeries && contestSeries !== boardSeries) {
    score -= 25;
    reasons.push("series_mismatch");
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

const catalogPath = readArg("--catalog", DEFAULT_CATALOG_PATH);
const boardIndexPathOrUrl = readArg("--board-index", DEFAULT_BOARD_INDEX_URL);
const minScore = Number(readArg("--min-score", "80"));
const includeAmbiguous = hasFlag("--include-ambiguous");

const [catalog, boardIndex] = await Promise.all([
  readJsonFromPathOrUrl(catalogPath),
  readJsonFromPathOrUrl(boardIndexPathOrUrl),
]);
const boardItems = flattenBoardIndex(boardIndex);
const matches = [];

for (const contest of catalog.contests ?? []) {
  const candidates = boardItems
    .map((boardItem) => {
      const scored = scoreCandidate(contest, boardItem);
      if (!scored || scored.score < minScore) {
        return null;
      }
      return {
        score: scored.score,
        board_link: boardItem.board_link,
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
      url: `https://board.xcpcio.com${top.board_link}`,
      provider_contest_id: top.board_link,
      source_title: top.board_title,
      label: "XCPCIO Board",
    },
    candidates: candidates.slice(0, 3),
  });
}

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  catalog_path: catalogPath,
  board_index: boardIndexPathOrUrl,
  min_score: minScore,
  contest_count: catalog.contests?.length ?? 0,
  board_contest_count: boardItems.length,
  match_count: matches.length,
  matches,
}, null, 2));
