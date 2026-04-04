(async () => {
  const qoj = Array.from(
    document.querySelectorAll('table tbody tr td:first-child a[href*="/contest/"]'),
  ).map((a) => ({
    title: a.textContent.trim(),
    url: a.href,
  }));

  const resp = await fetch("https://codeforces.com/api/contest.list?gym=true");
  const json = await resp.json();

  if (json.status !== "OK") {
    throw new Error("Codeforces API failed");
  }

  const cf = json.result.map((x) => ({
    title: x.name,
    url: `https://codeforces.com/gym/${x.id}`,
  }));

  const result = [...qoj, ...cf];

  const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "contests.json";
  a.click();
  URL.revokeObjectURL(a.href);

  console.log(result);
  return result;
})();
