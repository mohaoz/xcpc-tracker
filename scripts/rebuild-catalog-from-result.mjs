import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "data", "final.json");
const DEFAULT_OUTPUT_PATH = resolve(repoRoot, "fixtures", "imports", "qoj", "result-rebuilt.catalog.json");
const PACKAGE_JSON_PATH = resolve(repoRoot, "package.json");

const CITY_TAGS = [
  ["北京", /Beijing|北京/iu],
  ["上海", /Shanghai|上海/iu],
  ["广州", /Guangzhou|广州/iu],
  ["深圳", /Shenzhen|深圳/iu],
  ["青岛", /Qingdao|青岛/iu],
  ["济南", /Jinan|济南/iu],
  ["威海", /Weihai|威海/iu],
  ["武汉", /Wuhan|武汉/iu],
  ["湘潭", /Xiangtan|湘潭/iu],
  ["哈尔滨", /Harbin|哈尔滨/iu],
  ["南昌", /Nanchang|南昌/iu],
  ["秦皇岛", /Qinhuangdao|秦皇岛/iu],
  ["南宁", /Nanning|南宁/iu],
  ["牡丹江", /Mudanjiang|牡丹江/iu],
  ["沈阳", /Shenyang|沈阳/iu],
  ["大连", /Dalian|大连/iu],
  ["成都", /Chengdu|成都/iu],
  ["绵阳", /Mianyang|绵阳/iu],
  ["徐州", /Xuzhou|徐州/iu],
  ["西安", /\bXi'?an\b|\bXian\b|西安/iu],
  ["乌鲁木齐", /Urumqi|Ürümqi|乌鲁木齐/iu],
  ["长春", /Changchun|长春/iu],
  ["焦作", /Jiaozuo|焦作/iu],
  ["郑州", /Zhengzhou|郑州/iu],
  ["厦门", /Xiamen|厦门/iu],
  ["重庆", /Chongqing|重庆/iu],
  ["南京", /Nanjing|南京/iu],
  ["杭州", /Hangzhou|杭州/iu],
  ["澳门", /Macau|澳门/iu],
  ["银川", /Yinchuan|银川/iu],
  ["合肥", /Hefei|合肥/iu],
  ["香港", /Hong Kong|香港/iu],
  ["昆明", /Kunming|昆明/iu],
  ["桂林", /Guilin|桂林/iu],
];

const PROVINCE_TAGS = [
  ["北京", /Beijing|北京/iu],
  ["上海", /Shanghai|上海/iu],
  ["天津", /Tianjin|天津/iu],
  ["江苏", /Jiangsu|江苏/iu],
  ["浙江", /Zhejiang|浙江/iu],
  ["广东", /Guangdong|广东/iu],
  ["山东", /Shandong|山东/iu],
  ["湖北", /Hubei|湖北/iu],
  ["湖南", /Hunan|湖南/iu],
  ["黑龙江", /Heilongjiang|黑龙江/iu],
  ["江西", /Jiangxi|江西/iu],
  ["河北", /Hebei|河北/iu],
  ["辽宁", /Liaoning|辽宁/iu],
  ["四川", /Sichuan|四川/iu],
  ["陕西", /Shaanxi|陕西/iu],
  ["新疆", /Xinjiang|新疆/iu],
  ["吉林", /Jilin|吉林/iu],
  ["河南", /Henan|河南/iu],
  ["福建", /Fujian|福建/iu],
  ["重庆", /Chongqing|重庆/iu],
  ["澳门", /Macau|澳门/iu],
  ["香港", /Hong Kong|香港/iu],
];

const REGION_TAGS = [
  ["东北", /Northeast|东北/iu],
];

const MUNICIPALITY_PROVINCIAL_RE =
  /(?:BJCPC|SHCPC|TJCPC|CQCPC|北京市大学生程序设计竞赛|上海市大学生程序设计竞赛|天津市大学生程序设计竞赛|重庆市大学生程序设计竞赛)/iu;

const PROVINCIAL_CONTEST_KIND_RE = /(?:Collegiate Programming Contest|Programming Contest|大学生程序设计竞赛|程序设计竞赛)/iu;

const MANUAL_YEAR_BY_TITLE = new Map([
  ["The 1st Universal Cup. Stage 15: Hangzhou", "2023"],
  ["The 9th CCPC (Harbin) Onsite(The 2nd Universal Cup. Stage 10: Harbin)", "2023"],
  ["The 10th Shandong Provincial Collegiate Programming Contest", "2023"],
  ["The 13th Shaanxi Provincial Collegiate Programming Contest", "2025"],
  ["The 13th Shandong ICPC Provincial Collegiate Programming Contest", "2025"],
  ["The 13th Xiangtan Collegiate Programming Contest", "2023"],
  ["The 14th Jilin Provincial Collegiate Programming Contest", "2020"],
  ["The 14th Zhejiang Provincial Collegiate Programming Contest Sponsored by TuSimple", "2017"],
  ["The 15th Shandong CCPC Provincial Collegiate Programming Contest", "2025"],
  ["The 17th Jilin Provincial Collegiate Programming Contest", "2024"],
  ["The 17th Zhejiang Provincial Collegiate Programming Contest", "2020"],
  ["The 18th Zhejiang Provincial Collegiate Programming Contest", "2021"],
  ["The 19th Zhejiang Provincial Collegiate Programming Contest", "2022"],
  ["第十三届重庆市大学生程序设计竞赛", "2025"],
]);

const MANUAL_YEAR_BY_PROVIDER_CONTEST_ID = new Map([
  ["102800", "2020"],
  ["102770", "2020"],
  ["103055", "2021"],
  ["103687", "2022"],
  ["104417", "2025"],
  ["104459", "2023"],
  ["104461", "2017"],
  ["104813", "2023"],
  ["105887", "2025"],
  ["105891", "2025"],
  ["105930", "2025"],
]);

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function createDeterministicUuid(seed) {
  const hash = createHash("sha1").update(`xcpc-tracker:result-rebuild:${seed}`).digest("hex");
  const part1 = hash.slice(0, 8);
  const part2 = hash.slice(8, 12);
  const part3 = `5${hash.slice(13, 16)}`;
  const variantNibble = (parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8;
  const part4 = `${variantNibble.toString(16)}${hash.slice(17, 20)}`;
  const part5 = hash.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

function normalizeYearInferenceTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\(([^)]*)\)/gu, (_, inner) => {
      return /\b(19|20)\d{2}\b/u.test(inner) || /ccpc|icpc|省赛|邀请赛|国邀/iu.test(inner) ? " " : ` ${inner} `;
    })
    .replace(/（([^）]*)）/gu, (_, inner) => {
      return /\b(19|20)\d{2}\b/u.test(inner) || /ccpc|icpc|省赛|邀请赛|国邀/iu.test(inner) ? " " : ` ${inner} `;
    })
    .replace(/\b(19|20)\d{2}\b/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferProvider(url) {
  const value = String(url ?? "").trim();
  if (/codeforces\.com/iu.test(value)) {
    return "codeforces";
  }
  if (/qoj\.ac/iu.test(value)) {
    return "qoj";
  }
  return "manual";
}

function inferProviderContestId(url) {
  const value = String(url ?? "").trim();
  return (
    value.match(/codeforces\.com\/gym\/(\d+)/iu)?.[1] ??
    value.match(/qoj\.ac\/contest\/([^/?#]+)/iu)?.[1] ??
    undefined
  );
}

function inferSourceLabel(provider) {
  if (provider === "codeforces") return "Codeforces Gym";
  if (provider === "qoj") return "QOJ contest";
  return "Imported contest";
}

function inferManualYear(title, url) {
  const exactTitle = String(title ?? "").trim();
  if (MANUAL_YEAR_BY_TITLE.has(exactTitle)) {
    return MANUAL_YEAR_BY_TITLE.get(exactTitle);
  }
  const providerContestId = inferProviderContestId(url);
  if (providerContestId && MANUAL_YEAR_BY_PROVIDER_CONTEST_ID.has(providerContestId)) {
    return MANUAL_YEAR_BY_PROVIDER_CONTEST_ID.get(providerContestId);
  }
  return null;
}

function matchesAnyTagPattern(value, tags) {
  return tags.some(([, pattern]) => pattern.test(value));
}

function inferIcpcOnlineStageTag(value) {
  if (/\((?:I|1)\)/iu.test(value) || /\bPhase\s*1\b/iu.test(value)) {
    return "第一场";
  }
  if (/\((?:II|2)\)/iu.test(value) || /\bPhase\s*2\b/iu.test(value)) {
    return "第二场";
  }
  return null;
}

function inferContestTags(title) {
  const tags = [];
  const value = String(title ?? "").trim();
  const isRegional = /Regional|站|Onsite/iu.test(value);
  const isRegionalOnlineAlias =
    isRegional &&
    /Online|网络/iu.test(value) &&
    !/EC Regionals Online|East Continent Online|CCPC Online|Qualification Round/iu.test(value);
  const isOnline = /Online|网络/iu.test(value) && !isRegionalOnlineAlias;
  const isCcpc = /\bCCPC\b|中国大学生程序设计竞赛|China Collegiate Programming Contest/iu.test(value);
  const isIcpc = /ICPC|ACM-ICPC/iu.test(value);
  const isProvincial =
    /Provincial|省赛|省程序设计竞赛|省大学生程序设计竞赛|省大学生竞赛|Multi-Provincial|多省/iu.test(value) ||
    /Province/iu.test(value) ||
    MUNICIPALITY_PROVINCIAL_RE.test(value) ||
    ((matchesAnyTagPattern(value, PROVINCE_TAGS) || matchesAnyTagPattern(value, REGION_TAGS)) &&
      PROVINCIAL_CONTEST_KIND_RE.test(value) &&
      !isRegional);
  const isInvitational = /Invitational|邀请赛|国邀/iu.test(value);
  const year = value.match(/\b(19|20)\d{2}\b/u)?.[0];
  if (year) tags.push(year);
  if (isOnline) {
    if (isIcpc) {
      tags.push("icpc");
      const stageTag = inferIcpcOnlineStageTag(value);
      if (stageTag) {
        tags.push(stageTag);
      }
    } else if (isCcpc) {
      tags.push("ccpc");
    }
    tags.push("网络赛");
    return dedupeStrings(tags);
  }
  if (isCcpc) tags.push("ccpc");
  if (isIcpc) tags.push("icpc");
  if (/East Continent|EC-Final|China-Final|ECL-Final/iu.test(value)) tags.push("ec");
  if (isRegional) tags.push("区域赛");
  if (isProvincial) {
    tags.push("省赛");
  }
  if (isInvitational) tags.push("邀请赛");
  if (/Warm ?up|Practice|热身赛|练习赛/iu.test(value)) tags.push("热身赛");
  if (/Final|总决赛/iu.test(value)) tags.push("总决赛");
  if (/Women|Female|女生/iu.test(value)) tags.push("女生专场");
  if (/Vocational|高职/iu.test(value)) tags.push("高职专场");

  if (isRegional) {
    for (const [tag, pattern] of CITY_TAGS) {
      if (pattern.test(value)) tags.push(tag);
    }
    return dedupeStrings(tags);
  }

  if (isProvincial) {
    if (isInvitational) {
      for (const [tag, pattern] of CITY_TAGS) {
        if (pattern.test(value)) tags.push(tag);
      }
    }
    for (const [tag, pattern] of REGION_TAGS) {
      if (pattern.test(value)) tags.push(tag);
    }
    for (const [tag, pattern] of PROVINCE_TAGS) {
      if (pattern.test(value)) tags.push(tag);
    }
    return dedupeStrings(tags);
  }

  for (const [tag, pattern] of CITY_TAGS) {
    if (pattern.test(value)) tags.push(tag);
  }
  const hasCityTag = tags.some((tag) => CITY_TAGS.some(([cityTag]) => cityTag === tag));
  if (!hasCityTag) {
    for (const [tag, pattern] of REGION_TAGS) {
      if (pattern.test(value)) tags.push(tag);
    }
  }
  const hasRegionTag = tags.some((tag) => REGION_TAGS.some(([regionTag]) => regionTag === tag));
  if (!hasCityTag && !hasRegionTag) {
    for (const [tag, pattern] of PROVINCE_TAGS) {
      if (pattern.test(value)) tags.push(tag);
    }
  }
  return dedupeStrings(tags);
}

function buildInferredYearByTitle(entries) {
  const yearsByNorm = new Map();
  for (const entry of entries) {
    const title = String(entry?.title ?? "").trim();
    const normalized = normalizeYearInferenceTitle(title);
    if (!normalized) {
      continue;
    }
    const year = title.match(/\b(19|20)\d{2}\b/u)?.[0];
    if (!year) {
      continue;
    }
    const bucket = yearsByNorm.get(normalized) ?? new Set();
    bucket.add(year);
    yearsByNorm.set(normalized, bucket);
  }

  const inferredYearByNorm = new Map();
  for (const [normalized, years] of yearsByNorm) {
    if (years.size === 1) {
      inferredYearByNorm.set(normalized, [...years][0]);
    }
  }
  return inferredYearByNorm;
}

function buildInferredSeriesTagsByTitle(entries) {
  const tagsByNorm = new Map();
  for (const entry of entries) {
    const title = String(entry?.title ?? "").trim();
    const normalized = normalizeYearInferenceTitle(title);
    if (!normalized) {
      continue;
    }
    const bucket = tagsByNorm.get(normalized) ?? new Set();
    const titleTags = inferContestTags(title);
    if (titleTags.includes("ccpc")) {
      bucket.add("ccpc");
    }
    if (titleTags.includes("icpc")) {
      bucket.add("icpc");
    }
    tagsByNorm.set(normalized, bucket);
  }
  return tagsByNorm;
}

function normalizeInputEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.contests)) return raw.contests;
  throw new Error("input JSON must be an array or an object with a contests array");
}

function compareByTitle(left, right) {
  return String(left.title ?? "").localeCompare(String(right.title ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

async function main() {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT_PATH;
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT_PATH;
  const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8"));
  const bundleVersion = typeof packageJson.version === "string" ? packageJson.version : undefined;
  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  const entries = normalizeInputEntries(raw);
  const inferredYearByTitle = buildInferredYearByTitle(entries);
  const inferredSeriesTagsByTitle = buildInferredSeriesTagsByTitle(entries);

  const seen = new Set();
  const contests = [];

  for (const entry of entries) {
    const title = String(entry?.title ?? "").trim();
    const url = String(entry?.url ?? "").trim();
    if (!title || !url) {
      continue;
    }

    const dedupeKey = `${title.toLowerCase()}@@${url.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const provider = inferProvider(url);
    const providerContestId = inferProviderContestId(url);
    const source = {
      provider,
      kind: "contest",
      url,
      ...(providerContestId ? { provider_contest_id: providerContestId } : {}),
      source_title: title,
      label: inferSourceLabel(provider),
    };
    const contestKey = `${provider}:${providerContestId ?? url}:${title}`;
    const inferredYear = title.match(/\b(19|20)\d{2}\b/u)?.[0]
      ? null
      : inferManualYear(title, url) ??
        inferredYearByTitle.get(normalizeYearInferenceTitle(title)) ??
        null;
    const inferredSeriesTags = [...(inferredSeriesTagsByTitle.get(normalizeYearInferenceTitle(title)) ?? new Set())];
    const tags = dedupeStrings([
      ...inferContestTags(title),
      ...(inferredYear ? [inferredYear] : []),
      ...inferredSeriesTags,
    ]);
    contests.push({
      contestId: createDeterministicUuid(contestKey),
      title,
      aliases: [],
      tags,
      startAt: null,
      curationStatus: "contest_stub",
      problemIds: [],
      sources: [source],
      notes: null,
      generatedFrom: "catalog",
      deletedAt: null,
    });
  }
  contests.sort(compareByTitle);

  const output = {
    schemaVersion: 1,
    exportKind: "local_catalog_snapshot",
    version: bundleVersion,
    exportedAt: new Date().toISOString(),
    contests,
    problems: [],
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        inputPath,
        outputPath,
        contestCount: contests.length,
        problemCount: 0,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
