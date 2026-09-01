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
  returnUrl?: string;
}) {
  const members = normalizeMembers(payload.members);
  const returnUrl = String(payload.returnUrl ?? "").trim();

  return `void (async () => {
  const targets = ${JSON.stringify(members)};
  const trackerReturnUrl = ${JSON.stringify(returnUrl)};
  const devtoolsCopy = typeof copy === "function" ? copy : null;
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

  function applyStyles(element, styles) {
    Object.assign(element.style, styles);
  }

  function createProgressPanel() {
    const existingPanel = document.getElementById("xcpc-tracker-qoj-progress");
    if (existingPanel) {
      existingPanel.remove();
    }

    const panel = document.createElement("section");
    panel.id = "xcpc-tracker-qoj-progress";
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    applyStyles(panel, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "2147483647",
      width: "min(380px, calc(100vw - 32px))",
      boxSizing: "border-box",
      padding: "16px",
      border: "1px solid rgba(15, 118, 110, 0.28)",
      borderRadius: "14px",
      background: "rgba(255, 255, 255, 0.98)",
      boxShadow: "0 18px 48px rgba(15, 23, 42, 0.24)",
      color: "#0f172a",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "14px",
      lineHeight: "1.5",
    });

    const header = document.createElement("div");
    applyStyles(header, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
    });
    const title = document.createElement("strong");
    title.textContent = "XCPC Tracker · QOJ 批量更新";
    applyStyles(title, { color: "#0f766e", fontSize: "15px" });
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "关闭进度面板");
    applyStyles(closeButton, {
      border: "0",
      background: "transparent",
      color: "#64748b",
      cursor: "pointer",
      fontSize: "22px",
      lineHeight: "1",
      padding: "0 2px",
    });
    closeButton.addEventListener("click", () => panel.remove());
    header.append(title, closeButton);

    const statusText = document.createElement("div");
    statusText.dataset.xcpcRole = "status";
    applyStyles(statusText, { marginTop: "12px", fontWeight: "650" });

    const progressTrack = document.createElement("div");
    applyStyles(progressTrack, {
      height: "8px",
      marginTop: "10px",
      overflow: "hidden",
      borderRadius: "999px",
      background: "#e2e8f0",
    });
    const progressBar = document.createElement("div");
    progressBar.dataset.xcpcRole = "progress";
    applyStyles(progressBar, {
      width: "0%",
      height: "100%",
      borderRadius: "inherit",
      background: "#0f766e",
      transition: "width 180ms ease",
    });
    progressTrack.append(progressBar);

    const countsText = document.createElement("div");
    countsText.dataset.xcpcRole = "counts";
    applyStyles(countsText, { marginTop: "10px", color: "#334155" });
    const detailText = document.createElement("div");
    detailText.dataset.xcpcRole = "detail";
    applyStyles(detailText, { marginTop: "4px", color: "#64748b", fontSize: "12px" });

    const returnLink = document.createElement("a");
    returnLink.dataset.xcpcRole = "return";
    returnLink.textContent = "返回 xcpc-tracker 导入";
    returnLink.target = "_blank";
    returnLink.rel = "noopener noreferrer";
    returnLink.href = trackerReturnUrl || "#";
    applyStyles(returnLink, {
      display: "none",
      width: "100%",
      boxSizing: "border-box",
      justifyContent: "center",
      marginTop: "12px",
      padding: "9px 12px",
      borderRadius: "9px",
      background: "#0f766e",
      color: "#ffffff",
      fontWeight: "650",
      textDecoration: "none",
    });

    panel.append(header, statusText, progressTrack, countsText, detailText, returnLink);
    document.body.appendChild(panel);
    return { statusText, progressBar, countsText, detailText, returnLink };
  }

  function extractHandle(pageUrl) {
    try {
      const pathname = new URL(pageUrl, location.origin).pathname;
      const profileMatch = pathname.match(/\\/user\\/profile\\/([^/?#]+)/i);
      return profileMatch ? decodeURIComponent(profileMatch[1]) : "";
    } catch {
      return "";
    }
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
    const fetchedHandle = extractHandle(response.url);
    if (!fetchedHandle) {
      throw new Error("返回页面不是可识别的 QOJ 用户主页，可能需要先完成人机验证");
    }
    if (fetchedHandle.toLowerCase() !== target.handle.toLowerCase()) {
      throw new Error('请求账号 "' + target.handle + '"，但页面账号是 "' + fetchedHandle + '"');
    }

    const sections = extractProblemSections(doc);
    if (!doc.querySelector(".card-body h2") && !sections.length) {
      throw new Error("返回页面缺少 QOJ 用户资料内容，可能需要先完成人机验证");
    }
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
    if (devtoolsCopy) {
      try {
        devtoolsCopy(text);
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
  const progressUi = createProgressPanel();
  const progressState = {
    completedCount: 0,
    currentHandle: "",
    currentIndex: 0,
    currentStartedAt: Date.now(),
    finished: false,
    phase: "preparing",
    publishMethod: "",
  };
  const overallStartedAt = Date.now();

  function renderProgress() {
    const successCount = importedMembers.length;
    const failureCount = fetchFailures.length;
    const percent = targets.length
      ? Math.round((progressState.completedCount / targets.length) * 100)
      : 100;
    progressUi.progressBar.style.width = percent + "%";
    progressUi.countsText.textContent =
      "已完成 " + progressState.completedCount + "/" + targets.length
      + " · 成功 " + successCount + " · 失败 " + failureCount;

    if (progressState.finished) {
      progressUi.statusText.textContent = progressState.publishMethod === "download"
        ? "读取完成，JSON 已下载"
        : "读取完成，JSON 已复制";
      progressUi.detailText.textContent =
        "总耗时 " + Math.max(0, Math.floor((Date.now() - overallStartedAt) / 1000))
        + " 秒。失败账号也已写入结果。";
      if (trackerReturnUrl) {
        progressUi.returnLink.style.display = "inline-flex";
      }
      return;
    }

    if (progressState.phase === "reading") {
      progressUi.statusText.textContent =
        progressState.currentIndex + "/" + targets.length
        + " 正在读取 " + progressState.currentHandle;
      progressUi.detailText.textContent =
        "当前账号已等待 "
        + Math.max(0, Math.floor((Date.now() - progressState.currentStartedAt) / 1000))
        + " 秒，单账号最多等待 20 秒。";
      return;
    }

    if (progressState.phase === "publishing") {
      progressUi.statusText.textContent = "账号读取完毕，正在整理 JSON…";
      progressUi.detailText.textContent = "即将复制到剪贴板；不可用时会自动下载文件。";
      return;
    }

    progressUi.statusText.textContent = "准备读取 " + targets.length + " 个 QOJ 账号…";
    progressUi.detailText.textContent = "脚本会逐个读取，期间请保持当前页面打开。";
  }

  renderProgress();
  const progressTimer = setInterval(renderProgress, 1000);
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    progressState.currentHandle = target.handle;
    progressState.currentIndex = index + 1;
    progressState.currentStartedAt = Date.now();
    progressState.phase = "reading";
    renderProgress();
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
    progressState.completedCount = index + 1;
    renderProgress();
    if (index + 1 < targets.length) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  progressState.phase = "publishing";
  renderProgress();
  const exportedPayload = {
    provider: "qoj",
    exported_at: new Date().toISOString(),
    script_version: 2,
    members: importedMembers,
    fetch_failures: fetchFailures,
  };
  const text = JSON.stringify(exportedPayload);
  const publishMethod = await publishJsonText(text);
  clearInterval(progressTimer);
  progressState.finished = true;
  progressState.publishMethod = publishMethod;
  renderProgress();
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
