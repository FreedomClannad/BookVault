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
        let category = classify(&title, kind_str(parsed.kind));
        let file_id = insert_work_tree(conn, &title, &category, &parsed, &stored_path, is_dir)?;

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
        self.save_cover_bytes(conn, file_id, &bytes, ext)
    }

    /// 把封面字节写入 covers 目录并登记到 works.cover_file
    /// （供解析器封面缓存、前端 PDF 缩略图/TXT 生成封面/手动设置封面共用）
    pub fn save_cover_bytes(
        &self,
        conn: &Connection,
        file_id: &str,
        bytes: &[u8],
        ext: &str,
    ) -> Result<(), String> {
        if bytes.is_empty() {
            return Err("封面内容为空".into());
        }
        if bytes.len() > 10 * 1024 * 1024 {
            return Err("封面超过 10MB".into());
        }
        if !matches!(ext, "png" | "jpg" | "webp" | "gif") {
            return Err(format!("不支持的封面格式: {ext}"));
        }
        let covers = self.data_dir.join("covers");
        std::fs::create_dir_all(&covers).map_err(|e| e.to_string())?;
        let cover_path = covers.join(format!("{file_id}.{ext}"));
        std::fs::write(&cover_path, bytes).map_err(|e| e.to_string())?;
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

    /// 从用户通过系统对话框选择的图片导入封面（路径来源受控：仅限对话框返回值），
    /// 校验扩展名白名单与大小上限，复制进受管 covers 目录。
    pub fn import_cover_file(
        &self,
        conn: &Connection,
        file_id: &str,
        src: &Path,
    ) -> Result<(), String> {
        let ext = src
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") {
            return Err(format!("仅支持 png/jpg/webp 图片，收到: {ext}"));
        }
        let meta = std::fs::metadata(src).map_err(|e| format!("读取图片失败: {e}"))?;
        if meta.len() > 10 * 1024 * 1024 {
            return Err("封面图片超过 10MB".into());
        }
        let bytes = std::fs::read(src).map_err(|e| format!("读取图片失败: {e}"))?;
        let ext = if ext == "jpeg" { "jpg" } else { ext.as_str() };
        self.save_cover_bytes(conn, file_id, &bytes, ext)
    }
}

/// 手动改分类（书架入口）；category 传空串表示「未分类」
pub fn set_work_category(conn: &Connection, work_id: &str, category: &str) -> Result<(), String> {
    if !category.is_empty() && !CATEGORIES.contains(&category) {
        return Err(format!("未知分类: {category}"));
    }
    conn.execute(
        "UPDATE works SET category = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![work_id, category, db::now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 目录展开（拖文件夹 / 导入文件夹入口共用） ----------

/// 视作书籍文件的扩展名（探测层仍按签名复核，这里只做初筛）
const BOOK_EXTENSIONS: [&str; 5] = ["epub", "txt", "pdf", "cbz", "zip"];
/// 目录递归深度上限（防异常深嵌套拖慢导入线程）
const MAX_SCAN_DEPTH: usize = 8;

/// 导入路径展开：文件原样保留；图片文件夹原样保留（整体作为一本漫画）；
/// 其余目录递归收集其中的书籍文件（每文件一本书）。隐藏目录跳过，
/// 符号链接不跟随（防环；导入语义是「复制原件」，链接不在此列）。
/// 输出按路径排序，保证同一批导入的顺序确定（进度提示、测试均依赖）。
pub fn expand_import_paths(paths: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for raw in paths {
        let p = Path::new(raw);
        if p.is_dir() && !is_image_dir(p) {
            collect_book_files(p, 0, &mut out);
        } else {
            out.push(p.to_path_buf());
        }
    }
    out.sort();
    out
}

fn is_image_dir(dir: &Path) -> bool {
    bv_formats::adapters::image_dir::list_images(dir)
        .map(|l| !l.is_empty())
        .unwrap_or(false)
}

fn collect_book_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files = Vec::new();
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if !entry.file_name().to_string_lossy().starts_with('.') {
                subdirs.push(path);
            }
        } else if meta.is_file() {
            let supported = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| BOOK_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
                .unwrap_or(false);
            if supported {
                files.push(path);
            }
        }
    }
    files.sort();
    out.extend(files);
    subdirs.sort();
    for d in subdirs {
        collect_book_files(&d, depth + 1, out);
    }
}

/// 批量删除作品（书架「整理」入口）：事务内按 progress → files → editions → works
/// 顺序清掉三层记录与进度，再清理磁盘文件。返回成功删除的作品数。
///
/// 文件安全（需求 §9/§11.3，不可逆操作由 UI 确认对话框把关）：
/// - 只删受管目录（data_dir/books、data_dir/covers）之内的文件，路径先
///   canonicalize 再校验前缀，防 DB 脏数据指向任意路径；
/// - 图片文件夹是原位引用（导入不复制），DB 记录删除但绝不触碰用户目录；
/// - 用户导入时的原始文件本来就不动（staged_copy 语义，需求 §1.3）。
pub fn delete_works(
    conn: &mut Connection,
    data_dir: &Path,
    work_ids: &[String],
) -> Result<usize, String> {
    let mut removed = 0usize;
    for work_id in work_ids {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM works WHERE id = ?1)",
                [work_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            // 幂等：批量列表与并发修改可能已删过，跳过即可
            tx.commit().map_err(|e| e.to_string())?;
            continue;
        }
        let row: (Option<String>, String) = tx
            .query_row(
                "SELECT (SELECT GROUP_CONCAT(f.path, char(31)) FROM book_files f \
                   JOIN editions e ON e.id = f.edition_id WHERE e.work_id = ?1), \
                  COALESCE((SELECT cover_file FROM works WHERE id = ?1), '')",
                [work_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let paths: Vec<String> = row
            .0
            .unwrap_or_default()
            .split('\u{1f}')
            .map(str::to_string)
            .collect();
        let cover = row.1;
        tx.execute(
            "DELETE FROM reading_progress WHERE book_file_id IN ( \
               SELECT f.id FROM book_files f JOIN editions e ON e.id = f.edition_id \
               WHERE e.work_id = ?1 )",
            [work_id],
        )
        .map_err(|e| e.to_string())?;
        for sql in [
            "DELETE FROM book_files WHERE edition_id IN (SELECT id FROM editions WHERE work_id = ?1)",
            "DELETE FROM editions WHERE work_id = ?1",
            "DELETE FROM works WHERE id = ?1",
        ] {
            tx.execute(sql, [work_id]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        removed += 1;

        // 文件清理放在事务外（DB 已提交）：失败只丢孤儿文件，不再回滚书库记录
        let books_dir = data_dir.join("books");
        let covers_dir = data_dir.join("covers");
        for p in paths {
            if is_inside(&books_dir, std::path::Path::new(&p)) {
                std::fs::remove_file(&p).ok();
            }
        }
        if !cover.is_empty() && is_inside(&covers_dir, std::path::Path::new(&cover)) {
            std::fs::remove_file(&cover).ok();
        }
    }
    Ok(removed)
}

/// 路径 p 是否位于 dir 之内（两边 canonicalize，抵御 `..`/符号链接写入 DB 的脏数据）
fn is_inside(dir: &Path, p: &Path) -> bool {
    let Ok(canonical_dir) = dir.canonicalize() else {
        return false;
    };
    let Ok(canonical_p) = p.canonicalize() else {
        return false; // 文件不存在（此前 staged 副本已丢）→ 无需删除
    };
    canonical_p.starts_with(&canonical_dir)
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

/// 固定分类词表（与前端 categories.ts 保持一致；''=未分类，不入库到此列表）
pub const CATEGORIES: [&str; 10] = [
    "玄幻", "都市", "历史", "武侠", "科幻", "言情", "悬疑", "漫画", "技术", "文档",
];

/// 导入时的自动归类：格式优先（漫画/文档），再按标题关键词匹配。
/// 关键词来自常见中文网文/电子书命名习惯，命中不了就落「未分类」，
/// 用户可随时在书架手动改（set_work_category）。
pub fn classify(title: &str, format: &str) -> String {
    match format {
        "cbz" | "image_dir" => return "漫画".into(),
        "pdf" => {
            if matches_keyword(
                title,
                &[
                    "编程",
                    "Python",
                    "python",
                    "Rust",
                    "rust",
                    "Java",
                    "JavaScript",
                    "TypeScript",
                    "Linux",
                    "入门",
                    "指南",
                    "实战",
                    "架构",
                    "算法",
                    "数据库",
                    "手册",
                    "教程",
                ],
            ) {
                return "技术".into();
            }
            return "文档".into();
        }
        _ => {}
    }
    for (category, keywords) in [
        (
            "技术",
            &[
                "编程",
                "Python",
                "Rust",
                "Java",
                "JavaScript",
                "TypeScript",
                "Linux",
                "入门",
                "指南",
                "实战",
                "架构",
                "算法",
                "数据库",
                "手册",
                "教程",
            ][..],
        ),
        (
            "玄幻",
            &[
                "玄幻",
                "斗破",
                "大道",
                "万古",
                "遮天",
                "完美世界",
                "仙逆",
                "武动",
                "修罗",
                "帝尊",
            ][..],
        ),
        (
            "都市",
            &[
                "都市", "重生", "官", "商途", "校花", "兵王", "赘婿", "神医", "逆袭",
            ][..],
        ),
        (
            "历史",
            &[
                "历史",
                "大明",
                "大唐",
                "大秦",
                "三国",
                "宋朝",
                "明朝",
                "清朝",
                "战国",
                "隋唐",
                "那些事儿",
            ][..],
        ),
        ("武侠", &["武侠", "江湖", "剑客", "侠", "金庸", "古龙"][..]),
        (
            "科幻",
            &[
                "科幻", "星际", "末世", "三体", "星球", "机甲", "宇宙", "未来",
            ][..],
        ),
        ("言情", &["言情", "总裁", "宠婚", "娇妻", "甜宠", "婚"][..]),
        (
            "悬疑",
            &["悬疑", "推理", "侦探", "刑侦", "犯罪", "密室", "罪案"][..],
        ),
    ] {
        if matches_keyword(title, keywords) {
            return category.into();
        }
    }
    String::new()
}

fn matches_keyword(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|k| text.contains(k))
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
    category: &str,
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
        "INSERT INTO works (id, title, authors, description, language, identifiers, category, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
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
            category,
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

pub(crate) fn work_id_of(conn: &Connection, file_id: &str) -> Option<String> {
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

    #[test]
    fn delete_works_removes_rows_and_managed_files_only() {
        ensure_samples();
        let tmp = tempfile::tempdir().unwrap();
        let mut conn = db::open(tmp.path()).unwrap();
        let lib = Library::new(tmp.path());
        let sample = ws_samples("txt/utf8-chapters.txt");
        let res = lib.import(&mut conn, &sample).unwrap();
        let work_id = work_id_of(&conn, &res.file_id).unwrap();
        // 手动生成封面（登记到 covers/）
        let png = [0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
        lib.save_cover_bytes(&conn, &res.file_id, &png, "png")
            .unwrap();
        // 留下一条阅读进度
        conn.execute(
            "INSERT INTO reading_progress (device_id, book_file_id, content_sha256, location, updated_at) \
             VALUES ('dev', ?1, 'sha', '{}', 1)",
            [&res.file_id],
        )
        .unwrap();

        let staged: String = conn
            .query_row(
                "SELECT path FROM book_files WHERE id = ?1",
                [&res.file_id],
                |r| r.get(0),
            )
            .unwrap();
        let cover: String = conn
            .query_row(
                "SELECT cover_file FROM works WHERE id = ?1",
                [&work_id],
                |r| r.get(0),
            )
            .unwrap();

        let removed = delete_works(&mut conn, tmp.path(), std::slice::from_ref(&work_id)).unwrap();
        assert_eq!(removed, 1);
        // 二次删除幂等
        assert_eq!(delete_works(&mut conn, tmp.path(), &[work_id]).unwrap(), 0);
        for table in ["works", "editions", "book_files", "reading_progress"] {
            let n: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0, "{table} should be empty");
        }
        assert!(
            !std::path::Path::new(&staged).exists(),
            "staged copy removed"
        );
        assert!(!std::path::Path::new(&cover).exists(), "cover removed");
        assert!(sample.exists(), "user's original file must survive");
    }

    #[test]
    fn delete_works_never_touches_files_outside_managed_dirs() {
        ensure_samples();
        let tmp = tempfile::tempdir().unwrap();
        let mut conn = db::open(tmp.path()).unwrap();
        let lib = Library::new(tmp.path());
        let res = lib
            .import(&mut conn, &ws_samples("txt/utf8-chapters.txt"))
            .unwrap();
        // 模拟脏数据/原位引用：把文件记录指向受管目录外的外部文件
        let outside = tmp.path().join("outside-book.txt");
        std::fs::write(&outside, b"keep me").unwrap();
        conn.execute(
            "UPDATE book_files SET path = ?2 WHERE id = ?1",
            rusqlite::params![res.file_id, outside.to_string_lossy().to_string()],
        )
        .unwrap();
        let work_id = work_id_of(&conn, &res.file_id).unwrap();
        delete_works(&mut conn, tmp.path(), &[work_id]).unwrap();
        assert!(
            outside.exists(),
            "files outside books/covers must never be deleted"
        );
    }

    #[test]
    fn classify_matches_format_and_title_keywords() {
        assert_eq!(classify("斗破苍穹", "txt"), "玄幻");
        assert_eq!(classify("明朝那些事儿", "epub"), "历史");
        assert_eq!(classify("三体", "txt"), "科幻");
        assert_eq!(classify("Rust 编程指南", "pdf"), "技术");
        assert_eq!(classify("某会议论文", "pdf"), "文档");
        assert_eq!(classify("一拳超人", "cbz"), "漫画");
        assert_eq!(classify("军刀出鞘", "txt"), ""); // 未命中 → 未分类
        assert_eq!(classify("重返都市当兵王", "txt"), "都市");
    }

    #[test]
    fn expand_import_paths_flattens_book_folders() {
        ensure_samples();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // 小说文件夹：递归收集子目录里的书目文件
        std::fs::create_dir_all(root.join("novels/卷一")).unwrap();
        std::fs::write(root.join("novels/书A.txt"), b"a").unwrap();
        std::fs::write(root.join("novels/卷一/书B.txt"), b"b").unwrap();
        std::fs::write(root.join("novels/忽略.exe"), b"x").unwrap();
        std::fs::create_dir_all(root.join("novels/.hidden")).unwrap();
        std::fs::write(root.join("novels/.hidden/隐藏.txt"), b"h").unwrap();
        // 图片文件夹：整体保留为一本书，不展开
        let manga = root.join("manga");
        std::fs::create_dir_all(&manga).unwrap();
        std::fs::write(manga.join("001.jpg"), b"fake").unwrap();
        // 单文件与不存在路径原样保留（错误由导入层统一报告）
        let single = root.join("single.epub");
        std::fs::write(&single, b"e").unwrap();

        let out = expand_import_paths(&[
            root.join("novels").to_string_lossy().to_string(),
            manga.to_string_lossy().to_string(),
            single.to_string_lossy().to_string(),
            "/nonexistent/ghost.txt".into(),
        ]);
        let names: Vec<String> = out
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(
            names,
            vec!["ghost.txt", "manga", "书A.txt", "书B.txt", "single.epub"],
            "按完整路径排序；隐藏目录、非书目扩展名被跳过；图片文件夹保留为整体；不存在路径保留交给导入层报告"
        );
    }

    #[test]
    fn set_work_category_roundtrip_and_validate() {
        ensure_samples();
        let tmp = tempfile::tempdir().unwrap();
        let mut conn = db::open(tmp.path()).unwrap();
        let lib = Library::new(tmp.path());
        let res = lib
            .import(&mut conn, &ws_samples("txt/utf8-chapters.txt"))
            .unwrap();
        let work_id = work_id_of(&conn, &res.file_id).unwrap();
        set_work_category(&conn, &work_id, "玄幻").unwrap();
        let cat: String = conn
            .query_row(
                "SELECT category FROM works WHERE id = ?1",
                [&work_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cat, "玄幻");
        set_work_category(&conn, &work_id, "").unwrap(); // 未分类
        assert!(set_work_category(&conn, &work_id, "不存在的类").is_err());
    }

    #[test]
    fn save_cover_bytes_registers_and_validates() {
        ensure_samples();
        let tmp = tempfile::tempdir().unwrap();
        let mut conn = db::open(tmp.path()).unwrap();
        let lib = Library::new(tmp.path());
        let res = lib
            .import(&mut conn, &ws_samples("txt/utf8-chapters.txt"))
            .unwrap();
        // 非法格式被拒绝
        assert!(
            lib.save_cover_bytes(&conn, &res.file_id, b"x", "exe")
                .is_err()
        );
        // 合法 PNG 登记成功
        let png = [0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
        lib.save_cover_bytes(&conn, &res.file_id, &png, "png")
            .unwrap();
        let cover: String = conn
            .query_row(
                "SELECT COALESCE(cover_file, '') FROM works WHERE id = ( \
                   SELECT e.work_id FROM editions e JOIN book_files f ON f.edition_id = e.id WHERE f.id = ?1 )",
                [&res.file_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(cover.ends_with(&format!("{}.png", res.file_id)));
        assert!(std::path::Path::new(&cover).exists());
    }
}
