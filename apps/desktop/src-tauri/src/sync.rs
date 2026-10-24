//! NAS 同步引擎（M4）。纯库函数（便于端到端测试），命令层在 lib.rs 包装。
//!
//! 策略（需求 §7.2 / ADR-008）：
//! - push：upsert 作品/版本/文件元数据 → 流式上传文件（哈希校验）→ 上传本机进度；
//! - pull：拉书库元数据 → 下载缺失文件到缓存 → 应用其他设备进度行（按设备保留双方）；
//! - 断网：所有请求失败即返回错误，本地数据与队列不受影响（恢复后重试）。
//!
//! 已知限制（P1）：图片文件夹（目录型）不做 NAS 上传；下载为整文件（无断点续传 UI）。

use crate::db;
use reqwest::Client;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NasConfig {
    pub url: String,
    pub token: String,
    pub device_id: String,
}

impl NasConfig {
    pub fn load(conn: &Connection) -> Option<Self> {
        let v = db::get_setting(conn, "nas_config")?;
        serde_json::from_str(&v).ok()
    }

    pub fn save(conn: &Connection, cfg: &NasConfig) -> Result<(), String> {
        let s = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
        db::set_setting(conn, "nas_config", &s)
    }

    pub fn clear(conn: &Connection) -> Result<(), String> {
        db::set_setting(conn, "nas_config", "")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushReport {
    pub works: usize,
    pub files_uploaded: usize,
    pub files_skipped_dir: usize,
    pub progress_rows: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullReport {
    pub works_upserted: usize,
    pub files_downloaded: usize,
    pub progress_applied: usize,
    pub cursor: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiItem {
    work: ApiWork,
    editions: Vec<ApiEdition>,
    files: Vec<ApiFile>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ApiWork {
    id: String,
    title: String,
    authors: Vec<String>,
    language: Option<String>,
    #[serde(default)]
    identifiers: std::collections::BTreeMap<String, String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ApiEdition {
    id: String,
    work_id: String,
    #[serde(default)]
    label: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ApiFile {
    id: String,
    edition_id: String,
    sha256: String,
    size: i64,
    format: String,
    #[allow(dead_code)]
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairResp {
    device_id: String,
    token: String,
}

fn api(cfg: &NasConfig, path: &str) -> String {
    format!("{}/api/v1{path}", cfg.url.trim_end_matches('/'))
}

/// 配对：换取 token 并持久化
pub async fn pair(
    conn: &Connection,
    base_url: &str,
    code: &str,
    device_name: &str,
) -> Result<NasConfig, String> {
    let client = Client::new();
    let resp = client
        .post(format!(
            "{}/api/v1/devices/pair",
            base_url.trim_end_matches('/')
        ))
        .header("x-pairing-code", code)
        .json(&serde_json::json!({ "name": device_name }))
        .send()
        .await
        .map_err(|e| format!("无法连接 NAS: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("配对失败: HTTP {}", resp.status()));
    }
    let pr: PairResp = resp.json().await.map_err(|e| e.to_string())?;
    let cfg = NasConfig {
        url: base_url.trim_end_matches('/').to_string(),
        token: pr.token,
        device_id: pr.device_id,
    };
    NasConfig::save(conn, &cfg)?;
    Ok(cfg)
}

/// 推送全部本地内容与进度到 NAS
pub async fn push_all(conn: &mut Connection, cfg: &NasConfig) -> Result<PushReport, String> {
    let client = Client::new();
    let auth = format!("Bearer {}", cfg.token);
    let mut report = PushReport {
        works: 0,
        files_uploaded: 0,
        files_skipped_dir: 0,
        progress_rows: 0,
    };

    type Row = (String, String, String, String, String, String, i64, String);
    let rows: Vec<Row> = {
        let mut stmt = conn
            .prepare(
                "SELECT w.id, w.title, w.authors, e.id, f.id, f.path, f.size, f.format \
                 FROM works w JOIN editions e ON e.work_id = w.id \
                 JOIN book_files f ON f.edition_id = e.id WHERE f.origin = 'local'",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };

    for (work_id, title, authors_json, edition_id, file_id, path, size, format) in rows {
        let path = PathBuf::from(&path);
        if path.is_dir() {
            report.files_skipped_dir += 1;
            continue; // 目录型 P1 支持
        }
        if !path.exists() {
            return Err(format!("源文件缺失，无法上传: {}", path.display()));
        }
        let sha = {
            let src = bv_formats::FileSource::open(&path).map_err(|e| e.to_string())?;
            bv_formats::sha256_source(&src).map_err(|e| e.to_string())?
        };
        let authors: Vec<String> = serde_json::from_str(&authors_json).unwrap_or_default();
        let payload = serde_json::json!({
            "work": { "id": work_id, "title": title, "authors": authors, "language": null, "identifiers": {} },
            "edition": { "id": edition_id, "workId": work_id, "label": "默认版本", "source": "local", "language": null },
            "file": { "id": file_id, "editionId": edition_id, "sha256": sha, "size": size, "format": format, "name": title },
        });
        let resp = client
            .post(api(cfg, "/library/items"))
            .header("authorization", &auth)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("上传元数据失败: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "上传元数据失败: HTTP {} {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        report.works += 1;

        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let uri = api(
            cfg,
            &format!(
                "/library/files/{file_id}/content?sha256={sha}&size={size}&format={format}&editionId={edition_id}&name={}",
                urlencode(&title)
            ),
        );
        let resp = client
            .post(&uri)
            .header("authorization", &auth)
            .body(bytes)
            .send()
            .await
            .map_err(|e| format!("上传文件失败: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("上传文件失败: HTTP {}", resp.status()));
        }
        report.files_uploaded += 1;
    }

    // 推送本机进度
    let device_id = db::ensure_device_id(conn)?;
    let progress_rows: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT book_file_id, content_sha256, location FROM reading_progress \
                 WHERE device_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map([&device_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    for (file_id, content_sha, location) in progress_rows {
        let loc: serde_json::Value = serde_json::from_str(&location).unwrap_or_default();
        let resp = client
            .post(api(cfg, "/progress"))
            .header("authorization", &auth)
            .json(&serde_json::json!({
                "fileId": file_id, "contentSha256": content_sha,
                "location": loc, "updatedAt": db::now_ms(),
            }))
            .send()
            .await
            .map_err(|e| format!("上传进度失败: {e}"))?;
        if resp.status().is_success() {
            report.progress_rows += 1;
        }
    }
    Ok(report)
}

/// 拉取书库与进度（文件下载到缓存目录）
pub async fn pull_all(
    conn: &mut Connection,
    cfg: &NasConfig,
    cache_dir: &Path,
) -> Result<PullReport, String> {
    let client = Client::new();
    let auth = format!("Bearer {}", cfg.token);
    let mut report = PullReport {
        works_upserted: 0,
        files_downloaded: 0,
        progress_applied: 0,
        cursor: db::get_setting(conn, "nas_cursor")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
    };

    let resp = client
        .get(api(cfg, "/library/items"))
        .header("authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("无法连接 NAS: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("拉取书库失败: HTTP {}", resp.status()));
    }
    let items: Vec<ApiItem> = resp.json().await.map_err(|e| e.to_string())?;

    let now = db::now_ms();
    for item in items {
        conn.execute(
            "INSERT INTO works (id, title, authors, language, identifiers, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) \
             ON CONFLICT(id) DO UPDATE SET title=?2, authors=?3, updated_at=?6",
            rusqlite::params![
                item.work.id,
                item.work.title,
                serde_json::to_string(&item.work.authors).unwrap_or_default(),
                item.work.language,
                serde_json::to_string(&item.work.identifiers).unwrap_or_default(),
                now
            ],
        )
        .map_err(|e| e.to_string())?;
        for ed in &item.editions {
            conn.execute(
                "INSERT INTO editions (id, work_id, label, source, language, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, 'nas', NULL, ?4, ?4) \
                 ON CONFLICT(id) DO UPDATE SET label=?3, updated_at=?4",
                rusqlite::params![ed.id, ed.work_id, ed.label, now],
            )
            .map_err(|e| e.to_string())?;
        }
        for f in &item.files {
            let ext = match f.format.as_str() {
                "epub" => "epub",
                "txt" => "txt",
                "pdf" => "pdf",
                "cbz" => "cbz",
                _ => "bin",
            };
            let local = cache_dir
                .join("books")
                .join(format!("{}.{}", f.sha256, ext));
            if !local.exists() {
                std::fs::create_dir_all(local.parent().unwrap()).map_err(|e| e.to_string())?;
                let resp = client
                    .get(api(cfg, &format!("/library/files/{}/content", f.id)))
                    .header("authorization", &auth)
                    .send()
                    .await
                    .map_err(|e| format!("下载失败: {e}"))?;
                if !resp.status().is_success() {
                    return Err(format!("下载失败: HTTP {}", resp.status()));
                }
                let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
                std::fs::write(&local, &bytes).map_err(|e| e.to_string())?;
                report.files_downloaded += 1;
            }
            conn.execute(
                "INSERT INTO book_files (id, edition_id, format, origin, path, size, sha256, parser, parser_version, created_at) \
                 VALUES (?1, ?2, ?3, 'nas', ?4, ?5, ?6, 'nas', '', ?7) \
                 ON CONFLICT(id) DO UPDATE SET path=?4, size=?5",
                rusqlite::params![f.id, f.edition_id, f.format, local.to_string_lossy(), f.size, f.sha256, now],
            )
            .map_err(|e| e.to_string())?;
        }
        report.works_upserted += 1;
    }

    // 应用变更流中的其他设备进度
    let resp = client
        .get(api(cfg, &format!("/sync/changes?cursor={}", report.cursor)))
        .header("authorization", &auth)
        .send()
        .await
        .map_err(|e| format!("拉取变更失败: {e}"))?;
    if resp.status().is_success() {
        let changes: serde_json::Value = resp.json().await.unwrap_or_default();
        if let Some(list) = changes["changes"].as_array() {
            for ch in list {
                if ch["entity"] == "progress" {
                    let p = &ch["payload"];
                    let device = p["deviceId"].as_str().unwrap_or_default();
                    let file_id = p["fileId"].as_str().unwrap_or_default();
                    if device.is_empty() || device == cfg.device_id {
                        continue; // 本机进度不回写
                    }
                    let exists: i64 = conn
                        .query_row(
                            "SELECT COUNT(*) FROM book_files WHERE id = ?1",
                            [file_id],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    if exists == 0 {
                        continue;
                    }
                    conn.execute(
                        "INSERT INTO reading_progress (device_id, book_file_id, content_sha256, location, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5) \
                         ON CONFLICT(device_id, book_file_id) DO UPDATE SET \
                         content_sha256=?3, location=?4, updated_at=?5",
                        rusqlite::params![
                            device,
                            file_id,
                            p["contentSha256"].as_str().unwrap_or_default(),
                            p["location"].to_string(),
                            p["updatedAt"].as_i64().unwrap_or(0),
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    report.progress_applied += 1;
                }
            }
        }
        if let Some(next) = changes["nextCursor"].as_i64() {
            report.cursor = next;
            db::set_setting(conn, "nas_cursor", &next.to_string())?;
        }
    }
    Ok(report)
}

fn urlencode(s: &str) -> String {
    // 仅处理查询串里的保守子集（标题）
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "+".to_string(),
            _ => format!("%{:02X}", c as u32 as u8),
        })
        .collect()
}
