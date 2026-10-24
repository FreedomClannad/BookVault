//! Bearer token 认证中间件（ADR-006）：token 只存 sha256，绝不落明文。
//! 公开端点：/health 与 /devices/pair（其余全部需要设备 token）。

use crate::state::AppState;
use axum::extract::State;
use axum::http::{header, request::Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug)]
pub struct AuthDevice {
    pub id: String,
    pub name: String,
}

pub fn sha256_hex(input: &str) -> String {
    let d = Sha256::digest(input.as_bytes());
    hex::encode(d)
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let path = req.uri().path();
    if path == "/api/v1/health" || path == "/api/v1/devices/pair" {
        return next.run(req).await;
    }
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_string);
    let Some(token) = token else {
        return unauthorized("missing bearer token");
    };
    let hash = sha256_hex(&token);
    let row = sqlx::query_as::<_, (String, String)>(
        "SELECT id, name FROM devices WHERE token_hash = ?1 AND revoked_at IS NULL",
    )
    .bind(&hash)
    .fetch_optional(state.db())
    .await;
    match row {
        Ok(Some((id, name))) => {
            req.extensions_mut().insert(AuthDevice { id, name });
            next.run(req).await
        }
        Ok(None) => unauthorized("invalid token"),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("{{\"error\":\"db: {e}\"}}"),
        )
            .into_response(),
    }
}

fn unauthorized(msg: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(header::CONTENT_TYPE, "application/json")],
        format!("{{\"error\":\"{msg}\"}}"),
    )
        .into_response()
}
