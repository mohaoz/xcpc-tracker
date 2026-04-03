import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = resolve(repoRoot, "a.json");
const DEFAULT_OUTPUT_PATH = resolve(repoRoot, "fixtures/imports/qoj/qoj-browser-export.catalog.json");

const LOCATION_TAGS = [
  ["北京", /Beijing|北京/iu],
  ["上海", /Shanghai|上海/iu],
  ["江苏", /Jiangsu|江苏/iu],
  ["广东", /Guangdong|广东|Guangzhou|广州|Shenzhen|深圳/iu],
  ["山东", /Shandong|山东|Qingdao|青岛|Jinan|济南|Weihai|威海/iu],
  ["湖北", /Hubei|湖北|Wuhan|武汉/iu],
  ["湖南", /Hunan|湖南|Xiangtan|湘潭/iu],
  ["黑龙江", /Heilongjiang|黑龙江|Harbin|哈尔滨/iu],
  ["江西", /Jiangxi|江西|Nanchang|南昌/iu],
  ["河北", /Hebei|河北|Qinhuangdao|秦皇岛/iu],
  ["辽宁", /Liaoning|辽宁|Shenyang|沈阳|Dalian|大连/iu],
  ["四川", /Sichuan|四川|Chengdu|成都|Mianyang|绵阳/iu],
  ["陕西", /Shaanxi|陕西|Xi'?an|Xian|西安/iu],
  ["新疆", /Xinjiang|新疆|Urumqi|Ürümqi|乌鲁木齐/iu],
  ["吉林", /Jilin|吉林|Changchun|长春/iu],
  ["河南", /Henan|河南|Zhengzhou|郑州/iu],
  ["福建", /Fujian|福建|Xiamen|厦门/iu],
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

function createDeterministicUuid(seed) {
  const hash = createHash("sha1").update(`xcpc-tracker:qoj-browser-export:${seed}`).digest("hex");
  const part1 = hash.slice(0, 8);
  const part2 = hash.slice(8, 12);
  const part3 = `5${hash.slice(13, 16)}`;
  const variantNibble = (parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8;
  const part4 = `${variantNibble.toString(16)}${hash.slice(17, 20)}`;
  const part5 = hash.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function inferContestTags(title) {
  const tags = [];
  const year = title.match(/\b(19|20)\d{2}\b/u)?.[0];
  if (year) {
    tags.push(year);
  }
  if (/\bCCPC\b|中国大学生程序设计竞赛/iu.test(title)) {
    tags.push("ccpc");
  }
  if (/ICPC|ACM-ICPC/iu.test(title)) {
    tags.push("icpc");
  }
  if (/East Continent|EC-Final|China-Final|ECL-Final/iu.test(title)) {
    tags.push("ec");
  }
  if (/Regional|站|Onsite/iu.test(title)) {
    tags.push("区域赛");
  }
  if (/Provincial|省赛|Collegiate Programming Contest|大学生程序设计竞赛/iu.test(title)) {
    tags.push("省赛");
  }
  if (/National Invitational|邀请赛|国邀/iu.test(title)) {
    tags.push("邀请赛");
  }
  if (/Warm ?up|Practice|热身赛|练习赛/iu.test(title)) {
    tags.push("热身赛");
  }
  if (/Final|总决赛/iu.test(title)) {
    tags.push("总决赛");
  }
  if (/Women|Female|女生/iu.test(title)) {
    tags.push("女生专场");
  }
  if (/Vocational|高职/iu.test(title)) {
    tags.push("高职专场");
  }
  if (/Online|网络/iu.test(title)) {
    tags.push("网络赛");
  }
  for (const [tag, pattern] of LOCATION_TAGS) {
    if (pattern.test(title)) {
      tags.push(tag);
    }
  }
  return dedupeStrings(tags);
}

function buildProblemOrdinal(problem, index) {
  const rawOrdinal = String(problem.ordinal ?? "").trim();
  if (rawOrdinal) {
    return rawOrdinal;
  }
  return `P${index + 1}`;
}

async function main() {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT_PATH;
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT_PATH;
  const raw = JSON.parse(await readFile(inputPath, "utf8"));

  const contests = [];
  const problems = [];

  for (const contest of raw.contests ?? []) {
    const providerContestId = contest.url.match(/\/contest\/(.+)$/u)?.[1] ?? contest.url;
    const contestId = createDeterministicUuid(`contest:${providerContestId}:${contest.title}`);
    const contestProblems = [];

    const usedOrdinals = new Set();
    for (const [index, problem] of (contest.problems ?? []).entries()) {
      const providerProblemId = problem.url.match(/\/problem\/(\d+)$/u)?.[1] ?? problem.url;
      const baseOrdinal = buildProblemOrdinal(problem, index);
      let ordinal = baseOrdinal;
      let dedupeIndex = 2;
      while (usedOrdinals.has(ordinal.toLowerCase())) {
        ordinal = `${baseOrdinal}_${dedupeIndex}`;
        dedupeIndex += 1;
      }
      usedOrdinals.add(ordinal.toLowerCase());
      const problemId = `${contestId}:${ordinal}`;

      contestProblems.push(problemId);
      problems.push({
        problemId,
        contestId,
        ordinal,
        title: String(problem.title ?? "").trim() || ordinal,
        aliases: [],
        sources: [
          {
            provider: "qoj",
            kind: "problem",
            url: problem.url,
            provider_problem_id: providerProblemId,
            source_title: String(problem.title ?? "").trim() || ordinal,
            label: `QOJ ${ordinal}`,
          },
        ],
      });
    }

    contests.push({
      contestId,
      title: String(contest.title ?? "").trim(),
      aliases: [],
      tags: inferContestTags(String(contest.title ?? "").trim()),
      startAt: null,
      curationStatus: contestProblems.length > 0 ? "problem_listed" : "contest_stub",
      problemIds: contestProblems,
      sources: [
        {
          provider: "qoj",
          kind: "contest",
          url: contest.url,
          provider_contest_id: providerContestId,
          source_title: String(contest.title ?? "").trim(),
          label: "QOJ contest",
        },
      ],
      notes: null,
      generatedFrom: "catalog",
      deletedAt: null,
    });
  }

  const output = {
    schemaVersion: 1,
    exportKind: "local_catalog_snapshot",
    exportedAt: new Date().toISOString(),
    contests,
    problems,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        inputPath,
        outputPath,
        contestCount: contests.length,
        problemCount: problems.length,
        emptyContestCount: contests.filter((contest) => contest.problemIds.length === 0).length,
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
