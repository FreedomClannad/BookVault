//! 格式探测（需求 §5.1）：扩展名 + 文件签名综合识别，**不以扩展名为准**。
//!
//! 签名规则：
//! - `%PDF-` → PDF
//! - ZIP 头（`PK\x03\x04` 等）→ EPUB（头部含 mimetype=application/epub+zip）或 CBZ
//! - 图片头 → 单图片不是书籍（图片文件夹走 [`detect_path`] 的目录分支）
//! - 无二进制特征 + txt 扩展名 → TXT（低置信度，编码在解析阶段检测）

use crate::adapters::image_dir;
use crate::error::{ParseError, Result};
use crate::{BookSource, FileSource};
use std::path::Path;

/// 支持的书籍格式（P0 范围）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
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

/// 仅依据扩展名的初判（大小写不敏感）；真实识别必须走 [`detect`]
pub fn detect_from_extension(ext: &str) -> Option<FormatKind> {
    match ext.to_ascii_lowercase().as_str() {
        "epub" => Some(FormatKind::Epub),
        "txt" => Some(FormatKind::Txt),
        "pdf" => Some(FormatKind::Pdf),
        "cbz" | "zip" => Some(FormatKind::Cbz),
        _ => None,
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// 综合探测：优先文件签名，扩展名仅作 TXT 的弱提示
pub fn detect(src: &dyn BookSource, extension: Option<&str>) -> Result<DetectResult> {
    let head_len = 256.min(src.size() as usize);
    let head = src.read_range(0, head_len)?;

    if head.starts_with(b"%PDF-") {
        return Ok(DetectResult {
            kind: FormatKind::Pdf,
            confidence: 0.99,
        });
    }

    let is_zip = head.starts_with(b"PK\x03\x04")
        || head.starts_with(b"PK\x05\x06")
        || head.starts_with(b"PK\x07\x08");
    if is_zip {
        // EPUB 规范要求 mimetype 为首个 STORED 条目，头部 256 字节内可见
        if find(&head, b"mimetype") && find(&head, b"application/epub+zip") {
            return Ok(DetectResult {
                kind: FormatKind::Epub,
                confidence: 0.98,
            });
        }
        return Ok(DetectResult {
            kind: FormatKind::Cbz,
            confidence: 0.8,
        });
    }

    // 二进制垃圾（含 NUL）不是文本书
    if head.contains(&0u8) {
        return Err(ParseError::NotSupported);
    }

    match extension.map(str::to_ascii_lowercase).as_deref() {
        Some("txt") => Ok(DetectResult {
            kind: FormatKind::Txt,
            confidence: 0.7,
        }),
        _ => Err(ParseError::NotSupported),
    }
}

/// 路径探测：目录（含图片）→ 图片文件夹；文件 → [`detect`]
pub fn detect_path(path: &Path) -> Result<DetectResult> {
    if path.is_dir() {
        if image_dir::list_images(path)?.is_empty() {
            return Err(ParseError::NotSupported);
        }
        return Ok(DetectResult {
            kind: FormatKind::ImageDir,
            confidence: 0.9,
        });
    }
    let src = FileSource::open(path)?;
    detect(&src, path.extension().and_then(|e| e.to_str()))
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

    /// 内存源，供签名测试
    struct MemSource(Vec<u8>);
    impl BookSource for MemSource {
        fn size(&self) -> u64 {
            self.0.len() as u64
        }
        fn read_range(&self, offset: u64, len: usize) -> Result<Vec<u8>> {
            let s = offset as usize;
            Ok(self.0[s..(s + len).min(self.0.len())].to_vec())
        }
    }

    #[test]
    fn signature_beats_extension() {
        // EPUB 伪装成 .txt：仍按签名识别为 EPUB
        let mut epub_head = Vec::new();
        epub_head.extend_from_slice(b"PK\x03\x04");
        epub_head.extend_from_slice(&[0u8; 26]);
        epub_head.extend_from_slice(b"mimetype");
        epub_head.extend_from_slice(b"application/epub+zip");
        epub_head.extend_from_slice(&[0u8; 64]);
        let r = detect(&MemSource(epub_head), Some("txt")).unwrap();
        assert_eq!(r.kind, FormatKind::Epub);

        // PDF 头
        let r = detect(&MemSource(b"%PDF-1.7 ...".to_vec()), None).unwrap();
        assert_eq!(r.kind, FormatKind::Pdf);

        // 普通文本 + txt 扩展名
        let r = detect(&MemSource("第一章".as_bytes().to_vec()), Some("txt")).unwrap();
        assert_eq!(r.kind, FormatKind::Txt);

        // 含 NUL 的二进制：即使扩展名 txt 也拒绝
        assert!(detect(&MemSource(vec![1, 2, 0, 4]), Some("txt")).is_err());
    }
}
