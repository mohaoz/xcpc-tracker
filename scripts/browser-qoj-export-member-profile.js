(() => {
  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function extractHandle() {
    const profileMatch = location.pathname.match(/\/user\/profile\/([^/?#]+)/i);
    if (profileMatch) {
      return decodeURIComponent(profileMatch[1]);
    }
    const headingLink = document.querySelector('a.uoj-username[href*="/user/profile/"]');
    if (!headingLink) {
      return "";
    }
    const href = headingLink.getAttribute("href") || "";
    const hrefMatch = href.match(/\/user\/profile\/([^/?#]+)/i);
    return hrefMatch ? decodeURIComponent(hrefMatch[1]) : "";
  }

  function extractDisplayName() {
    const heading = document.querySelector(".card-body h2 a.uoj-username");
    return cleanText(heading?.textContent);
  }

  function extractProblemIds(headingText) {
    const headings = Array.from(document.querySelectorAll(".list-group-item-heading"));
    const heading = headings.find((node) => cleanText(node.textContent).includes(headingText));
    if (!heading) {
      return [];
    }
    const container = heading.parentElement;
    const links = Array.from(container?.querySelectorAll('a[href*="/problem/"]') ?? []);
    const seen = new Set();
    const result = [];

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/problem\/(\d+)/i);
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

  const handle = extractHandle();
  if (!handle) {
    throw new Error("Could not determine QOJ handle from this page");
  }

  const memberId = window.prompt("Local member id", handle) || handle;
  const fallbackDisplayName = extractDisplayName() || handle;
  const displayName = window.prompt("Display name", fallbackDisplayName) || fallbackDisplayName;
  const solved = extractProblemIds("Accepted problems");
  const attempted = extractProblemIds("Tried problems").filter((problemId) => !solved.includes(problemId));

  const payload = {
    provider: "qoj",
    exported_at: new Date().toISOString(),
    members: [
      {
        member_id: cleanText(memberId) || handle,
        handle,
        display_name: cleanText(displayName) || handle,
        profile_url: location.href,
        solved,
        attempted,
      },
    ],
  };
  const text = JSON.stringify(payload, null, 2);

  async function main() {
    try {
      await navigator.clipboard.writeText(text);
      console.log("已复制到剪贴板", {
        handle,
        memberId: payload.members[0].member_id,
        solvedCount: solved.length,
        attemptedCount: attempted.length,
      });
      alert("QOJ 成员 JSON 已复制到剪贴板。回到 xcpc-tracker 的 Manage 页面直接粘贴导入。");
    } catch (error) {
      console.warn("复制失败，回退为下载 JSON 文件", error);
      const blob = new Blob([text], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `qoj-member-${handle}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      alert("剪贴板复制失败，已回退为下载 JSON 文件。");
    }
  }

  main();

  console.log("导出完成", {
    handle,
    memberId: payload.members[0].member_id,
    solvedCount: solved.length,
    attemptedCount: attempted.length,
  });
})();
