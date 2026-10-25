//! `/api/v1` 端点实现（需求 §8）。认证见 auth.rs（除 health/pair 外全部需 token）。

use crate::auth::AuthDevice;
use crate::state::AppState;
use crate::storage::{self};
use crate::sync_log;
use axum::body::Body;
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path as FsPath;

// ---------- DTO（camelCase，与 packages/shared / bv-protocol 对齐） ----------

#[derive(Deserialize)]
pub struct PairReq {
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairResp {
    pub device_id: String,
    pub token: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkDto {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub language: Option<String>,
    pub identifiers: BTreeMap<String, String>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EditionDto {
    pub id: String,
    pub work_id: String,
    pub label: String,
    pub source: Option<String>,
    pub language: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileMetaDto {
    pub id: String,
    pub edition_id: String,
    pub sha256: String,
    pub size: i64,
    pub format: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemUpsertReq {
    pub work: WorkDto,
    pub edition: EditionDto,
    pub file: Option<FileMetaDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDto {
    pub work: WorkDto,
    pub editions: Vec<EditionDto>,
    pub files: Vec<FileMetaDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressReq {
    pub file_id: String,
    pub content_sha256: String,
    pub location: serde_json::Value,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeDto {
    pub seq: i64,
    pub entity: String,
    pub entity_id: String,
    pub op: String,
    pub payload: serde_json::Value,
    pub device_id: Option<String>,
    pub created_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncQuery {
    pub cursor: i64,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckReq {
    pub last_seq: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn err(status: StatusCode, msg: impl Into<String>) -> Response {
    let msg = msg.into();
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        format!("{{\"error\":\"{}\"}}", msg.replace('"', "'")),
    )
        .into_response()
}

// ---------- 基础 ----------

pub async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

// ---------- 设备 ----------

fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 配对：X-Pairing-Code 与服务端配对码匹配后发放设备 token（只存哈希）
pub async fn pair_checked(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PairReq>,
) -> Response {
    let code = headers
        .get("x-pairing-code")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !constant_time_eq(code, state.pairing_code()) {
        return err(StatusCode::UNAUTHORIZED, "invalid pairing code");
    }
    if req.name.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "device name required");
    }
    use rand::RngCore;
    let mut id_bytes = [0u8; 16];
    let mut token_bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut id_bytes);
    rand::rng().fill_bytes(&mut token_bytes);
    let id = hex::encode(id_bytes);
    let token = hex::encode(token_bytes);
    let token_hash = crate::auth::sha256_hex(&token);
    let res = sqlx::query(
        "INSERT INTO devices (id, name, token_hash, paired_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&id)
    .bind(req.name.trim())
    .bind(&token_hash)
    .bind(now_ms())
    .execute(state.db())
    .await;
    match res {
        Ok(_) => Json(PairResp {
            device_id: id,
            token,
        })
        .into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}")),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDto {
    pub id: String,
    pub name: String,
    pub paired_at: i64,
    pub revoked: bool,
}

pub async fn list_devices(
    State(state): State<AppState>,
    axum::Extension(_me): axum::Extension<AuthDevice>,
) -> Response {
    let rows = sqlx::query_as::<_, (String, String, i64, Option<i64>)>(
        "SELECT id, name, paired_at, revoked_at FROM devices ORDER BY paired_at",
    )
    .fetch_all(state.db())
    .await;
    match rows {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|(id, name, paired_at, revoked_at)| DeviceDto {
                    id,
                    name,
                    paired_at,
                    revoked: revoked_at.is_some(),
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}")),
    }
}

pub async fn revoke_device(
    State(state): State<AppState>,
    axum::Extension(me): axum::Extension<AuthDevice>,
    Path(id): Path<String>,
) -> Response {
    if me.id == id {
        return err(StatusCode::BAD_REQUEST, "cannot revoke self");
    }
    let res = sqlx::query("UPDATE devices SET revoked_at = ?1 WHERE id = ?2")
        .bind(now_ms())
        .bind(&id)
        .execute(state.db())
        .await;
    match res {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}")),
    }
}

// ---------- 书库 ----------

pub async fn upsert_item(
    State(state): State<AppState>,
    axum::Extension(me): axum::Extension<AuthDevice>,
    Json(req): Json<ItemUpsertReq>,
) -> Response {
    let db = state.db();
    let now = now_ms();
    let work_json = serde_json::to_value(&req.work).unwrap_or_default();
    let edition_json = serde_json::to_value(&req.edition).unwrap_or_default();

    let r = sqlx::query(
        "INSERT INTO works (id, title, authors, language, identifiers, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) \
         ON CONFLICT(id) DO UPDATE SET title=?2, authors=?3, language=?4, identifiers=?5, updated_at=?6",
    )
    .bind(&req.work.id)
    .bind(&req.work.title)
    .bind(serde_json::to_string(&req.work.authors).unwrap_or_default())
    .bind(&req.work.language)
    .bind(serde_json::to_string(&req.work.identifiers).unwrap_or_default())
    .bind(now)
    .execute(db)
    .await;
    if let Err(e) = r {
        return err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}"));
    }

    let r = sqlx::query(
        "INSERT INTO editions (id, work_id, label, source, language, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) \
         ON CONFLICT(id) DO UPDATE SET work_id=?2, label=?3, source=?4, language=?5, updated_at=?6",
    )
    .bind(&req.edition.id)
    .bind(&req.edition.work_id)
    .bind(&req.edition.label)
    .bind(&req.edition.source)
    .bind(&req.edition.language)
    .bind(now)
    .execute(db)
    .await;
    if let Err(e) = r {
        return err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}"));
    }

    if let Some(f) = &req.file {
        let storage_rel = format!("files/{}/{}", &f.sha256[..2], f.sha256);
        let r = sqlx::query(
            "INSERT INTO files (id, edition_id, sha256, size, format, name, storage_path, uploaded_by, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT(id) DO UPDATE SET edition_id=?2, sha256=?3, size=?4, format=?5, name=?6, storage_path=?7, uploaded_by=?8",
        )
        .bind(&f.id)
        .bind(&f.edition_id)
        .bind(&f.sha256)
        .bind(f.size)
        .bind(&f.format)
        .bind(&f.name)
        .bind(&storage_rel)
        .bind(&me.id)
        .bind(now)
        .execute(db)
        .await;
        if let Err(e) = r {
            return err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}"));
        }
    }

    let _ = sync_log::append(db, "work", &req.work.id, "upsert", &work_json, Some(&me.id)).await;
    let _ = sync_log::append(
        db,
        "edition",
        &req.edition.id,
        "upsert",
        &edition_json,
        Some(&me.id),
    )
    .await;
    if let Some(f) = &req.file {
        let fj = serde_json::to_value(f).unwrap_or_default();
        let _ = sync_log::append(db, "file", &f.id, "upsert", &fj, Some(&me.id)).await;
    }
    StatusCode::NO_CONTENT.into_response()
}

pub async fn list_items(
    State(state): State<AppState>,
    axum::Extension(_me): axum::Extension<AuthDevice>,
) -> Response {
    match load_all_items(state.db()).await {
        Ok(items) => Json(items).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}")),
    }
}

async fn load_all_items(db: &sqlx::SqlitePool) -> sqlx::Result<Vec<ItemDto>> {
    let works = sqlx::query_as::<_, (String, String, String, Option<String>, String)>(
        "SELECT id, title, authors, language, identifiers FROM works ORDER BY title",
    )
    .fetch_all(db)
    .await?;
    let editions = sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>)>(
        "SELECT id, work_id, label, source, language FROM editions",
    )
    .fetch_all(db)
    .await?;
    let files = sqlx::query_as::<_, (String, String, String, i64, String, String)>(
        "SELECT id, edition_id, sha256, size, format, name FROM files",
    )
    .fetch_all(db)
    .await?;

    let mut out = works
        .into_iter()
        .map(|(id, title, authors, language, identifiers)| ItemDto {
            work: WorkDto {
                id,
                title,
                authors: serde_json::from_str(&authors).unwrap_or_default(),
                language,
                identifiers: serde_json::from_str(&identifiers).unwrap_or_default(),
            },
            editions: Vec::new(),
            files: Vec::new(),
        })
        .collect::<Vec<_>>();
    for ed in editions {
        if let Some(item) = out.iter_mut().find(|i| i.work.id == ed.1) {
            item.editions.push(EditionDto {
                id: ed.0,
                work_id: ed.1,
                label: ed.2,
                source: ed.3,
                language: ed.4,
            });
        }
    }
    for f in files {
        if let Some(item) = out
            .iter_mut()
            .find(|i| i.editions.iter().any(|e| e.id == f.1))
        {
            item.files.push(FileMetaDto {
                id: f.0,
                edition_id: f.1,
                sha256: f.2,
                size: f.3,
                format: f.4,
                name: f.5,
            });
        }
    }
    Ok(out)
}

pub async fn get_item(
    State(state): State<AppState>,
    axum::Extension(_me): axum::Extension<AuthDevice>,
    Path(id): Path<String>,
) -> Response {
    let items = match load_all_items(state.db()).await {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}")),
    };
    match items.into_iter().find(|i| i.work.id == id) {
        Some(item) => Json(item).into_response(),
        None => err(StatusCode::NOT_FOUND, "work not found"),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentsQuery {
    pub file_id: String,
}

/// 服务端复用 bv-formats 解析目录（ADR-002 的收益兑现点）
pub async fn get_contents(
    State(state): State<AppState>,
    axum::Extension(_me): axum::Extension<AuthDevice>,
    Path(_id): Path<String>,
    Query(q): Query<ContentsQuery>,
) -> Response {
    let file = match storage::get_file(state.db(), &q.file_id).await {
        Ok(Some(f)) => f,
        Ok(None) => return err(StatusCode::NOT_FOUND, "file not found"),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}")),
    };
    let path = state.0.data_dir.join(&file.storage_path);
    if !path.exists() {
        return err(StatusCode::NOT_FOUND, "file blob missing on server");
    }
    // 存储路径无扩展名（content-addressed），格式以 DB 记录为准
    let kind = match file.format.as_str() {
        "epub" => bv_formats::FormatKind::Epub,
        "txt" => bv_formats::FormatKind::Txt,
        "pdf" => bv_formats::FormatKind::Pdf,
        "cbz" => bv_formats::FormatKind::Cbz,
        other => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("format not served: {other}"),
            )
        }
    };
    let src = match bv_formats::FileSource::open(&path) {
        Ok(s) => s,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, format!("open: {e}")),
    };
    let parser = match bv_formats::parser_for(kind) {
        Ok(p) => p,
        Err(e) => return err(StatusCode::UNPROCESSABLE_ENTITY, format!("parse: {e}")),
    };
    let (metadata, contents, sha256) = (
        parser.read_metadata(&src),
        parser.read_contents(&src),
        bv_formats::sha256_source(&src),
    );
    let (metadata, contents, sha256) = match (metadata, contents, sha256) {
        (Ok(m), Ok(c), Ok(s)) => (m, c, s),
        (Err(e), _, _) | (_, Err(e), _) => {
            return err(StatusCode::UNPROCESSABLE_ENTITY, format!("parse: {e}"))
        }
        _ => return err(StatusCode::INTERNAL_SERVER_ERROR, "hash failed"),
    };
    Json(serde_json::json!({
        "kind": kind,
        "sha256": sha256,
        "parser": { "parser": parser.parser_info().parser, "version": parser.parser_info().version },
        "metadata": metadata,
        "contents": contents,
    }))
    .into_response()
}

// ---------- 文件传输 ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadQuery {
    pub sha256: String,
    pub size: i64,
    pub format: String,
    pub edition_id: String,
    pub name: String,
}

/// 上传大小上限（2GB；P1 改为配置项）
const MAX_UPLOAD: i64 = 2 * 1024 * 1024 * 1024;

/// 流式上传：body → 临时文件 → 大小/哈希校验 → content-addressed 落盘
/// （需求 §7.2 哈希校验、§9.3 不整体进内存）
pub async fn upload_file(
    State(state): State<AppState>,
    axum::Extension(me): axum::Extension<AuthDevice>,
    Path(file_id): Path<String>,
    Query(q): Query<UploadQuery>,
    req: Request,
) -> Response {
    if q.size <= 0 || q.size > MAX_UPLOAD {
        return err(StatusCode::BAD_REQUEST, "invalid size");
    }
    if q.sha256.len() != 64 {
        return err(StatusCode::BAD_REQUEST, "invalid sha256");
    }
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM editions WHERE id = ?1")
        .bind(&q.edition_id)
        .fetch_one(state.db())
        .await
        .unwrap_or(0);
    if exists == 0 {
        return err(StatusCode::NOT_FOUND, "edition not found");
    }

    let tmp = state.0.data_dir.join(format!("tmp-upload-{file_id}"));
    let (written, hash) = match stream_to_file(req, &tmp, MAX_UPLOAD).await {
        Ok(v) => v,
        Err(msg) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            return err(StatusCode::BAD_REQUEST, msg);
        }
    };
    if written != q.size {
        let _ = tokio::fs::remove_file(&tmp).await;
        return err(
            StatusCode::BAD_REQUEST,
            format!("size mismatch: got {written}, declared {}", q.size),
        );
    }
    if hash != q.sha256.to_lowercase() {
        let _ = tokio::fs::remove_file(&tmp).await;
        return err(
            StatusCode::BAD_REQUEST,
            format!("sha256 mismatch: got {hash}"),
        );
    }

    let dest = storage::content_path(&state.files_dir(), &hash);
    if let Err(e) = storage::ensure_parent(&dest).await {
        return err(StatusCode::INTERNAL_SERVER_ERROR, format!("storage: {e}"));
    }
    if let Err(e) = tokio::fs::rename(&tmp, &dest).await {
        return err(StatusCode::INTERNAL_SERVER_ERROR, format!("storage: {e}"));
    }

    let now = now_ms();
    let storage_rel = format!("files/{}/{}", &hash[..2], hash);
    let r = sqlx::query(
        "INSERT INTO files (id, edition_id, sha256, size, format, name, storage_path, uploaded_by, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
         ON CONFLICT(id) DO UPDATE SET sha256=?3, size=?4, format=?5, name=?6, storage_path=?7, uploaded_by=?8",
    )
    .bind(&file_id)
    .bind(&q.edition_id)
    .bind(&hash)
    .bind(q.size)
    .bind(&q.format)
    .bind(&q.name)
    .bind(&storage_rel)
    .bind(&me.id)
    .bind(now)
    .execute(state.db())
    .await;
    if let Err(e) = r {
        return err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}"));
    }
    let payload = serde_json::json!({
        "id": file_id, "editionId": q.edition_id, "sha256": hash,
        "size": q.size, "format": q.format, "name": q.name,
    });
    let _ = sync_log::append(
        state.db(),
        "file",
        &file_id,
        "upsert",
        &payload,
        Some(&me.id),
    )
    .await;
    Json(FileMetaDto {
        id: file_id,
        edition_id: q.edition_id,
        sha256: hash,
        size: q.size,
        format: q.format,
        name: q.name,
    })
    .into_response()
}

async fn stream_to_file(req: Request, dest: &FsPath, max: i64) -> Result<(i64, String), String> {
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = req.into_body().into_data_stream();
    let mut written: i64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        written += chunk.len() as i64;
        if written > max {
            return Err(format!("upload exceeds limit {max}"));
        }
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|e| e.to_string())?;
    drop(file);
    let hash = storage::sha256_file(dest)
        .await
        .map_err(|e| e.to_string())?;
    Ok((written, hash))
}

/// 下载：支持单段 Range（断点续传基础，需求 §7.2）
pub async fn download_file(
    State(state): State<AppState>,
    axum::Extension(_me): axum::Extension<AuthDevice>,
    Path(file_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let file = match storage::get_file(state.db(), &file_id).await {
        Ok(Some(f)) => f,
        Ok(None) => return err(StatusCode::NOT_FOUND, "file not found"),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}")),
    };
    let path = state.0.data_dir.join(&file.storage_path);
    let meta = match tokio::fs::metadata(&path).await {
        Ok(m) => m,
        Err(_) => return err(StatusCode::NOT_FOUND, "file blob missing"),
    };
    let total = meta.len();

    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_range);
    match range {
        Some((start, end)) => {
            let len = end - start + 1;
            use tokio::io::AsyncReadExt;
            match tokio::fs::File::await_open(&path, start).await {
                Ok(f) => {
                    let stream =
                        tokio_util::io::ReaderStream::with_capacity(f.take(len), 64 * 1024);
                    Response::builder()
                        .status(StatusCode::PARTIAL_CONTENT)
                        .header(header::CONTENT_TYPE, "application/octet-stream")
                        .header(header::ACCEPT_RANGES, "bytes")
                        .header(
                            header::CONTENT_RANGE,
                            format!("bytes {start}-{end}/{total}"),
                        )
                        .header(header::CONTENT_LENGTH, len)
                        .body(Body::from_stream(stream))
                        .unwrap()
                }
                Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "open file failed"),
            }
        }
        None => match tokio::fs::File::open(&path).await {
            Ok(f) => {
                let stream = tokio_util::io::ReaderStream::with_capacity(f, 64 * 1024);
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/octet-stream")
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::CONTENT_LENGTH, total)
                    .body(Body::from_stream(stream))
                    .unwrap()
            }
            Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "open file failed"),
        },
    }
}

fn parse_range(header_value: &str) -> Option<(u64, u64)> {
    let spec = header_value.strip_prefix("bytes=")?;
    let (start_s, end_s) = spec.split_once('-')?;
    if start_s.is_empty() {
        return None; // 后缀范围 P1 再支持
    }
    let start: u64 = start_s.parse().ok()?;
    let end: u64 = if end_s.is_empty() {
        u64::MAX
    } else {
        end_s.parse().ok()?
    };
    Some((start, end))
}

trait FileExt {
    async fn await_open(path: &FsPath, seek_to: u64) -> std::io::Result<tokio::fs::File>;
}

impl FileExt for tokio::fs::File {
    async fn await_open(path: &FsPath, seek_to: u64) -> std::io::Result<tokio::fs::File> {
        use tokio::io::AsyncSeekExt;
        let mut f = tokio::fs::File::open(path).await?;
        f.seek(std::io::SeekFrom::Start(seek_to)).await?;
        Ok(f)
    }
}

// ---------- 同步 ----------

pub async fn sync_changes(
    State(state): State<AppState>,
    axum::Extension(_me): axum::Extension<AuthDevice>,
    Query(q): Query<SyncQuery>,
) -> Response {
    let limit = q.limit.unwrap_or(500).clamp(1, 2000);
    let rows = sqlx::query_as::<_, (i64, String, String, String, String, Option<String>, i64)>(
        "SELECT seq, entity, entity_id, op, payload, device_id, created_at \
         FROM change_log WHERE seq > ?1 ORDER BY seq LIMIT ?2",
    )
    .bind(q.cursor)
    .bind(limit)
    .fetch_all(state.db())
    .await;
    match rows {
        Ok(rows) => {
            let next_cursor = rows.last().map(|r| r.0).unwrap_or(q.cursor);
            let changes: Vec<ChangeDto> = rows
                .into_iter()
                .map(
                    |(seq, entity, entity_id, op, payload, device_id, created_at)| ChangeDto {
                        seq,
                        entity,
                        entity_id,
                        op,
                        payload: serde_json::from_str(&payload).unwrap_or_default(),
                        device_id,
                        created_at,
                    },
                )
                .collect();
            Json(serde_json::json!({ "changes": changes, "nextCursor": next_cursor }))
                .into_response()
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}")),
    }
}

pub async fn sync_ack(
    State(state): State<AppState>,
    axum::Extension(me): axum::Extension<AuthDevice>,
    Json(req): Json<AckReq>,
) -> Response {
    let r = sqlx::query(
        "INSERT INTO acks (device_id, last_seq, acked_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT(device_id) DO UPDATE SET last_seq=?2, acked_at=?3",
    )
    .bind(&me.id)
    .bind(req.last_seq)
    .bind(now_ms())
    .execute(state.db())
    .await;
    match r {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}")),
    }
}

/// 进度按设备存行；冲突保留双方（ADR-008），客户端合并
pub async fn upsert_progress(
    State(state): State<AppState>,
    axum::Extension(me): axum::Extension<AuthDevice>,
    Json(req): Json<ProgressReq>,
) -> Response {
    let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM files WHERE id = ?1")
        .bind(&req.file_id)
        .fetch_one(state.db())
        .await
        .unwrap_or(0);
    if exists == 0 {
        return err(StatusCode::NOT_FOUND, "file not found");
    }
    let r = sqlx::query(
        "INSERT INTO reading_progress (device_id, file_id, content_sha256, location, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(device_id, file_id) DO UPDATE SET \
         content_sha256=?3, location=?4, updated_at=?5",
    )
    .bind(&me.id)
    .bind(&req.file_id)
    .bind(&req.content_sha256)
    .bind(req.location.to_string())
    .bind(req.updated_at)
    .execute(state.db())
    .await;
    if let Err(e) = r {
        return err(StatusCode::INTERNAL_SERVER_ERROR, format!("db: {e}"));
    }
    let payload = serde_json::json!({
        "deviceId": me.id, "fileId": req.file_id,
        "contentSha256": req.content_sha256, "location": req.location,
        "updatedAt": req.updated_at,
    });
    let _ = sync_log::append(
        state.db(),
        "progress",
        &req.file_id,
        "upsert",
        &payload,
        Some(&me.id),
    )
    .await;
    StatusCode::NO_CONTENT.into_response()
}
