export type CodeforcesApiCredentials = {
  apiKey: string;
  apiSecret: string;
};

const STORAGE_KEY = "xcpc_tracker_codeforces_api_credentials";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadCodeforcesApiCredentials(): CodeforcesApiCredentials | null {
  if (!canUseStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CodeforcesApiCredentials>;
    const apiKey = parsed.apiKey?.trim() ?? "";
    const apiSecret = parsed.apiSecret?.trim() ?? "";
    if (!apiKey || !apiSecret) {
      return null;
    }
    return { apiKey, apiSecret };
  } catch {
    return null;
  }
}

export function saveCodeforcesApiCredentials(credentials: CodeforcesApiCredentials) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      apiKey: credentials.apiKey.trim(),
      apiSecret: credentials.apiSecret.trim(),
    }),
  );
}

export function clearCodeforcesApiCredentials() {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}
