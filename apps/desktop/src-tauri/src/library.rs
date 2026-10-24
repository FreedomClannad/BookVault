//! 本地导入流水线（需求 §6.1 的本地子集，M2.1/2.2）：
//! 暂存 → 探测/解析（bv-formats）→ sha256 去重 → 三层入库 → 封面缓存。
//! 导入是同步库函数，Tauri 命令层负责包装与状态管理。

use crate::db;
use bv_formats::{BookContents, FormatKind, ParsedBook};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFile {
    pub work_id: String,
    pub edition_id: String,
    pub file_id: String,
    pub title: String,
    pub format: String,
    pub sha256: String,
    pub duplicate: bool,
}

pub struct Library {
    pub data_dir: PathBuf,
}

impl Library {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
        }
    }

    /// 导入单个文件或目录；sha256 已存在时返回既有条目（duplicate=true，不重复入库）
    pub fn import(&self, conn: &mut Connection, path: &Path) -> Result<ImportedFile, String> {
        let task_id = ulid::Ulid::generate().to_string();
        let now = db::now_ms();
        conn.execute(
            "INSERT INTO import_tasks (id, source_type, status, created_at, updated_at) \
             VALUES (?1, 'local_file', 'running', ?2, ?2)",
            [&task_id, &now.to_string()],
        )
        .map_err(|e| e.to_string())?;

        match self.import_inner(conn, path) {
            Ok(res) => {
                conn.execute(
                    "UPDATE import_tasks SET status='done', updated_at=?2 WHERE id=?1",
                    [&task_id, &db::now_ms().to_string()],
                )
                .ok();
                Ok(res)
            }
            Err(e) => {
                conn.execute(
                    "UPDATE import_tasks SET status='failed', error=?2, updated_at=?3 WHERE id=?1",
                    rusqlite::params![task_id, e, db::now_ms()],
                )
                .ok();
                Err(e)
            }
        }
    }

    fn import_inner(&self, conn: &mut Connection, path: &Path) -> Result<ImportedFile, String> {
        if !path.exists() {
            return Err(format!("文件不存在: {}", path.display()));
        }
        let parsed = bv_formats::parse_book(path)
            .map_err(|e| format!("解析失败（{}）: {e}", path.display()))?;

        // 去重：同哈希已入库则直接返回既有条目
        if let Ok(Some(existing)) = query_file_by_sha(conn, &parsed.sha256) {
            return Ok(ImportedFile {
                work_id: existing.4,
                edition_id: existing.3,
                file_id: existing.0,
                title: existing.5,
                format: existing.6,
                sha256: parsed.sha256,
                duplicate: true,
            });
        }

        let is_dir = path.is_dir();
        let stored_path = if is_dir {
            // 图片文件夹原位引用（移动后打开时报告可诊断错误——M2.9）
            path.to_path_buf()
        } else {
            self.staged_copy(path, &parsed.sha256, parsed.kind)?
        };

        let title = parsed
            .metadata
            .title
            .clone()
            .unwrap_or_else(|| default_title(path));
        let file_id = insert_work_tree(conn, &title, &parsed, &stored_path, is_dir)?;

        // 封面缓存（失败不阻塞导入）
        let _ = self.cache_cover(conn, &file_id, path, &parsed);

        Ok(ImportedFile {
            work_id: work_id_of(conn, &file_id).unwrap_or_default(),
            edition_id: edition_id_of(conn, &file_id).unwrap_or_default(),
            file_id,
            title,
            format: kind_str(parsed.kind).to_string(),
            sha256: parsed.sha256,
            duplicate: false,
        })
    }

    /// 文件类书籍复制到受管目录（原件不动；保留原始文件——需求 §1.3）
    fn staged_copy(&self, src: &Path, sha: &str, kind: FormatKind) -> Result<PathBuf, String> {
        let dir = self.data_dir.join("books");
        std::fs::create_dir_all(&dir).map_err(|e| format!("create books dir: {e}"))?;
        let ext = match kind {
            FormatKind::Epub => "epub",
            FormatKind::Txt => "txt",
            FormatKind::Pdf => "pdf",
            FormatKind::Cbz => "cbz",
            FormatKind::ImageDir => "",
        };
        let dest = dir.join(format!("{sha}.{ext}"));
        if !dest.exists() {
            std::fs::copy(src, &dest).map_err(|e| format!("copy to staging: {e}"))?;
        }
        Ok(dest)
    }

    fn cache_cover(
        &self,
        conn: &Connection,
        file_id: &str,
        src: &Path,
        parsed: &ParsedBook,
    ) -> Result<(), String> {
        let Some(cover_ref) = &parsed.metadata.cover_ref else {
            return Ok(());
        };
        let bytes = read_resource_bytes(src, parsed, cover_ref.id.as_str())?;
        let ext = mime_ext(&bytes);
        let covers = self.data_dir.join("covers");
        std::fs::create_dir_all(&covers).map_err(|e| e.to_string())?;
        let cover_path = covers.join(format!("{file_id}.{ext}"));
        std::fs::write(&cover_path, &bytes).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE works SET cover_file = ?2 WHERE id = ( \
               SELECT w.id FROM works w \
               JOIN editions e ON e.work_id = w.id \
               JOIN book_files f ON f.edition_id = e.id WHERE f.id = ?1 )",
            rusqlite::params![file_id, cover_path.to_string_lossy()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// 通过对应解析器读取资源字节（EPUB/CBZ 走 zip；图片文件夹走文件系统；TXT 走区间）
pub fn read_resource_bytes(
    path: &Path,
    parsed: &ParsedBook,
    ref_id: &str,
) -> Result<Vec<u8>, String> {
    use bv_formats::FileSource;
    if path.is_dir() {
        return bv_formats::adapters::image_dir::get_image(path, ref_id)
            .map(|r| r.bytes)
            .map_err(|e| e.to_string());
    }
    let src = FileSource::open(path).map_err(|e| e.to_string())?;
    let parser = bv_formats::parser_for(parsed.kind).map_err(|e| e.to_string())?;
    parser
        .get_resource(
            &src,
            &bv_formats::ResourceRef {
                id: ref_id.to_string(),
            },
        )
        .map(|r| r.bytes)
        .map_err(|e| e.to_string())
}

fn default_title(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("未命名")
        .to_string()
}

pub fn kind_str(kind: FormatKind) -> &'static str {
    match kind {
        FormatKind::Epub => "epub",
        FormatKind::Txt => "txt",
        FormatKind::Pdf => "pdf",
        FormatKind::Cbz => "cbz",
        FormatKind::ImageDir => "image_dir",
    }
}

fn mime_ext(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "jpg"
    } else if bytes.starts_with(b"GIF8") {
        "gif"
    } else {
        "bin"
    }
}

/// 返回 (file_id, path, sha256, edition_id, work_id, title, format)
type ExistingRow = (String, String, String, String, String, String, String);

fn query_file_by_sha(conn: &Connection, sha: &str) -> Result<Option<ExistingRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT f.id, f.path, f.sha256, f.edition_id, e.work_id, w.title, f.format \
             FROM book_files f JOIN editions e ON e.id = f.edition_id \
             JOIN works w ON w.id = e.work_id WHERE f.sha256 = ?1 LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let row = stmt
        .query_row([sha], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        })
        .ok();
    Ok(row)
}

fn insert_work_tree(
    conn: &mut Connection,
    title: &str,
    parsed: &ParsedBook,
    stored_path: &Path,
    _is_dir: bool,
) -> Result<String, String> {
    let now = db::now_ms();
    let work_id = ulid::Ulid::generate().to_string();
    let edition_id = ulid::Ulid::generate().to_string();
    let file_id = ulid::Ulid::generate().to_string();
    let size = std::fs::metadata(stored_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO works (id, title, authors, description, language, identifiers, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        rusqlite::params![
            work_id,
            title,
            serde_json::to_string(&parsed.metadata.authors).unwrap_or_else(|_| "[]".into()),
            parsed.metadata.description,
            parsed.metadata.language,
            serde_json::to_string(
                &parsed
                    .metadata
                    .identifiers
                    .iter()
                    .cloned()
                    .collect::<std::collections::BTreeMap<String, String>>()
            )
            .unwrap_or_else(|_| "{}".into()),
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO editions (id, work_id, label, source, language, created_at, updated_at) \
         VALUES (?1, ?2, '默认版本', 'local', NULL, ?3, ?3)",
        rusqlite::params![edition_id, work_id, now],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO book_files (id, edition_id, format, origin, path, size, sha256, parser, parser_version, created_at) \
         VALUES (?1, ?2, ?3, 'local', ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            file_id,
            edition_id,
            kind_str(parsed.kind),
            stored_path.to_string_lossy(),
            size,
            parsed.sha256,
            parsed.parser.parser,
            parsed.parser.version,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(file_id)
}

fn work_id_of(conn: &Connection, file_id: &str) -> Option<String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.work_id FROM editions e JOIN book_files f ON f.edition_id = e.id WHERE f.id = ?1",
        )
        .ok()?;
    stmt.query_row([file_id], |r| r.get(0)).ok()
}

fn edition_id_of(conn: &Connection, file_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT edition_id FROM book_files WHERE id = ?1",
        [file_id],
        |r| r.get(0),
    )
    .ok()
}

/// 供 open_book 判断目录型书籍（contents 的 Novel/Comic 分发也用它）
pub fn contents_kind(parsed: &ParsedBook) -> &'static str {
    match parsed.contents {
        BookContents::Novel { .. } => "novel",
        BookContents::Comic { .. } => "comic",
        BookContents::Document { .. } => "document",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws_samples(rel: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../samples")
            .join(rel)
    }

    fn ensure_samples() {
        if !ws_samples("txt/utf8-chapters.txt").exists() {
            let out = std::process::Command::new("python3")
                .arg(
                    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../../../scripts/gen-samples.py"),
                )
                .output()
                .unwrap();
            assert!(out.status.success());
        }
    }

    #[test]
    fn import_txt_creates_three_layer_rows_and_dedupes() {
        ensure_samples();
        let tmp = tempfile::tempdir().unwrap();
        let mut conn = db::open(tmp.path()).unwrap();
        let lib = Library::new(tmp.path());
        let res = lib
            .import(&mut conn, &ws_samples("txt/utf8-chapters.txt"))
            .unwrap();
        assert!(!res.duplicate);
        assert_eq!(res.format, "txt");
        // 二次导入同文件 → duplicate
        let res2 = lib
            .import(&mut conn, &ws_samples("txt/utf8-chapters.txt"))
            .unwrap();
        assert!(res2.duplicate);
        assert_eq!(res.file_id, res2.file_id);
        // 三层行数
        let (w, e, f): (i64, i64, i64) = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM works), (SELECT COUNT(*) FROM editions), (SELECT COUNT(*) FROM book_files)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((w, e, f), (1, 1, 1));
    }
}
