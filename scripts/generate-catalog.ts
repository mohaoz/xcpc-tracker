// @ts-nocheck

import { loadCatalogContests, writeGeneratedCatalog } from "./catalog-lib.js";

async function main() {
  const contests = await loadCatalogContests();
  await writeGeneratedCatalog(contests);
  console.log(`Generated frontend catalog artifacts for ${contests.length} contests.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
