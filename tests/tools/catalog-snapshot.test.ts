import { describe, expect, it } from "vitest";
import { readJson } from "../../scripts/source-import-lib.mjs";
import { validateSnapshot } from "../../scripts/source-schemas.mjs";

describe("canonical catalog snapshot", () => {
  it("passes schema validation including source and award evidence fields", async () => {
    const catalog = await readJson("catalog/default-catalog.min.json");
    await expect(validateSnapshot(catalog)).resolves.toBeUndefined();
    expect(catalog.contests.length).toBeGreaterThan(0);
    expect(catalog.problems.length).toBeGreaterThan(0);
  });

  it("matches the app version", async () => {
    const catalog = await readJson("catalog/default-catalog.min.json");
    const app = await readJson("package.json");
    expect(catalog.version, "Catalog/app version mismatch").toBe(app.version);
  });
});
