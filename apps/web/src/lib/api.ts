export type ContestListItem = {
  contest_id: string;
  provider_key: string;
  provider_contest_id: string;
  alias: string | null;
  tags: string[];
  title: string;
  official_url: string | null;
  updated_at: string;
  problem_count?: number;
  fresh_problem_count?: number;
  tried_problem_count?: number;
  solved_problem_count?: number;
  problem_states?: Array<{
    ordinal: string;
    status: "solved" | "tried" | "unseen";
  }>;
};

export type ContestListPage = {
  contests: ContestListItem[];
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
};

export type ContestDetail = {
  contest_id: string;
  provider_key: string;
  provider_contest_id: string;
  alias: string | null;
  tags: string[];
  title: string;
  official_url: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string;
  problem_count: number;
  updated_at: string;
};

export type MemberListItem = {
  identity_binding_id: string;
  provider_key: string;
  local_member_key: string;
  provider_handle: string;
  display_name: string | null;
  binding_status: string;
  updated_at: string;
};

export type MemberPerson = {
  local_member_key: string;
  display_name: string | null;
  provider_count: number;
  binding_count: number;
  binding_status: string;
  solved_count: number;
  tried_count: number;
  last_synced_at: string;
  handles: Array<{
    identity_binding_id: string;
    provider_key: string;
    provider_handle: string;
    display_name: string | null;
    binding_status: string;
    updated_at: string;
  }>;
};

export type CoverageProblemMember = {
  local_member_key: string;
  provider_key: string;
  status: "solved" | "tried" | "unseen";
};

export type CoverageProblem = {
  problem_id: string;
  ordinal: string;
  title: string;
  fresh_for_team: boolean;
  members: CoverageProblemMember[];
};

export type ContestCoverage = {
  contest: ContestDetail;
  tracked_members: MemberListItem[];
  problem_count: number;
  fresh_problem_count: number;
  problems: CoverageProblem[];
};

type JsonValue = Record<string, unknown>;

const apiBase = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchContests(options?: {
  tags?: string[];
  withCoverage?: boolean;
  wholeContestFreshOnly?: boolean;
  noFreshOnly?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<ContestListPage> {
  const params = new URLSearchParams();
  if (options?.withCoverage) {
    params.set("with_coverage", "true");
  }
  if (options?.wholeContestFreshOnly) {
    params.set("whole_contest_fresh_only", "true");
  }
  if (options?.noFreshOnly) {
    params.set("no_fresh_only", "true");
  }
  if (options?.page) {
    params.set("page", String(options.page));
  }
  if (options?.pageSize) {
    params.set("page_size", String(options.pageSize));
  }
  for (const tag of options?.tags ?? []) {
    if (tag.trim()) {
      params.append("tag", tag.trim());
    }
  }
  const query = params.toString();
  const payload = await request<ContestListPage>(
    `/api/contests${query ? `?${query}` : ""}`,
  );
  return payload;
}

export async function fetchContestDetail(contestId: string): Promise<ContestDetail> {
  return request<ContestDetail>(`/api/contests/${contestId}`);
}

export async function fetchContestCoverage(contestId: string): Promise<ContestCoverage> {
  return request<ContestCoverage>(`/api/contests/${contestId}/coverage`);
}

export async function fetchMembers(): Promise<MemberListItem[]> {
  const payload = await request<{ members: MemberListItem[] }>("/api/members");
  return payload.members;
}

export async function fetchMemberPeople(): Promise<MemberPerson[]> {
  const payload = await request<{ people: MemberPerson[] }>("/api/members");
  return payload.people;
}

export async function syncContest(payload: {
  provider_key: string;
  contest_url?: string;
  provider_contest_id?: string;
}): Promise<JsonValue> {
  return request<JsonValue>("/api/contests/sync", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function syncMissingContests(): Promise<JsonValue> {
  return request<JsonValue>("/api/contests/sync-missing", {
    method: "POST",
  });
}

export async function syncMember(payload: {
  provider_key: string;
  local_member_key: string;
  provider_handle: string;
  display_name?: string;
}): Promise<JsonValue> {
  return request<JsonValue>("/api/members/problem-status/sync", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function annotateContest(payload: {
  contest_ref: string;
  provider_key?: string;
  alias?: string;
  tags?: string[];
}): Promise<JsonValue> {
  return request<JsonValue>("/api/contests/annotate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function exportContests(): Promise<{
  schema_version: number;
  export_kind: string;
  exported_at: string;
  contests: Array<Record<string, unknown>>;
}> {
  return request("/api/contests/export");
}

export async function importContests(payload: {
  payload: Record<string, unknown>;
  sync: boolean;
}): Promise<Record<string, unknown>> {
  return request("/api/contests/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function exportConfig(): Promise<{
  schema_version: number;
  export_kind: string;
  exported_at: string;
  contests: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
}> {
  return request("/api/config/export");
}

export async function importConfig(payload: {
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  return request("/api/config/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
