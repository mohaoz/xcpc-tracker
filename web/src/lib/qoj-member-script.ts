export function buildQojBrowserScript(payload: {
  memberId: string;
  handle: string;
}) {
  return `(() => {
  const expectedHandle = ${JSON.stringify(payload.handle)};
  const embeddedMemberId = ${JSON.stringify(payload.memberId)};

  function cleanText(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function extractHandle() {
    const profileMatch = location.pathname.match(/\\/user\\/profile\\/([^/?#]+)/i);
    if (profileMatch) {
      return decodeURIComponent(profileMatch[1]);
    }
    const headingLink = document.querySelector('a.uoj-username[href*="/user/profile/"]');
    if (!headingLink) {
      return "";
    }
    const href = headingLink.getAttribute("href") || "";
    const hrefMatch = href.match(/\\/user\\/profile\\/([^/?#]+)/i);
    return hrefMatch ? decodeURIComponent(hrefMatch[1]) : "";
  }

  function extractDisplayName() {
    const heading = document.querySelector(".card-body h2 a.uoj-username");
    return cleanText(heading?.textContent);
  }

  function extractProblemIdsFromSection(heading) {
    const links = [];
    const seen = new Set();
    const result = [];

    for (let node = heading.nextElementSibling; node; node = node.nextElementSibling) {
      if (node.matches(".list-group-item-heading")) {
        break;
      }
      links.push(...Array.from(node.querySelectorAll('a[href*="/problem/"]')));
    }

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\\/problem\\/(\\d+)/i);
      if (!match) {
        continue;
      }
      const problemId = match[1];
      if (seen.has(problemId)) {
        continue;
      }
      seen.add(problemId);
      result.push(problemId);
    }

    return result;
  }

  function extractProblemSections() {
    const headings = Array.from(document.querySelectorAll(".list-group-item-heading"));
    return headings
      .map((heading) => ({
        headingText: cleanText(heading.textContent),
        problemIds: extractProblemIdsFromSection(heading),
      }))
      .filter((section) => section.problemIds.length > 0);
  }

  function extractProblemIds(headingPatterns, fallbackSectionIndex) {
    const sections = extractProblemSections();
    const section = sections.find((item) =>
      headingPatterns.some((pattern) => pattern.test(item.headingText)),
    );
    if (section) {
      return section.problemIds;
    }

    return sections[fallbackSectionIndex]?.problemIds ?? [];
  }

  const handle = extractHandle();
  if (!handle) {
    throw new Error("无法从当前页面识别 QOJ 用户名");
  }
  if (expectedHandle && handle !== expectedHandle) {
    throw new Error(\`Expected QOJ handle "\${expectedHandle}", but current page is "\${handle}"\`);
  }

  const memberId = cleanText(embeddedMemberId) || handle;
  const displayName = memberId || extractDisplayName() || handle;
  const solved = extractProblemIds([/Accepted problems/i], 0);
  const attempted = extractProblemIds([/Tried problems/i], 1)
    .filter((problemId) => !solved.includes(problemId));

  const payload = {
    provider: "qoj",
    exported_at: new Date().toISOString(),
    members: [
      {
        member_id: memberId,
        handle,
        display_name: displayName,
        profile_url: location.href,
        solved,
        attempted,
      },
    ],
  };
  const text = JSON.stringify(payload);

  function publishJsonText() {
    window.__xcpcTrackerQojMemberJson = text;
    if (typeof copy === "function") {
      try {
        copy(text);
        console.log("已通过 DevTools copy(text) 复制 JSON；同时保存在 window.__xcpcTrackerQojMemberJson");
        return true;
      } catch (error) {
        console.warn("DevTools copy(text) failed", error);
      }
    }
    console.log("QOJ member JSON is also available as window.__xcpcTrackerQojMemberJson:");
    console.log("%s", text);
    return false;
  }

  async function main() {
    const copiedByDevtools = publishJsonText();
    try {
      await navigator.clipboard.writeText(text);
      alert("QOJ 成员 JSON 已复制到剪贴板。回到 xcpc-tracker 的 Manage 页面直接粘贴导入。");
    } catch (error) {
      if (copiedByDevtools) {
        alert("QOJ 成员 JSON 已通过 DevTools copy(text) 复制。回到 xcpc-tracker 的 Manage 页面直接粘贴导入。");
        return;
      }
      const blob = new Blob([text], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = \`qoj-member-\${handle}.json\`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      alert("剪贴板复制失败，已回退为下载 JSON 文件。");
    }
  }

  main();
})();`;
}
