//! 格式解析统一错误类型（Phase 1 计划 §2.4 草图的落地骨架）。

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("format not supported")]
    NotSupported,
    #[error("corrupted file: {detail}")]
    Corrupted { detail: String },
    /// 路径穿越、压缩炸弹等安全问题；解析结果被主动拒绝
    #[error("unsafe content rejected: {reason}")]
    Unsafe { reason: String },
    #[error("limit exceeded: {what} (max {max})")]
    LimitExceeded { what: &'static str, max: u64 },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, ParseError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display_is_diagnosable() {
        let e = ParseError::Unsafe {
            reason: "zip entry path escapes root: ../evil.txt".into(),
        };
        assert!(e.to_string().contains("zip entry path"));
        let e = ParseError::LimitExceeded {
            what: "total uncompressed size",
            max: 512 * 1024 * 1024,
        };
        assert!(e.to_string().contains("total uncompressed size"));
    }
}
