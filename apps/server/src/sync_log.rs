//! change_log 追加（同步权威，需求 §7.2）：所有写操作记一条单调递增变更。

use sqlx::SqlitePool;

pub async fn append(
    db: &SqlitePool,
    entity: &str,
    entity_id: &str,
    op: &str,
    payload: &serde_json::Value,
    device_id: Option<&str>,
) -> sqlx::Result<i64> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let seq = sqlx::query_scalar::<_, i64>(
        "INSERT INTO change_log (entity, entity_id, op, payload, device_id, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING seq",
    )
    .bind(entity)
    .bind(entity_id)
    .bind(op)
    .bind(payload.to_string())
    .bind(device_id)
    .bind(now)
    .fetch_one(db)
    .await?;
    Ok(seq)
}
