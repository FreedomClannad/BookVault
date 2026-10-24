//! BookVault NAS 服务端（M3）：书库中心、设备配对、文件存储与同步。
//! 架构与安全要求见需求 §7/§8/§9 与 Phase 1 计划 §5 M3。

pub mod api;
pub mod auth;
pub mod ssrf;
pub mod state;
pub mod storage;
pub mod sync_log;

pub use state::run;

use axum::routing::{delete, get, post};
use axum::Router;

pub fn build_router(state: state::AppState) -> Router {
    Router::new()
        .route("/api/v1/health", get(api::health))
        .route("/api/v1/devices/pair", post(api::pair_checked))
        .route("/api/v1/devices", get(api::list_devices))
        .route("/api/v1/devices/{id}", delete(api::revoke_device))
        .route(
            "/api/v1/library/items",
            get(api::list_items).post(api::upsert_item),
        )
        .route("/api/v1/library/items/{id}", get(api::get_item))
        .route(
            "/api/v1/library/items/{id}/contents",
            get(api::get_contents),
        )
        .route(
            "/api/v1/library/files/{file_id}/content",
            get(api::download_file).post(api::upload_file),
        )
        .route("/api/v1/sync/changes", get(api::sync_changes))
        .route("/api/v1/sync/ack", post(api::sync_ack))
        .route("/api/v1/progress", post(api::upsert_progress))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::auth_middleware,
        ))
        .with_state(state)
}
