import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "Contests - QOJ.ac.mht");
const DEFAULT_OUTPUT_PATH = resolve(repoRoot, "fixtures/imports/qoj/qoj-contests-from-mht-catalog-draft.json");
const DEFAULT_CATALOG_OUTPUT_PATH = resolve(repoRoot, "catalog/default-catalog.min.json");

const CHINA_LOCATION_TOKENS = [
  "Beijing",
  "北京",
  "Shanghai",
  "上海",
  "Jiangsu",
  "江苏",
  "Guangdong",
  "广东",
  "Shandong",
  "山东",
  "Hubei",
  "湖北",
  "Hunan",
  "湖南",
  "Heilongjiang",
  "黑龙江",
  "Jiangxi",
  "江西",
  "Hebei",
  "河北",
  "Liaoning",
  "辽宁",
  "Sichuan",
  "四川",
  "Shaanxi",
  "陕西",
  "Xinjiang",
  "新疆",
  "Jilin",
  "吉林",
  "Henan",
  "河南",
  "Fujian",
  "福建",
  "Xiangtan",
  "湘潭",
  "Northeast",
  "东北",
  "Wuhan",
  "武汉",
  "Kunming",
  "昆明",
  "Xi'an",
  "Xian",
  "西安",
  "Nanchang",
  "南昌",
  "Harbin",
  "哈尔滨",
  "Mianyang",
  "绵阳",
  "Guilin",
  "桂林",
  "Weihai",
  "威海",
  "Qinhuangdao",
  "秦皇岛",
  "Changchun",
  "长春",
  "Chongqing",
  "重庆",
  "Zhengzhou",
  "郑州",
  "Shenzhen",
  "深圳",
  "Guangzhou",
  "广州",
  "Xiamen",
  "厦门",
  "Hangzhou",
  "杭州",
  "Jinan",
  "济南",
  "Qingdao",
  "青岛",
  "Macau",
  "澳门",
  "Yinchuan",
  "银川",
  "Hefei",
  "合肥",
  "Nanjing",
  "南京",
  "Shenyang",
  "沈阳",
  "Hong Kong",
  "香港",
  "Urumqi",
  "Ürümqi",
  "乌鲁木齐",
  "Jiaozuo",
  "焦作",
  "Nanning",
  "南宁",
  "Chengdu",
  "成都",
];

const CHINA_LOCATION_REGEX = new RegExp(`(?:${CHINA_LOCATION_TOKENS.join("|")})`, "iu");
const XCPC_EXCLUDE_PATTERNS = [
  /North America/iu,
  /USA/iu,
  /Europe/iu,
  /NWERC/iu,
  /SWERC/iu,
  /SEERC/iu,
  /CERC/iu,
  /Moscow/iu,
  /Russia/iu,
  /Tokyo/iu,
  /Tsukuba/iu,
  /Ehime/iu,
  /Taipei-Hsinchu/iu,
  /Manila/iu,
  /Jakarta/iu,
  /Seoul/iu,
  /Yokohama/iu,
  /Taichung/iu,
  /Taoyuan/iu,
  /Tehran/iu,
  /Daejeon/iu,
  /Pyongyang/iu,
  /Aizu/iu,
  /German Collegiate/iu,
  /Polish Collegiate/iu,
  /Nordic Collegiate/iu,
  /Arab Collegiate/iu,
  /NCPC/iu,
  /AMPPZ/iu,
  /GDKOI/iu,
  /重点中学/iu,
  /省队选拔赛/iu,
  /代表队选拔赛/iu,
  /NOI/iu,
  /NOIP/iu,
  /CTSC/iu,
  /THUPC/iu,
  /THOI/iu,
  /JOI/iu,
  /IOI/iu,
  /USACO/iu,
  /Cfz/iu,
  /Universal Cup/iu,
  /Open Cup/iu,
  /Petrozavodsk/iu,
  /Practice Contest/iu,
  /Voluntary/iu,
  /Camp/iu,
];

function createDeterministicUuid(seed) {
  const hash = createHash("sha1").update(`xcpc-tracker:qoj-mht:${seed}`).digest("hex");
  const part1 = hash.slice(0, 8);
  const part2 = hash.slice(8, 12);
  const part3 = `5${hash.slice(13, 16)}`;
  const variantNibble = (parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8;
  const part4 = `${variantNibble.toString(16)}${hash.slice(17, 20)}`;
  const part5 = hash.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function stripTags(input) {
  return decodeHtmlEntities(input.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim());
}

function normalizeStartAt(value) {
  const normalized = value.trim();
  if (!normalized || normalized === "-" || normalized === "Not set") {
    return null;
  }
  return normalized;
}

function normalizeDuration(value) {
  const normalized = value.trim();
  if (!normalized || normalized === "-") {
    return null;
  }
  return normalized;
}

function extractHtmlFromMht(mht) {
  const marker = "Content-Location: https://qoj.ac/contests";
  const start = mht.indexOf(marker);
  if (start === -1) {
    throw new Error("Could not find qoj contests HTML part in MHT");
  }

  const htmlStart = mht.indexOf("<!DOCTYPE html>", start);
  if (htmlStart === -1) {
    throw new Error("Could not locate HTML payload in MHT");
  }

  const boundaryIndex = mht.indexOf("\n------MultipartBoundary", htmlStart);
  if (boundaryIndex === -1) {
    throw new Error("Could not locate end of HTML payload in MHT");
  }

  return mht.slice(htmlStart, boundaryIndex).replace(/\r\n/gu, "\n");
}

function parseContestRows(html) {
  const rows = [...html.matchAll(/<tr class="table-default">([\s\S]*?)<\/tr>/gu)];
  const contests = [];

  for (const rowMatch of rows) {
    const cells = [...rowMatch[1].matchAll(/<td>([\s\S]*?)<\/td>/gu)].map((match) => match[1]);
    if (cells.length < 4) {
      continue;
    }

    const nameCell = cells[0];
    const startAt = normalizeStartAt(stripTags(cells[1]));
    const duration = normalizeDuration(stripTags(cells[2]));
    const anchorMatches = [...nameCell.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gu)];

    for (const anchorMatch of anchorMatches) {
      const href = decodeHtmlEntities(anchorMatch[1]);
      const title = stripTags(anchorMatch[2]);

      if (!href.includes("/contest/")) {
        continue;
      }
      if (href.endsWith("/register")) {
        continue;
      }
      if (title === "pending final test" || title === "register") {
        continue;
      }

      const providerContestId = href
        .replace(/^https?:\/\/qoj\.ac\/contest\//u, "")
        .replace(/^\/contest\//u, "");

      contests.push({
        title,
        href,
        providerContestId,
        startAt,
        duration,
      });
    }
  }

  return contests;
}

function isXcpcContestTitle(title) {
  if (XCPC_EXCLUDE_PATTERNS.some((pattern) => pattern.test(title))) {
    return false;
  }

  if (/\bCCPC\b/iu.test(title) || /中国大学生程序设计竞赛/iu.test(title)) {
    return true;
  }

  if (/ICPC Asia/iu.test(title) || /ACM-ICPC, Asia/iu.test(title)) {
    return CHINA_LOCATION_REGEX.test(title) || /East Continent|EC[- ]?Final|China-Final|ECL-Final/iu.test(title);
  }

  if (/Asia East Continent|EC[- ]?Final|EC Regionals Online|East Continent Online Contest|China-Final|ECL-Final/iu.test(title)) {
    return true;
  }

  if (/Asia Pacific Championship/iu.test(title)) {
    return true;
  }

  if (
    CHINA_LOCATION_REGEX.test(title) &&
    (/Collegiate Programming Contest/iu.test(title) ||
      /Provincial .*Programming Contest/iu.test(title) ||
      /大学生程序设计竞赛/iu.test(title) ||
      /省赛/iu.test(title) ||
      /邀请赛/iu.test(title) ||
      /国邀/iu.test(title) ||
      /National Invitational/iu.test(title))
  ) {
    return true;
  }

  if (/Northeast Collegiate Programming Contest/iu.test(title)) {
    return true;
  }

  return false;
}

function buildBundle(contests, exportedAt, mode) {
  const isCatalog = mode === "catalog";

  return {
    schemaVersion: 1,
    exportKind: "local_catalog_snapshot",
    exportedAt,
    contests: contests.map((contest) => {
      const contestId = createDeterministicUuid(`${contest.providerContestId}:${contest.title}`);
      const notes = [
        isCatalog
          ? "Seeded from a locally saved QOJ contests .mht page and promoted into the bundled catalog."
          : "Extracted from a locally saved QOJ contests .mht page.",
        isCatalog ? null : "This is a draft catalog candidate, not canonical curated data.",
        contest.duration ? `Visible duration on contests page: ${contest.duration}.` : null,
      ]
        .filter(Boolean)
        .join(" ");

      return {
        contestId,
        title: contest.title,
        aliases: [],
        tags: isCatalog ? ["qoj"] : ["qoj", "draft_import"],
        startAt: contest.startAt,
        curationStatus: "contest_stub",
        problemIds: [],
        sources: [
          {
            provider: "qoj",
            kind: "contest",
            url: contest.href,
            provider_contest_id: contest.providerContestId,
            source_title: contest.title,
            label: "QOJ contest",
          },
        ],
        notes,
        generatedFrom: isCatalog ? "catalog" : "qoj_mht_extract",
      };
    }),
    problems: [],
  };
}

async function main() {
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
  const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="));
  const mode = modeArg ? modeArg.slice("--mode=".length) : "draft";
  const scope = scopeArg ? scopeArg.slice("--scope=".length) : "all";
  const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--mode=") && !arg.startsWith("--scope="));
  const inputPath = positionalArgs[0] ? resolve(positionalArgs[0]) : DEFAULT_INPUT_PATH;
  const outputPath = positionalArgs[1]
    ? resolve(positionalArgs[1])
    : mode === "catalog"
      ? DEFAULT_CATALOG_OUTPUT_PATH
      : DEFAULT_OUTPUT_PATH;
  const raw = await readFile(inputPath, "utf8");
  const html = extractHtmlFromMht(raw);
  const contests = parseContestRows(html).filter((contest) => (scope === "xcpc" ? isXcpcContestTitle(contest.title) : true));
  const bundle = buildBundle(contests, new Date().toISOString(), mode);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
        {
          mode,
          scope,
          inputPath,
          outputPath,
          contestCount: contests.length,
        firstContest: contests[0] ?? null,
        lastContest: contests.at(-1) ?? null,
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
