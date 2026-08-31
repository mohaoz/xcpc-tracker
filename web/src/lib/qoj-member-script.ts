export type QojBrowserScriptMember = {
  memberId: string;
  handle: string;
  displayName?: string;
};

function normalizeMembers(members: QojBrowserScriptMember[]): QojBrowserScriptMember[] {
  const normalized: QojBrowserScriptMember[] = [];
  const ownerByHandle = new Map<string, string>();

  for (const member of members) {
    const memberId = String(member.memberId ?? "").trim();
    const handle = String(member.handle ?? "").trim();
    const displayName = String(member.displayName ?? memberId).trim() || memberId;
    if (!memberId || !handle) {
      throw new Error("QOJ 批量脚本中的成员名称和 Handle 不能为空");
    }

    const normalizedHandle = handle.toLowerCase();
    const existingOwner = ownerByHandle.get(normalizedHandle);
    if (existingOwner && existingOwner !== memberId) {
      throw new Error(`QOJ Handle ${handle} 同时关联了成员 ${existingOwner} 和 ${memberId}`);
    }
    if (existingOwner) {
      continue;
    }

    ownerByHandle.set(normalizedHandle, memberId);
    normalized.push({ memberId, handle, displayName });
  }

  if (!normalized.length) {
    throw new Error("当前没有可更新的 QOJ 账号");
  }
  return normalized;
}

export function buildQojBatchBrowserScript(payload: {
  members: QojBrowserScriptMember[];
}) {
  const members = normalizeMembers(payload.members);

  return `void (async () => {
  const targets = ${JSON.stringify(members)};
  const host = location.hostname.toLowerCase();
  if (host !== "qoj.ac" && !host.endsWith(".qoj.ac")) {
    throw new Error("请在 qoj.ac 页面运行这段脚本");
  }

  function cleanText(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || "未知错误");
  }

  function extractHandle(doc, expectedHandle) {
    const profileHeading = doc.querySelector(
      '.card-body h2 a.uoj-username[href*="/user/profile/"]',
    );
    const links = profileHeading
      ? [profileHeading, ...Array.from(doc.querySelectorAll('a.uoj-username[href*="/user/profile/"]'))]
      : Array.from(doc.querySelectorAll('a.uoj-username[href*="/user/profile/"]'));
    const handles = [];
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const hrefMatch = href.match(/\\/user\\/profile\\/([^/?#]+)/i);
      if (hrefMatch) {
        handles.push(decodeURIComponent(hrefMatch[1]));
      }
    }
    return handles.find((handle) => handle.toLowerCase() === expectedHandle.toLowerCase())
      || handles[0]
      || "";
  }

  function extractDisplayName(doc) {
    const heading = doc.querySelector(".card-body h2 a.uoj-username");
    return cleanText(heading && heading.textContent);
  }

  function extractProblemIdsFromSection(heading) {
    const seen = new Set();
    const result = [];

    for (let node = heading.nextElementSibling; node; node = node.nextElementSibling) {
      if (node.matches(".list-group-item-heading")) {
        break;
      }
      const links = node.matches('a[href*="/problem/"]')
        ? [node]
        : Array.from(node.querySelectorAll('a[href*="/problem/"]'));
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const match = href.match(/\\/problem\\/(\\d+)/i);
        if (!match || seen.has(match[1])) {
          continue;
        }
        seen.add(match[1]);
        result.push(match[1]);
      }
    }

    return result;
  }

  function extractProblemSections(doc) {
    return Array.from(doc.querySelectorAll(".list-group-item-heading"))
      .map((heading) => ({
        headingText: cleanText(heading.textContent),
        problemIds: extractProblemIdsFromSection(heading),
      }));
  }

  function findProblemSection(sections, headingPatterns) {
    return sections.find((item) =>
      headingPatterns.some((pattern) => pattern.test(item.headingText)),
    );
  }

  async function fetchMember(target, currentIndex) {
    const profileUrl = new URL("/user/profile/" + encodeURIComponent(target.handle), location.origin);
    console.info(
      "[xcpc-tracker] " + currentIndex + "/" + targets.length + " 正在读取 " + target.handle,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    let response;
    let html;
    try {
      response = await fetch(profileUrl.href, {
        credentials: "include",
        headers: { Accept: "text/html" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " " + response.statusText);
      }
      if (/\\/login(?:[/?#]|$)/i.test(new URL(response.url).pathname)) {
        throw new Error("QOJ 会话需要重新登录");
      }
      html = await response.text();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("请求超时");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const doc = new DOMParser().parseFromString(html, "text/html");
    const fetchedHandle = extractHandle(doc, target.handle);
    if (!fetchedHandle) {
      throw new Error("返回页面不是可识别的 QOJ 用户主页，可能需要先完成人机验证");
    }
    if (fetchedHandle.toLowerCase() !== target.handle.toLowerCase()) {
      throw new Error('请求账号 "' + target.handle + '"，但页面账号是 "' + fetchedHandle + '"');
    }

    const sections = extractProblemSections(doc);
    const solvedSection = findProblemSection(
      sections,
      [/Accepted problems/i, /accepted/i, /通过的?题目/i, /已通过/i],
    );
    const attemptedSection = findProblemSection(
      sections,
      [/Tried problems/i, /tried/i, /尝试过的?题目/i, /已尝试/i],
    );
    if (sections.length && !solvedSection && !attemptedSection) {
      throw new Error(
        "无法识别 QOJ 做题分区：" + sections.map((section) => section.headingText).join(" / "),
      );
    }
    const solved = solvedSection?.problemIds || [];
    const solvedSet = new Set(solved);
    const attempted = (attemptedSection?.problemIds || [])
      .filter((problemId) => !solvedSet.has(problemId));

    return {
      member_id: target.memberId,
      handle: target.handle,
      display_name: cleanText(target.displayName) || extractDisplayName(doc) || target.memberId,
      profile_url: profileUrl.href,
      solved,
      attempted,
    };
  }

  function downloadJson(text) {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "qoj-members-batch-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function publishJsonText(text) {
    window.__xcpcTrackerQojMemberJson = text;
    if (typeof copy === "function") {
      try {
        copy(text);
        return "devtools";
      } catch (error) {
        console.warn("[xcpc-tracker] DevTools copy(text) 失败", error);
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    } catch (error) {
      console.warn("[xcpc-tracker] Clipboard API 失败", error);
    }
    console.log("[xcpc-tracker] JSON 也保存在 window.__xcpcTrackerQojMemberJson：");
    console.log("%s", text);
    downloadJson(text);
    return "download";
  }

  const importedMembers = [];
  const fetchFailures = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    try {
      importedMembers.push(await fetchMember(target, index + 1));
    } catch (error) {
      const failure = {
        member_id: target.memberId,
        handle: target.handle,
        error: errorMessage(error),
      };
      fetchFailures.push(failure);
      console.error("[xcpc-tracker] 读取 " + target.handle + " 失败：" + failure.error);
    }
    if (index + 1 < targets.length) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const exportedPayload = {
    provider: "qoj",
    exported_at: new Date().toISOString(),
    script_version: 2,
    members: importedMembers,
    fetch_failures: fetchFailures,
  };
  const text = JSON.stringify(exportedPayload);
  const publishMethod = await publishJsonText(text);
  if (fetchFailures.length) {
    console.table(fetchFailures);
  }
  const summary =
    "QOJ 批量读取完成：成功 " + importedMembers.length + "，失败 " + fetchFailures.length + "。";
  if (publishMethod === "download") {
    alert(summary + " 剪贴板复制失败，已下载 JSON 文件；回到 xcpc-tracker 的管理页导入。");
  } else {
    alert(summary + " JSON 已复制；回到 xcpc-tracker 的管理页粘贴导入。");
  }
})().catch((error) => {
  console.error("[xcpc-tracker] QOJ 批量更新失败", error);
  alert("QOJ 批量更新失败：" + (error instanceof Error ? error.message : String(error)));
});`;
}

export function buildQojBrowserScript(payload: {
  memberId: string;
  handle: string;
}) {
  return buildQojBatchBrowserScript({
    members: [
      {
        memberId: payload.memberId,
        handle: payload.handle,
        displayName: payload.memberId,
      },
    ],
  });
}
