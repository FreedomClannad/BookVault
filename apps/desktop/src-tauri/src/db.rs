//! 桌面端本地 SQLite（rusqlite + PRAGMA user_version 版本化迁移，ADR-009）。
//! Schema 与 Phase 1 计划 §4.2 一致（三层模型）。

use rusqlite::Connection;
use std::path::Path;

const MIGRATIONS: [&str; 1] = [r#"
CREATE TABLE IF NOT EXISTS works (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  authors      TEXT NOT NULL DEFAULT '[]',
  description  TEXT,
  language     TEXT,
  identifiers  TEXT NOT NULL DEFAULT '{}',
  cover_file   TEXT,
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
CREATE TABLE IF NOT EXISTS book_files (
  id              TEXT PRIMARY KEY,
  edition_id      TEXT NOT NULL REFERENCES editions(id),
  format          TEXT NOT NULL CHECK (format IN ('epub','txt','pdf','cbz','image_dir')),
  origin          TEXT NOT NULL CHECK (origin IN ('local','nas')),
  path            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  parser          TEXT NOT NULL,
  parser_version  TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE (sha256, path)
);
CREATE TABLE IF NOT EXISTS reading_progress (
  device_id       TEXT NOT NULL,
  book_file_id    TEXT NOT NULL REFERENCES book_files(id),
  content_sha256  TEXT NOT NULL,
  location        TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (device_id, book_file_id)
);
CREATE TABLE IF NOT EXISTS import_tasks (
  id          TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  status      TEXT NOT NULL,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
"#];

pub fn open(db_dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(db_dir).map_err(|e| format!("create db dir: {e}"))?;
    let conn =
        Connection::open(db_dir.join("bookvault.db")).map_err(|e| format!("open db: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("wal: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("fk: {e}"))?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("read version: {e}"))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        if version <= i as i64 {
            conn.execute_batch(sql)
                .map_err(|e| format!("migration {}: {e}", i + 1))?;
            conn.pragma_update(None, "user_version", (i + 1) as i64)
                .map_err(|e| format!("bump version: {e}"))?;
        }
    }
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get(0)
    })
    .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        [key, value],
    )
    .map_err(|e| format!("set setting: {e}"))?;
    Ok(())
}

/// 本地设备 ID（首次生成 ULID 并持久化——进度表主键来源，M2.11）
pub fn ensure_device_id(conn: &Connection) -> Result<String, String> {
    if let Some(id) = get_setting(conn, "device_id") {
        return Ok(id);
    }
    let id = ulid::Ulid::generate().to_string();
    set_setting(conn, "device_id", &id)?;
    Ok(id)
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_run_and_device_id_persists() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(dir.path()).unwrap();
        let id1 = ensure_device_id(&conn).unwrap();
        let id2 = ensure_device_id(&conn).unwrap();
        assert_eq!(id1, id2, "device id must be stable");
        // 二次打开（幂等迁移）
        drop(conn);
        let conn2 = open(dir.path()).unwrap();
        assert_eq!(ensure_device_id(&conn2).unwrap(), id1);
    }
}
