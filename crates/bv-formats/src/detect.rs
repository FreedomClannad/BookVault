//! 格式探测（M0 骨架：仅扩展名初判；M1 扩展为扩展名 + MIME + 文件签名的综合探测）。
//!
//! 需求 §5.1：不能只信任扩展名——真实探测必须校验文件签名（如 ZIP 头 `PK\x03\x04`
//! 后再查 EPUB mimetype、`%PDF` 等），伪装扩展名的样本在 M1 测试矩阵中覆盖。

/// 支持的书籍格式（P0 范围）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FormatKind {
    Epub,
    Txt,
    Pdf,
    Cbz,
    ImageDir,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DetectResult {
    pub kind: FormatKind,
    pub confidence: f32,
}

/// 仅依据扩展名的初判（大小写不敏感）。
pub fn detect_from_extension(ext: &str) -> Option<FormatKind> {
    match ext.to_ascii_lowercase().as_str() {
        "epub" => Some(FormatKind::Epub),
        "txt" => Some(FormatKind::Txt),
        "pdf" => Some(FormatKind::Pdf),
        "cbz" | "zip" => Some(FormatKind::Cbz),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_detection_covers_p0_formats() {
        assert_eq!(detect_from_extension("epub"), Some(FormatKind::Epub));
        assert_eq!(detect_from_extension("TXT"), Some(FormatKind::Txt));
        assert_eq!(detect_from_extension("pdf"), Some(FormatKind::Pdf));
        assert_eq!(detect_from_extension("cbz"), Some(FormatKind::Cbz));
        assert_eq!(detect_from_extension("zip"), Some(FormatKind::Cbz));
    }

    #[test]
    fn unknown_extension_is_rejected() {
        assert_eq!(detect_from_extension("exe"), None);
        assert_eq!(detect_from_extension(""), None);
    }
}
