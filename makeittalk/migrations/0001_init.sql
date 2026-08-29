-- makeittalk schema v1
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  plan TEXT NOT NULL DEFAULT 'free',
  plan_status TEXT NOT NULL DEFAULT '',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  verified_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL DEFAULT '',
  source_text TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  error TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'claude-opus-5',
  api_map TEXT NOT NULL DEFAULT '',
  manifest TEXT NOT NULL DEFAULT '',
  creds_enc TEXT NOT NULL DEFAULT '',
  cred_fields TEXT NOT NULL DEFAULT '',
  mcp_key_hash TEXT NOT NULL DEFAULT '',
  mcp_key_hint TEXT NOT NULL DEFAULT '',
  allow_delete INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_projects_user ON projects(user_id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  stage TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_events_project ON events(project_id, id);

CREATE TABLE usage_months (
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  generations INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
