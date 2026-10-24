//! Content-addressed 文件存储（ADR-007）：`files/<sha256 前 2 位>/<sha256>`，
//! 元数据在 DB，实体在哈希路径；同哈希天然去重。

use sqlx::SqlitePool;
use std::path::{Path, PathBuf};

pub fn content_path(files_dir: &Path, sha256: &str) -> PathBuf {
    files_dir.join(&sha256[..2]).join(sha256)
}

pub async fn ensure_parent(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    Ok(())
}

/// 流式计算文件 sha256（spawn_blocking，避免占用异步线程）
pub async fn sha256_file(path: &Path) -> std::io::Result<String> {
    let p = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        use sha2::Digest;
        let mut f = std::fs::File::open(&p)?;
        let mut hasher = sha2::Sha256::new();
        std::io::copy(&mut f, &mut hasher)?;
        Ok(hex::encode(hasher.finalize()))
    })
    .await
    .map_err(|e| std::io::Error::other(e.to_string()))?
}

/// 供资源端点使用的行
pub struct StoredFile {
    pub id: String,
    pub edition_id: String,
    pub sha256: String,
    pub size: i64,
    pub format: String,
    pub name: String,
    pub storage_path: String,
}

pub async fn get_file(db: &SqlitePool, file_id: &str) -> sqlx::Result<Option<StoredFile>> {
    let row = sqlx::query_as::<_, (String, String, String, i64, String, String, String)>(
        "SELECT id, edition_id, sha256, size, format, name, storage_path \
         FROM files WHERE id = ?1",
    )
    .bind(file_id)
    .fetch_optional(db)
    .await?;
    Ok(row.map(
        |(id, edition_id, sha256, size, format, name, storage_path)| StoredFile {
            id,
            edition_id,
            sha256,
            size,
            format,
            name,
            storage_path,
        },
    ))
}
