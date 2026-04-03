import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_CODEFORCES_CATALOG_PATH = resolve(repoRoot, "fixtures/imports/codeforces/origin-catalog.snapshot.json");
const DEFAULT_QOJ_CATALOG_PATH = resolve(repoRoot, "fixtures/imports/qoj/qoj-browser-final.catalog.json");
const DEFAULT_OUTPUT_PATH = resolve(repoRoot, "catalog/default-catalog.min.json");

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
  const hash = createHash("sha1").update(`xcpc-tracker:merged-catalog:${seed}`).digest("hex");
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

function mergeSources(existingSources, nextSource) {
  const nextKey = `${nextSource.provider}::${nextSource.kind}::${nextSource.provider_contest_id ?? nextSource.url ?? ""}`;
  const byKey = new Map(
    existingSources.map((source) => [
      `${source.provider}::${source.kind}::${source.provider_contest_id ?? source.url ?? ""}`,
      source,
    ]),
  );
  byKey.set(nextKey, { ...(byKey.get(nextKey) ?? {}), ...nextSource });
  return [...byKey.values()];
}

function normalizeTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\([^)]*(universal cup|open cup|warm ?up|practice|onsite|site|official contest)\)/giu, " ")
    .replace(/（[^）]*(热身赛|练习赛|暖场|onsite|site|warm ?up|practice)[^）]*）/gu, " ")
    .replace(/\b(the|contest|onsite|site|official|regional|programming)\b/giu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getProblemMatchKey(problem) {
  const ordinal = String(problem.ordinal ?? "").trim().toLowerCase();
  if (ordinal && !/^p\d+$/iu.test(ordinal)) {
    return `ordinal:${ordinal}`;
  }
  return `title:${normalizeTitle(problem.title ?? "")}`;
}

function getProblemMatchKeys(problem) {
  const keys = [];
  const normalizedTitle = normalizeTitle(problem.title ?? "");
  if (normalizedTitle) {
    keys.push(`title:${normalizedTitle}`);
  }
  const ordinal = String(problem.ordinal ?? "").trim().toLowerCase();
  if (ordinal && !/^p\d+$/iu.test(ordinal)) {
    keys.push(`ordinal:${ordinal}`);
  }
  return dedupeStrings(keys);
}

function getContestMatchKeys(contest) {
  return dedupeStrings([
    normalizeTitle(contest.title),
    ...(contest.aliases ?? []).map(normalizeTitle),
    ...((contest.sources ?? []).map((source) => normalizeTitle(source.source_title ?? ""))),
  ]);
}

function inferTagsFromTitle(title) {
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

function buildQojOnlyContest(qojContest) {
  return {
    contestId: qojContest.contestId ?? createDeterministicUuid(`qoj-only:${qojContest.sources?.[0]?.provider_contest_id ?? qojContest.title}`),
    title: qojContest.title,
    aliases: dedupeStrings(qojContest.aliases ?? []),
    tags: dedupeStrings(inferTagsFromTitle(qojContest.title)),
    startAt: qojContest.startAt ?? null,
    curationStatus: (qojContest.problemIds ?? []).length > 0 ? "problem_listed" : "contest_stub",
    problemIds: [...(qojContest.problemIds ?? [])],
    sources: (qojContest.sources ?? []).map((source) => ({ ...source })),
    notes: null,
    generatedFrom: "catalog",
    deletedAt: null,
  };
}

function toAlphaOrdinal(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

async function main() {
  const codeforcesCatalogPath = process.argv[2]
    ? resolve(process.argv[2])
    : DEFAULT_CODEFORCES_CATALOG_PATH;
  const qojCatalogPath = process.argv[3]
    ? resolve(process.argv[3])
    : DEFAULT_QOJ_CATALOG_PATH;
  const outputPath = process.argv[4]
    ? resolve(process.argv[4])
    : DEFAULT_OUTPUT_PATH;

  const codeforcesCatalog = JSON.parse(await readFile(codeforcesCatalogPath, "utf8"));
  const qojCatalog = JSON.parse(await readFile(qojCatalogPath, "utf8"));

  const codeforcesContests = codeforcesCatalog.contests.map((contest) => ({
    ...contest,
    aliases: [...(contest.aliases ?? [])],
    tags: [...(contest.tags ?? [])],
    problemIds: [...(contest.problemIds ?? [])],
    sources: (contest.sources ?? []).map((source) => ({ ...source })),
    notes: null,
    generatedFrom: "catalog",
    deletedAt: null,
  }));
  const codeforcesProblemsByContestId = new Map();
  for (const problem of codeforcesCatalog.problems ?? []) {
    const bucket = codeforcesProblemsByContestId.get(problem.contestId) ?? [];
    bucket.push({
      ...problem,
      aliases: [...(problem.aliases ?? [])],
      sources: (problem.sources ?? []).map((source) => ({ ...source })),
    });
    codeforcesProblemsByContestId.set(problem.contestId, bucket);
  }

  const qojProblemsByContestId = new Map();
  for (const problem of qojCatalog.problems ?? []) {
    const bucket = qojProblemsByContestId.get(problem.contestId) ?? [];
    bucket.push({
      ...problem,
      aliases: [...(problem.aliases ?? [])],
      sources: (problem.sources ?? []).map((source) => ({ ...source })),
    });
    qojProblemsByContestId.set(problem.contestId, bucket);
  }

  const cfByKey = new Map();
  for (const contest of codeforcesContests) {
    for (const key of getContestMatchKeys(contest)) {
      if (key && !cfByKey.has(key)) {
        cfByKey.set(key, contest);
      }
    }
  }

  const matchedQojIds = new Set();
  let mergedMatchCount = 0;
  for (const qojContest of qojCatalog.contests) {
    const match = getContestMatchKeys(qojContest)
      .map((key) => cfByKey.get(key))
      .find(Boolean);

    if (!match) {
      continue;
    }

    mergedMatchCount += 1;
    matchedQojIds.add(qojContest.contestId);
    match.sources = (qojContest.sources ?? []).reduce(
      (sources, source) => mergeSources(sources, source),
      match.sources,
    );
    match.aliases = dedupeStrings([
      ...(match.aliases ?? []),
      qojContest.title !== match.title ? qojContest.title : null,
      ...(qojContest.aliases ?? []),
    ]);
    if (!match.startAt && qojContest.startAt) {
      match.startAt = qojContest.startAt;
    }
    match.notes = null;

    const cfProblems = codeforcesProblemsByContestId.get(match.contestId) ?? [];
    const qojProblems = qojProblemsByContestId.get(qojContest.contestId) ?? [];
    const cfProblemByKey = new Map();
    for (const problem of cfProblems) {
      for (const key of getProblemMatchKeys(problem)) {
        if (key && !cfProblemByKey.has(key)) {
          cfProblemByKey.set(key, problem);
        }
      }
    }

    for (const qojProblem of qojProblems) {
      const matchedProblem = getProblemMatchKeys(qojProblem)
        .map((key) => cfProblemByKey.get(key))
        .find(Boolean);
      if (!matchedProblem) {
        continue;
      }
      matchedProblem.sources = (qojProblem.sources ?? []).reduce(
        (sources, source) => mergeSources(sources, source),
        matchedProblem.sources,
      );
      matchedProblem.aliases = dedupeStrings([
        ...(matchedProblem.aliases ?? []),
        qojProblem.title !== matchedProblem.title ? qojProblem.title : null,
        ...(qojProblem.aliases ?? []),
      ]);
    }
  }

  const qojOnlyContests = qojCatalog.contests
    .filter((contest) => !matchedQojIds.has(contest.contestId))
    .map(buildQojOnlyContest);
  const qojOnlyContestIds = new Set(qojOnlyContests.map((contest) => contest.contestId));
  const qojOnlyProblemsByContestId = new Map();
  for (const problem of qojCatalog.problems ?? []) {
    if (!qojOnlyContestIds.has(problem.contestId)) {
      continue;
    }
    const bucket = qojOnlyProblemsByContestId.get(problem.contestId) ?? [];
    bucket.push({
      ...problem,
      aliases: [...(problem.aliases ?? [])],
      sources: (problem.sources ?? []).map((source) => ({ ...source })),
    });
    qojOnlyProblemsByContestId.set(problem.contestId, bucket);
  }

  const normalizedQojOnlyProblems = [];
  for (const contest of qojOnlyContests) {
    const originalProblems = qojOnlyProblemsByContestId.get(contest.contestId) ?? [];
    const normalizedProblems = originalProblems.map((problem, index) => {
      const ordinal = toAlphaOrdinal(index);
      return {
        ...problem,
        problemId: `${contest.contestId}:${ordinal}`,
        ordinal,
      };
    });
    contest.problemIds = normalizedProblems.map((problem) => problem.problemId);
    if (normalizedProblems.length > 0) {
      contest.curationStatus = "problem_listed";
    }
    normalizedQojOnlyProblems.push(...normalizedProblems);
  }

  const mergedContests = [...codeforcesContests, ...qojOnlyContests].sort((left, right) =>
    left.title.localeCompare(right.title),
  );
  const mergedProblems = [
    ...[...(codeforcesCatalog.problems ?? [])].map((problem) => {
      const mergedProblem = (codeforcesProblemsByContestId.get(problem.contestId) ?? []).find(
        (item) => item.problemId === problem.problemId,
      );
      return mergedProblem ?? { ...problem };
    }),
    ...normalizedQojOnlyProblems,
  ];

  const mergedCatalog = {
    schemaVersion: 1,
    exportKind: "local_catalog_snapshot",
    exportedAt: new Date().toISOString(),
    contests: mergedContests,
    problems: mergedProblems,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(mergedCatalog, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        codeforcesContestCount: codeforcesCatalog.contests.length,
        qojContestCount: qojCatalog.contests.length,
        mergedMatchCount,
        qojOnlyCount: qojOnlyContests.length,
        mergedContestCount: mergedContests.length,
        mergedProblemCount: mergedProblems.length,
        outputPath,
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
