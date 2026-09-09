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

  async function pickJsonFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.style.display = "none";
      input.addEventListener("change", async () => {
        try {
          const file = input.files?.[0];
          if (!file) {
            reject(new Error("没有选择文件"));
            return;
          }
          const text = await file.text();
          resolve({
            name: file.name,
            data: JSON.parse(text),
          });
        } catch (error) {
          reject(error);
        } finally {
          input.remove();
        }
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  function normalizeInputEntries(raw) {
    if (Array.isArray(raw)) {
      return raw
        .filter((item) => item && typeof item.url === "string" && /qoj\.ac\/contest\//iu.test(item.url))
        .map((item) => ({
          title: cleanText(item.title),
          url: cleanText(item.url),
        }));
    }

    if (raw?.exportKind === "local_catalog_snapshot" && Array.isArray(raw.contests)) {
      return raw.contests.flatMap((contest) =>
        (contest.sources ?? [])
          .filter((source) => source?.kind === "contest" && typeof source?.url === "string" && /qoj\.ac\/contest\//iu.test(source.url))
          .map((source) => ({
            title: cleanText(contest.title || source.source_title),
            url: cleanText(source.url),
          })),
      );
    }

    if (Array.isArray(raw?.contests)) {
      return raw.contests
        .filter((item) => item && typeof item.url === "string" && /qoj\.ac\/contest\//iu.test(item.url))
        .map((item) => ({
          title: cleanText(item.title),
          url: cleanText(item.url),
        }));
    }

    throw new Error("输入 JSON 必须是数组，或带 contests 的对象");
  }

  async function fetchQojContestProblems(entry) {
    const contestUrl = new URL(entry.url, location.href);
    contestUrl.hash = "";
    const response = await fetch(contestUrl.toString(), { credentials: "include" });
    if (!response.ok) {
      throw new Error(`QOJ HTTP ${response.status}`);
    }
    const fetchedUrl = new URL(response.url || contestUrl);
    if (fetchedUrl.origin !== contestUrl.origin || fetchedUrl.pathname.replace(/\/$/u, "") !== contestUrl.pathname.replace(/\/$/u, "")) {
      throw new Error(`QOJ 跳转到 ${fetchedUrl}，请确认已登录且有权查看该比赛`);
    }
    if (fetchedUrl.searchParams.get("v") !== contestUrl.searchParams.get("v")) {
      throw new Error(`QOJ 响应版本与请求不一致：${fetchedUrl}`);
    }
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const sourceTitle = cleanText(doc.querySelector("h1")?.textContent) || cleanText(doc.title.replace(/\s*-\s*QOJ\.ac$/iu, ""));
    const rows = Array.from(doc.querySelectorAll("tr"));
    const problems = [];
    let fallbackIndex = 1;
    const problemPath = new RegExp(`^${contestUrl.pathname.replace(/\/$/u, "")}/problem/([0-9]+)/?$`, "u");

    for (const row of rows) {
      const anchor = Array.from(row.querySelectorAll('a[href]')).find((item) => {
        const candidate = new URL(item.getAttribute("href") ?? item.href, contestUrl);
        return candidate.origin === contestUrl.origin && problemPath.test(candidate.pathname);
      });
      if (!anchor) continue;

      const title = cleanText(anchor.textContent);
      const rawHref = anchor.getAttribute("href") ?? anchor.href;
      const problemUrl = new URL(rawHref, contestUrl);
      problemUrl.hash = "";
      if (contestUrl.searchParams.has("v")) {
        if (problemUrl.searchParams.has("v") && problemUrl.searchParams.get("v") !== contestUrl.searchParams.get("v")) {
          throw new Error(`题目链接版本与比赛不一致：${problemUrl}`);
        }
        problemUrl.searchParams.set("v", contestUrl.searchParams.get("v"));
      }
      const url = problemUrl.toString();
      const providerProblemId = problemUrl.pathname.match(problemPath)?.[1] ?? "";
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

    const normalizedProblems = dedupeBy(
      problems,
      (problem) => `${cleanText(problem.ordinal).toLowerCase()}@@${problem.provider_problem_id}`,
    );
    if (!normalizedProblems.length) {
      throw new Error(`未解析到题目（页面：${sourceTitle || "未知"}）；请确认已登录、比赛版本正确且页面显示完整题单`);
    }
    return {
      problems: normalizedProblems,
      fetched_url: fetchedUrl.toString(),
      source_title: sourceTitle || entry.title,
    };
  }

  async function mapWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let cursor = 0;

    async function runWorker() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
    );
    return results;
  }

  const picked = await pickJsonFile();
  const entries = dedupeBy(normalizeInputEntries(picked.data), (entry) => entry.url);
  if (!entries.length) {
    throw new Error("输入里没有可抓取的 QOJ 比赛");
  }

  const total = entries.length;
  let finished = 0;
  console.log(`开始批量抓取 QOJ 题目，共 ${total} 场`);

  const results = await mapWithConcurrency(entries, 4, async (entry) => {
    try {
      const snapshot = await fetchQojContestProblems(entry);
      finished += 1;
      console.log(`[${finished}/${total}] OK ${entry.url} ${snapshot.problems.length} 题`);
      return {
        title: entry.title,
        url: entry.url,
        ...snapshot,
      };
    } catch (error) {
      finished += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${finished}/${total}] FAIL ${entry.url} ${message}`);
      return {
        title: entry.title,
        url: entry.url,
        problems: [],
        error: message,
      };
    }
  });

  const text = downloadJson("qoj-problems.json", results);
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }

  console.log({
    input_file: picked.name,
    total_contest_count: results.length,
    success_count: results.filter((item) => !item.error).length,
    failed_count: results.filter((item) => !!item.error).length,
    total_problem_count: results.reduce((sum, item) => sum + item.problems.length, 0),
  });
  console.log(results);
  return results;
})();
