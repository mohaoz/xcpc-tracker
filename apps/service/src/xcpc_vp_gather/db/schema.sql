PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contest (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  provider_contest_id TEXT NOT NULL,
  slug TEXT,
  alias TEXT,
  tags_json TEXT,
  title TEXT NOT NULL,
  official_url TEXT,
  start_time TEXT,
  end_time TEXT,
  timezone TEXT,
  source_payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_key, provider_contest_id)
);

CREATE TABLE IF NOT EXISTS problem (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  provider_problem_id TEXT NOT NULL,
  contest_id TEXT NOT NULL,
  problem_code TEXT,
  title TEXT NOT NULL,
  ordinal TEXT,
  official_url TEXT,
  statement_url TEXT,
  source_payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_key, provider_problem_id),
  FOREIGN KEY (contest_id) REFERENCES contest(id)
);

CREATE TABLE IF NOT EXISTS artifact (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  title TEXT,
  source_url TEXT,
  local_path TEXT,
  mime_type TEXT,
  checksum_sha256 TEXT,
  status TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  source_payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_binding (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  provider_user_id TEXT,
  provider_handle TEXT,
  local_member_key TEXT NOT NULL,
  display_name TEXT,
  binding_status TEXT NOT NULL,
  source_payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_key, local_member_key, provider_handle)
);

CREATE TABLE IF NOT EXISTS submission (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  provider_submission_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  contest_id TEXT,
  identity_binding_id TEXT,
  submitted_at TEXT,
  verdict TEXT,
  language TEXT,
  score REAL,
  is_solved INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  source_payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_key, provider_submission_id),
  FOREIGN KEY (problem_id) REFERENCES problem(id),
  FOREIGN KEY (contest_id) REFERENCES contest(id),
  FOREIGN KEY (identity_binding_id) REFERENCES identity_binding(id)
);

CREATE TABLE IF NOT EXISTS member_problem_status (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  local_member_key TEXT NOT NULL,
  identity_binding_id TEXT,
  problem_id TEXT,
  provider_problem_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('solved', 'tried', 'unseen')),
  last_source_kind TEXT NOT NULL,
  source_url TEXT,
  source_payload_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_key, local_member_key, provider_problem_id),
  FOREIGN KEY (identity_binding_id) REFERENCES identity_binding(id),
  FOREIGN KEY (problem_id) REFERENCES problem(id)
);

CREATE TABLE IF NOT EXISTS contest_coverage_summary (
  contest_id TEXT PRIMARY KEY,
  problem_count INTEGER NOT NULL DEFAULT 0,
  fresh_problem_count INTEGER NOT NULL DEFAULT 0,
  tried_problem_count INTEGER NOT NULL DEFAULT 0,
  solved_problem_count INTEGER NOT NULL DEFAULT 0,
  problem_states_json TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (contest_id) REFERENCES contest(id)
);

CREATE TABLE IF NOT EXISTS task_run (
  id TEXT PRIMARY KEY,
  task_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_key TEXT,
  payload_json TEXT,
  current_step TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS task_event (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_run_id) REFERENCES task_run(id)
);

CREATE TABLE IF NOT EXISTS sync_cursor (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  cursor_kind TEXT NOT NULL,
  cursor_key TEXT NOT NULL,
  cursor_value TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_key, cursor_kind, cursor_key)
);

CREATE INDEX IF NOT EXISTS idx_problem_contest_id ON problem(contest_id);
CREATE INDEX IF NOT EXISTS idx_identity_binding_status_member
  ON identity_binding(binding_status, local_member_key);
CREATE INDEX IF NOT EXISTS idx_member_problem_status_member_provider_problem
  ON member_problem_status(local_member_key, provider_problem_id);
CREATE INDEX IF NOT EXISTS idx_member_problem_status_member_problem
  ON member_problem_status(local_member_key, problem_id);
