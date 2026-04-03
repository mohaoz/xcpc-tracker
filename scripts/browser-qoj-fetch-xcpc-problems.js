(() => {
  const CONCURRENCY = 6;
  const SLEEP_MS = 120;
  const DEBUG = true;

  const CHINA_LOCATION_TOKENS = [
    "Beijing", "北京", "Shanghai", "上海", "Jiangsu", "江苏", "Guangdong", "广东",
    "Shandong", "山东", "Hubei", "湖北", "Hunan", "湖南", "Heilongjiang", "黑龙江",
    "Jiangxi", "江西", "Hebei", "河北", "Liaoning", "辽宁", "Sichuan", "四川",
    "Shaanxi", "陕西", "Xinjiang", "新疆", "Jilin", "吉林", "Henan", "河南",
    "Fujian", "福建", "Xiangtan", "湘潭", "Northeast", "东北", "Wuhan", "武汉",
    "Kunming", "昆明", "Xi'an", "Xian", "西安", "Nanchang", "南昌", "Harbin", "哈尔滨",
    "Mianyang", "绵阳", "Guilin", "桂林", "Weihai", "威海", "Qinhuangdao", "秦皇岛",
    "Changchun", "长春", "Chongqing", "重庆", "Zhengzhou", "郑州", "Shenzhen", "深圳",
    "Guangzhou", "广州", "Xiamen", "厦门", "Hangzhou", "杭州", "Jinan", "济南",
    "Qingdao", "青岛", "Macau", "澳门", "Yinchuan", "银川", "Hefei", "合肥",
    "Nanjing", "南京", "Shenyang", "沈阳", "Hong Kong", "香港", "Urumqi", "Ürümqi",
    "乌鲁木齐", "Jiaozuo", "焦作", "Nanning", "南宁", "Chengdu", "成都",
  ];

  const CHINA_LOCATION_RE = new RegExp(`(?:${CHINA_LOCATION_TOKENS.join("|")})`, "iu");

  const EXCLUDE_PATTERNS = [
    /North America/iu, /USA/iu, /Europe/iu, /NWERC/iu, /SWERC/iu, /SEERC/iu, /CERC/iu,
    /Moscow/iu, /Russia/iu, /Tokyo/iu, /Tsukuba/iu, /Ehime/iu, /Taipei-Hsinchu/iu,
    /Manila/iu, /Jakarta/iu, /Seoul/iu, /Yokohama/iu, /Taichung/iu, /Taoyuan/iu,
    /Tehran/iu, /Daejeon/iu, /Pyongyang/iu, /Aizu/iu,
    /German Collegiate/iu, /Polish Collegiate/iu, /Nordic Collegiate/iu, /Arab Collegiate/iu,
    /NCPC/iu, /AMPPZ/iu, /GDKOI/iu, /重点中学/iu,
    /省队选拔赛/iu, /代表队选拔赛/iu,
    /NOI/iu, /NOIP/iu, /CTSC/iu, /THUPC/iu, /THOI/iu, /JOI/iu, /IOI/iu, /USACO/iu,
    /Cfz/iu, /Universal Cup/iu, /Open Cup/iu, /Petrozavodsk/iu,
    /Practice Contest/iu, /Voluntary/iu, /Camp/iu,
  ];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isXcpcContestTitle(title) {
    title = cleanText(title);
    if (!title) return false;
    if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(title))) return false;

    if (/\bCCPC\b/iu.test(title) || /中国大学生程序设计竞赛/iu.test(title)) return true;

    if (/ICPC Asia/iu.test(title) || /ACM-ICPC, Asia/iu.test(title)) {
      return CHINA_LOCATION_RE.test(title) || /East Continent|EC[- ]?Final|China-Final|ECL-Final/iu.test(title);
    }

    if (/Asia East Continent|EC[- ]?Final|EC Regionals Online|East Continent Online Contest|China-Final|ECL-Final/iu.test(title)) {
      return true;
    }

    if (/Asia Pacific Championship/iu.test(title)) return true;

    if (
      CHINA_LOCATION_RE.test(title) &&
      (
        /Collegiate Programming Contest/iu.test(title) ||
        /Provincial .*Programming Contest/iu.test(title) ||
        /大学生程序设计竞赛/iu.test(title) ||
        /省赛/iu.test(title) ||
        /邀请赛/iu.test(title) ||
        /国邀/iu.test(title) ||
        /National Invitational/iu.test(title)
      )
    ) {
      return true;
    }

    if (/Northeast Collegiate Programming Contest/iu.test(title)) return true;
    return false;
  }

  function extractContestListFromCurrentPage() {
    const anchors = Array.from(document.querySelectorAll('a[href*="/contest/"]'));
    const contests = [];
    const seen = new Set();

    for (const anchor of anchors) {
      const title = cleanText(anchor.textContent);
      const url = anchor.href;

      if (!url || !/\/contest\/\d+(\?v=\d+)?$/i.test(url)) continue;
      if (!title || title === "register" || title === "pending final test") continue;
      if (!isXcpcContestTitle(title)) continue;

      const key = `${title}@@${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      contests.push({ title, url });
    }

    return contests;
  }

  function looksLikeProblemUrl(url) {
    return (
      /\/problem\/\d+$/i.test(url) ||
      /\/contest\/\d+\/problem\/[A-Za-z0-9]+$/i.test(url) ||
      /\/contest\/\d+\?problem=/i.test(url)
    );
  }

  function looksLikeOrdinal(value) {
    const text = cleanText(value);
    if (!text) return false;
    return /^([A-Z]|[A-Z][0-9]|[0-9]+|[A-Z]{2,3})$/u.test(text);
  }

  function extractOrdinalFromRow(row, anchor) {
    const cells = Array.from(row.querySelectorAll("td"));
    if (cells.length > 1) {
      for (const cell of cells) {
        const text = cleanText(cell.textContent);
        if (looksLikeOrdinal(text)) {
          return text;
        }
      }
    }

    const previousCell = anchor.closest("td")?.previousElementSibling;
    if (previousCell) {
      const text = cleanText(previousCell.textContent);
      if (looksLikeOrdinal(text)) {
        return text;
      }
    }

    return null;
  }

  function extractProblemsFromProblemTable(doc, contestUrl) {
    const rows = Array.from(doc.querySelectorAll("tr"));
    const problems = [];
    const seen = new Set();
    let fallbackIndex = 1;

    for (const row of rows) {
      const anchors = Array.from(row.querySelectorAll('a[href]'));
      const problemAnchor = anchors.find((anchor) => {
        const url = new URL(anchor.getAttribute("href") || "", contestUrl).href;
        return looksLikeProblemUrl(url);
      });

      if (!problemAnchor) continue;

      const title = cleanText(problemAnchor.textContent);
      const url = new URL(problemAnchor.getAttribute("href") || "", contestUrl).href;
      if (!title) continue;

      let ordinal = extractOrdinalFromRow(row, problemAnchor);
      if (!ordinal) {
        ordinal = String.fromCharCode(64 + fallbackIndex);
      }
      fallbackIndex += 1;

      const key = `${ordinal}@@${title}@@${url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      problems.push({ ordinal, title, url });
    }

    return problems;
  }

  function extractProblemsFallback(doc, contestUrl) {
    const anchors = Array.from(doc.querySelectorAll('a[href]'));
    const problems = [];
    const seen = new Set();
    let index = 1;

    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") || "";
      const title = cleanText(anchor.textContent);
      const url = new URL(href, contestUrl).href;

      if (!looksLikeProblemUrl(url)) continue;
      if (!title) continue;

      const ordinal = String.fromCharCode(64 + index);
      index += 1;

      const key = `${title}@@${url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      problems.push({ ordinal, title, url });
    }

    return problems;
  }

  function parseProblemsFromContestHtml(html, contestUrl) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tableProblems = extractProblemsFromProblemTable(doc, contestUrl);
    if (tableProblems.length > 0) {
      return tableProblems;
    }
    return extractProblemsFallback(doc, contestUrl);
  }

  async function fetchContest(contest) {
    try {
      const response = await fetch(contest.url, { credentials: "include" });
      const html = await response.text();
      const problems = parseProblemsFromContestHtml(html, contest.url);

      if (DEBUG) {
        console.log(`OK ${contest.title} | problems=${problems.length}`);
      }

      return {
        title: contest.title,
        url: contest.url,
        problems,
      };
    } catch (error) {
      console.error(`FAIL ${contest.title}`, error);
      return {
        title: contest.title,
        url: contest.url,
        problems: [],
        error: String(error),
      };
    }
  }

  async function runPool(items, worker, concurrency) {
    const results = new Array(items.length);
    let index = 0;

    async function runner() {
      while (true) {
        const current = index++;
        if (current >= items.length) return;
        results[current] = await worker(items[current], current);
        if (SLEEP_MS > 0) {
          await sleep(SLEEP_MS);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
    return results;
  }

  async function main() {
    const contests = extractContestListFromCurrentPage();
    console.log(`筛到 ${contests.length} 个 XCPC contest，开始抓题目...`);

    const results = await runPool(contests, fetchContest, CONCURRENCY);
    const payload = {
      exported_at: new Date().toISOString(),
      source_page: location.href,
      contest_count: results.length,
      contests: results,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "qoj-xcpc-contests-with-problems.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    console.log("导出完成", payload);
  }

  main().catch((error) => {
    console.error("导出失败", error);
  });
})();
