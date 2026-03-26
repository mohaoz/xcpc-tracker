// @ts-nocheck

import { access } from "node:fs/promises";
import { join } from "node:path";

import { getRepoRoot, loadCatalogContests } from "./catalog-lib.js";

async function main() {
  const repoRoot = getRepoRoot();
  const bundleSchemaPath = join(repoRoot, "schemas", "catalog-bundle.schema.json");
  const schemaPath = join(repoRoot, "schemas", "contest.schema.json");
  await access(bundleSchemaPath);
  await access(schemaPath);

  const contests = await loadCatalogContests();
  console.log(`Validated ${contests.length} curated contests against repo rules.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
