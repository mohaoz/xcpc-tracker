(async () => {
  function cleanText(value) {
    return String(value ?? "").replace(/\s+/gu, " ").trim();
  }

  function dedupeBy(items, getKey) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
      const key = getKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function looksLikeOrdinal(value) {
    const text = cleanText(value);
    return /^([A-Z]|[A-Z][0-9]|[0-9]+|[A-Z]{2,3})$/u.test(text);
  }

  function fallbackOrdinal(index) {
    if (index >= 1 && index <= 26) {
      return String.fromCharCode(64 + index);
    }
    return String(index);
  }

  function detectProvider() {
    const host = location.hostname.toLowerCase();
    if (host.endsWith("qoj.ac")) return "qoj";
    if (host.endsWith("codeforces.com")) return "codeforces";
    throw new Error(`不支持的网站：${location.hostname}`);
  }

  function downloadJson(filename, payload) {
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return text;
  }

  function getQojContestMeta() {
    const match = location.pathname.match(/\/contest\/(\d+)/iu);
    if (!match) {
      throw new Error("当前页面不是 QOJ contest 页面");
    }
    const providerContestId = match[1];
    const title =
      cleanText(document.querySelector("h1")?.textContent) ||
      cleanText(document.title.replace(/\s*-\s*QOJ\.ac$/iu, ""));
    if (!title) {
      throw new Error("无法识别当前 QOJ 比赛标题");
    }
    return {
      provider: "qoj",
      provider_contest_id: providerContestId,
      title,
      url: `${location.origin}/contest/${providerContestId}`,
    };
  }

  function extractQojProblems() {
    const rows = Array.from(document.querySelectorAll("tr"));
    const problems = [];
    let fallbackIndex = 1;

    for (const row of rows) {
      const anchor = Array.from(row.querySelectorAll('a[href]')).find((item) =>
        /\/contest\/\d+\/problem\/\d+$/iu.test(item.href),
      );
      if (!anchor) continue;

      const title = cleanText(anchor.textContent);
      const url = anchor.href.replace(/[#?].*$/u, "");
      const providerProblemId = url.match(/\/problem\/(\d+)$/iu)?.[1] ?? "";
      if (!title || !providerProblemId) continue;

      let ordinal = null;
      for (const cell of Array.from(row.querySelectorAll("td"))) {
        const text = cleanText(cell.textContent);
        if (looksLikeOrdinal(text)) {
          ordinal = text;
          break;
        }
      }
      if (!ordinal) {
        const previousCell = anchor.closest("td")?.previousElementSibling;
        const text = cleanText(previousCell?.textContent);
        ordinal = looksLikeOrdinal(text) ? text : fallbackOrdinal(fallbackIndex);
      }
      fallbackIndex += 1;

      problems.push({
        ordinal,
        title,
        url,
        provider_problem_id: providerProblemId,
      });
    }

    return dedupeBy(
      problems,
      (problem) => `${cleanText(problem.ordinal).toLowerCase()}@@${problem.provider_problem_id}`,
    );
  }

  function getCodeforcesContestMeta() {
    const match = location.pathname.match(/^\/(gym|contest)\/(\d+)/iu);
    if (!match) {
      throw new Error("当前页面不是 Codeforces contest/gym 页面");
    }
    const scope = match[1].toLowerCase();
    const providerContestId = match[2];
    const title =
      cleanText(document.querySelector(".rtable .left")?.textContent) ||
      cleanText(document.querySelector(".caption")?.textContent) ||
      cleanText(document.title.replace(/\s*-\s*Codeforces$/iu, ""));
    return {
      provider: "codeforces",
      provider_contest_id: providerContestId,
      title: title || `${scope} ${providerContestId}`,
      url: `${location.origin}/${scope}/${providerContestId}`,
      scope,
    };
  }

  async function extractCodeforcesProblems(contestMeta) {
    const apiUrl = new URL("https://codeforces.com/api/contest.standings");
    apiUrl.searchParams.set("contestId", contestMeta.provider_contest_id);
    apiUrl.searchParams.set("from", "1");
    apiUrl.searchParams.set("count", "1");

    const response = await fetch(apiUrl.toString(), {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Codeforces API HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.status !== "OK" || !payload?.result?.problems) {
      throw new Error("Codeforces API 返回异常");
    }

    return dedupeBy(
      payload.result.problems
        .filter((problem) => cleanText(problem?.index))
        .map((problem) => {
          const ordinal = cleanText(problem.index);
          const title = cleanText(problem.name);
          return {
            ordinal,
            title,
            url: `${contestMeta.url}/problem/${ordinal}`,
            provider_problem_id: `${contestMeta.provider_contest_id}:${ordinal}`,
          };
        }),
      (problem) => `${cleanText(problem.ordinal).toLowerCase()}@@${problem.provider_problem_id}`,
    );
  }

  const provider = detectProvider();
  const contest =
    provider === "qoj"
      ? getQojContestMeta()
      : getCodeforcesContestMeta();
  const problems =
    provider === "qoj"
      ? extractQojProblems()
      : await extractCodeforcesProblems(contest);

  const filename = `${provider}-contest-${contest.provider_contest_id}-problems.json`;
  const text = downloadJson(filename, problems);

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      console.log(`已复制到剪贴板，并下载为 ${filename}`);
    } catch {
      console.log(`已下载为 ${filename}`);
    }
  } else {
    console.log(`已下载为 ${filename}`);
  }

  console.log({
    generated_at: new Date().toISOString(),
    provider,
    contest: {
      title: contest.title,
      url: contest.url,
      provider_contest_id: contest.provider_contest_id,
    },
    problem_count: problems.length,
  });
  console.log(problems);
  return problems;
})();
