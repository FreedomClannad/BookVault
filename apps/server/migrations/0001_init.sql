-- BookVault server schema 0001（三层模型：works 1—N editions 1—N files）
CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  paired_at   INTEGER NOT NULL,
  revoked_at  INTEGER
);

CREATE TABLE IF NOT EXISTS works (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  authors      TEXT NOT NULL DEFAULT '[]',
  language     TEXT,
  identifiers  TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS editions (
  id          TEXT PRIMARY KEY,
  work_id     TEXT NOT NULL REFERENCES works(id),
  label       TEXT NOT NULL DEFAULT '',
  source      TEXT,
  language    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  edition_id    TEXT NOT NULL REFERENCES editions(id),
  sha256        TEXT NOT NULL UNIQUE,
  size          INTEGER NOT NULL,
  format        TEXT NOT NULL,
  name          TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  uploaded_by   TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_progress (
  device_id       TEXT NOT NULL,
  file_id         TEXT NOT NULL REFERENCES files(id),
  content_sha256  TEXT NOT NULL,
  location        TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (device_id, file_id)
);

-- 同步权威：服务端单调序号（需求 §7.2）
CREATE TABLE IF NOT EXISTS change_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  op          TEXT NOT NULL,
  payload     TEXT NOT NULL,
  device_id   TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS acks (
  device_id  TEXT PRIMARY KEY,
  last_seq   INTEGER NOT NULL,
  acked_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_changes_seq ON change_log(seq);
