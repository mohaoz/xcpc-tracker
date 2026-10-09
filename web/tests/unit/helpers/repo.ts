import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root; old scripts resolved fixtures relative to it. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const repoPath = (path: string) => resolve(repoRoot, path);
export const readRepoJson = <T = any>(path: string): T => JSON.parse(readFileSync(repoPath(path), "utf8"));
export const repoFileExists = (path: string) => existsSync(repoPath(path));
