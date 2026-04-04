#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function getBaseUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.origin + u.pathname;
  } catch {
    return rawUrl;
  }
}

function main() {
  const [, , contestsPath, rulesPath, outputPath] = process.argv;

  if (!contestsPath || !rulesPath) {
    console.error("Usage: node scripts/filter-contests.cjs <contests.json> <rules.cjs> [output.json]");
    process.exit(1);
  }

  const contests = readJson(contestsPath);
  const ruleModule = require(path.resolve(rulesPath));

  const match =
    typeof ruleModule === "function"
      ? ruleModule
      : typeof ruleModule.match === "function"
        ? ruleModule.match
        : null;

  const groupKeyFn =
    typeof ruleModule.groupKey === "function"
      ? ruleModule.groupKey
      : (item) => getBaseUrl(item.url);

  if (!Array.isArray(contests)) {
    console.error("contests.json must be an array like [{ title, url }]");
    process.exit(1);
  }

  if (!match) {
    console.error("rules file must export a function or an object with match(title, item)");
    process.exit(1);
  }

  const groups = new Map();

  for (const item of contests) {
    if (!item || typeof item.title !== "string" || typeof item.url !== "string") {
      continue;
    }

    const key = groupKeyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const result = [];

  for (const items of groups.values()) {
    const hit = items.some((item) => !!match(item.title, item));
    if (hit) {
      result.push(...items);
    }
  }

  const text = `${JSON.stringify(result, null, 2)}\n`;

  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), text, "utf8");
  } else {
    process.stdout.write(text);
  }
}

main();
