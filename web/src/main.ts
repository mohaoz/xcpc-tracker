import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "./App.vue";
import { router } from "./router";
import { fetchBundledCatalogSnapshot } from "./lib/catalog";
import { loadBundledCatalogSnapshot } from "./lib/catalog-cache";
import { applyLocalCatalogSnapshot, resetLocalDb } from "./lib/local-db";
import "./styles.css";

const LOCAL_CATALOG_VERSION_STORAGE_KEY = "xcpc_tracker_catalog_version";

function parseMinorVersion(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[2], 10);
}

function formatCatalogVersionLabel(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : "未初始化";
}

async function maybeForceRefreshLocalDb() {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }

  const onlineSnapshot = await fetchBundledCatalogSnapshot({
    forceRefresh: true,
  });
  const onlineVersion = onlineSnapshot.version?.trim() ?? "";
  if (!onlineVersion) {
    return;
  }

  const onlineMinorVersion = parseMinorVersion(onlineVersion);
  if (onlineMinorVersion === null) {
    return;
  }

  const localVersion = window.localStorage.getItem(LOCAL_CATALOG_VERSION_STORAGE_KEY);
  const localMinorVersion = parseMinorVersion(localVersion);

  if (localMinorVersion !== null && localMinorVersion >= onlineMinorVersion) {
    return;
  }

  const localSnapshot = await loadBundledCatalogSnapshot({
    forceRefresh: true,
  });

  await resetLocalDb();
  await applyLocalCatalogSnapshot(localSnapshot, {
    mode: "replace",
    includeProblems: true,
  });

  window.localStorage.setItem(LOCAL_CATALOG_VERSION_STORAGE_KEY, onlineVersion);
  window.alert(
    `检测到默认 catalog 已从 ${formatCatalogVersionLabel(localVersion)} 升级到 ${onlineVersion}，系统已自动执行一键初始化。本地成员数据需要重新导入。`,
  );
}

void (async () => {
  try {
    await maybeForceRefreshLocalDb();
  } catch (error) {
    console.error("failed to apply force-fresh catalog reset", error);
  }

  createApp(App).use(createPinia()).use(router).mount("#app");
})();
