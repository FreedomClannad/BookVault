//! BookVault 桌面端 Rust 壳。
//!
//! 命令面（M2/M4）：
//! - 导入/书库：import_paths / list_works / get_work / open_book / get_cover
//! - 资源：get_resource / get_file_bytes（PDF 前端整文件加载）
//! - 进度：save_reading_progress（绑定内容哈希，ADR-003）
//! - 设置：get_settings / set_setting（M2.12）
//! - NAS 同步：nas_pair / nas_status / nas_push / nas_pull（M4）
//! - M0.6 spike：全局快捷键隐藏/恢复 + open_decoy_window（ADR-004）

use crate::library::{ImportedFile, Library};
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri::ipc::Response;

pub mod db;
pub mod library;
pub mod sync;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub data_dir: PathBuf,
}

fn state(app: &tauri::AppHandle) -> tauri::State<'_, AppState> {
    app.state()
}

// ---------- DTO ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkRow {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub has_cover: bool,
    pub files: Vec<FileRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRow {
    pub id: String,
    pub format: String,
    pub name: String,
    pub size: i64,
    pub sha256: String,
    pub origin: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceProgress {
    pub device_id: String,
    pub location: serde_json::Value,
    pub content_sha256: String,
    pub updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedBook {
    pub file: FileRow,
    /// 解析器给出的哈希（当前文件内容）
    pub parsed_sha256: String,
    pub book: bv_formats::ParsedBook,
    /// 各设备进度（含本机）；最新一条用于默认恢复
    pub progress: Vec<DeviceProgress>,
    /// 哈希漂移：DB 记录的哈希与当前文件不一致（进度定位不可靠，UI 必须提示）
    pub hash_drift: bool,
}

// ---------- 导入与书库 ----------

#[tauri::command]
fn import_paths(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<ImportedFile>, String> {
    let st = state(&app);
    let mut conn = st.db.lock().map_err(|e| e.to_string())?;
    let lib = Library::new(&st.data_dir);
    paths
        .iter()
        .map(|p| lib.import(&mut conn, std::path::Path::new(p)))
        .collect()
}

#[tauri::command]
fn list_works(app: tauri::AppHandle) -> Result<Vec<WorkRow>, String> {
    let st = state(&app);
    let conn = st.db.lock().map_err(|e| e.to_string())?;
    let mut works: Vec<(String, String, String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, title, authors, COALESCE(cover_file, '') FROM works ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let mut out = Vec::with_capacity(works.len());
    for (id, title, authors_json, cover) in works.drain(..) {
        let files: Vec<FileRow> = {
            let mut stmt = conn
                .prepare(
                    "SELECT f.id, f.format, f.path, f.size, f.sha256, f.origin \
                     FROM book_files f JOIN editions e ON e.id = f.edition_id \
                     WHERE e.work_id = ?1",
                )
                .map_err(|e| e.to_string())?;
            stmt.query_map([&id], |r| {
                Ok(FileRow {
                    id: r.get(0)?,
                    format: r.get(1)?,
                    name: std::path::Path::new(&r.get::<_, String>(2)?)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string(),
                    size: r.get(3)?,
                    sha256: r.get(4)?,
                    origin: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
        };
        out.push(WorkRow {
            id,
            title,
            authors: serde_json::from_str(&authors_json).unwrap_or_default(),
            has_cover: !cover.is_empty(),
            files,
        });
    }
    Ok(out)
}

/// 打开书籍：源文件丢失给出可诊断错误（M2.9）；哈希漂移置 hash_drift 供 UI 降级
#[tauri::command]
fn open_book(app: tauri::AppHandle, file_id: String) -> Result<OpenedBook, String> {
    let st = state(&app);
    let conn = st.db.lock().map_err(|e| e.to_string())?;
    let (format, path, size, sha256, origin): (String, String, i64, String, String) = conn
        .query_row(
            "SELECT format, path, size, sha256, origin FROM book_files WHERE id = ?1",
            [&file_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| format!("文件记录不存在: {file_id}"))?;
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("源文件丢失或已移动，请重新导入: {path}"));
    }
    let book = bv_formats::parse_book(p).map_err(|e| format!("解析失败: {e}"))?;

    let progress: Vec<DeviceProgress> = {
        let mut stmt = conn
            .prepare(
                "SELECT device_id, location, content_sha256, updated_at FROM reading_progress \
                 WHERE book_file_id = ?1 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map([&file_id], |r| {
            Ok(DeviceProgress {
                device_id: r.get(0)?,
                location: serde_json::from_str(&r.get::<_, String>(1)?).unwrap_or_default(),
                content_sha256: r.get(2)?,
                updated_at: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };
    // 旧哈希的进度定位不可靠：hash_drift 供 UI 弹「文件已变更」让用户选择（ADR-003）
    let hash_drift = progress.iter().any(|pr| pr.content_sha256 != book.sha256);

    Ok(OpenedBook {
        file: FileRow {
            id: file_id,
            format,
            name: p
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string(),
            size,
            sha256,
            origin,
        },
        parsed_sha256: book.sha256.clone(),
        book,
        progress,
        hash_drift,
    })
}

#[tauri::command]
fn get_resource(
    app: tauri::AppHandle,
    file_id: String,
    ref_id: String,
) -> Result<Response, String> {
    let st = state(&app);
    let conn = st.db.lock().map_err(|e| e.to_string())?;
    let (format, path): (String, String) = conn
        .query_row(
            "SELECT format, path FROM book_files WHERE id = ?1",
            [&file_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "文件记录不存在".to_string())?;
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("源文件丢失或已移动: {path}"));
    }
    let kind = match format.as_str() {
        "epub" => bv_formats::FormatKind::Epub,
        "txt" => bv_formats::FormatKind::Txt,
        "cbz" => bv_formats::FormatKind::Cbz,
        _ => return Err(format!("格式不支持按需资源: {format}")),
    };
    let src = bv_formats::FileSource::open(p).map_err(|e| e.to_string())?;
    let parser = bv_formats::parser_for(kind).map_err(|e| e.to_string())?;
    let res = parser
        .get_resource(&src, &bv_formats::ResourceRef { id: ref_id })
        .map_err(|e| e.to_string())?;
    Ok(Response::new(res.bytes))
}

/// 整文件字节（PDF 用 pdf.js 前端渲染）
#[tauri::command]
fn get_file_bytes(app: tauri::AppHandle, file_id: String) -> Result<Response, String> {
    let st = state(&app);
    let conn = st.db.lock().map_err(|e| e.to_string())?;
    let (path,): (String,) = conn
        .query_row(
            "SELECT path FROM book_files WHERE id = ?1",
            [&file_id],
            |r| Ok((r.get(0)?,)),
        )
        .map_err(|_| "文件记录不存在".to_string())?;
    if !std::path::Path::new(&path).exists() {
        return Err(format!("源文件丢失或已移动: {path}"));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn get_cover(app: tauri::AppHandle, work_id: String) -> Result<Response, String> {
    let st = state(&app);
    let conn = st.db.lock().map_err(|e| e.to_string())?;
    let (cover,): (String,) = conn
        .query_row(
            "SELECT cover_file FROM works WHERE id = ?1",
            [&work_id],
            |r| Ok((r.get(0)?,)),
        )
        .map_err(|_| "作品不存在".to_string())?;
    if cover.is_empty() {
        return Err("no cover".into());
    }
    let bytes = std::fs::read(&cover).map_err(|_| "封面缓存缺失".to_string())?;
    Ok(Response::new(bytes))
}

// ---------- 进度 ----------

#[tauri::command]
fn save_reading_progress(
    app: tauri::AppHandle,
    file_id: String,
    location: serde_json::Value,
) -> Result<(), String> {
    let st = state(&app);
    let conn = st.db.lock().map_err(|e| e.to_string())?;
    let device_id = db::ensure_device_id(&conn)?;
    let (sha,): (String,) = conn
        .query_row(
            "SELECT sha256 FROM book_files WHERE id = ?1",
            [&file_id],
            |r| Ok((r.get(0)?,)),
        )
        .map_err(|_| "文件记录不存在".to_string())?;
    conn.execute(
        "INSERT INTO reading_progress (device_id, book_file_id, content_sha256, location, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(device_id, book_file_id) DO UPDATE SET \
         content_sha256=?3, location=?4, updated_at=?5",
        rusqlite::params![device_id, file_id, sha, location.to_string(), db::now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 设置（M2.12） ----------

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let st = state(&app);
    let conn = st.db.lock().map_err(|e| e.to_string())?;
    let mut map = serde_json::Map::new();
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for (k, v) in rows {
        map.insert(k, serde_json::Value::String(v));
    }
    Ok(serde_json::Value::Object(map))
}

#[tauri::command]
fn set_setting(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    if key == "nas_cursor" || key == "device_id" {
        return Err("保留键不允许直接写入".into());
    }
    let st = state(&app);
    let conn = st.db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, &key, &value)
}

// ---------- NAS 同步（M4） ----------

#[tauri::command]
fn nas_pair(app: tauri::AppHandle, url: String, code: String) -> Result<serde_json::Value, String> {
    let st = state(&app);
    let conn = st.db.lock().map_err(|e| e.to_string())?;
    let device_name = hostname();
    let cfg = tauri::async_runtime::block_on(sync::pair(&conn, &url, &code, &device_name))?;
    Ok(serde_json::json!({ "url": cfg.url, "deviceId": cfg.device_id }))
}

#[tauri::command]
fn nas_status(app: tauri::AppHandle) -> serde_json::Value {
    let st = state(&app);
    let Ok(conn) = st.db.lock() else {
        return serde_json::json!(null);
    };
    match sync::NasConfig::load(&conn) {
        Some(cfg) => serde_json::json!({ "url": cfg.url, "deviceId": cfg.device_id }),
        None => serde_json::Value::Null,
    }
}

#[tauri::command]
fn nas_push(app: tauri::AppHandle) -> Result<sync::PushReport, String> {
    let st = state(&app);
    let mut conn = st.db.lock().map_err(|e| e.to_string())?;
    let cfg = sync::NasConfig::load(&conn).ok_or("尚未配对 NAS")?;
    tauri::async_runtime::block_on(sync::push_all(&mut conn, &cfg))
}

#[tauri::command]
fn nas_pull(app: tauri::AppHandle) -> Result<sync::PullReport, String> {
    let st = state(&app);
    let mut conn = st.db.lock().map_err(|e| e.to_string())?;
    let cfg = sync::NasConfig::load(&conn).ok_or("尚未配对 NAS")?;
    let dir = st.data_dir.clone();
    tauri::async_runtime::block_on(sync::pull_all(&mut conn, &cfg, &dir))
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "desktop".into())
}

// ---------- M0.6 spike（ADR-004） ----------

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(true) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

#[tauri::command]
fn open_decoy_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("decoy") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "decoy", tauri::WebviewUrl::App("index.html".into()))
        .title("Terminal")
        .inner_size(720.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["CmdOrCtrl+Shift+B"])
                .expect("failed to register global shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&data_dir).ok();
            let conn = db::open(&data_dir).expect("open local db");
            db::ensure_device_id(&conn).expect("device id");
            app.manage(AppState {
                db: Mutex::new(conn),
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_decoy_window,
            import_paths,
            list_works,
            open_book,
            get_resource,
            get_file_bytes,
            get_cover,
            save_reading_progress,
            get_settings,
            set_setting,
            nas_pair,
            nas_status,
            nas_push,
            nas_pull,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
