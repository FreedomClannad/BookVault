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
    // PDF 允许头部有少量垃圾（下载器包裹、合并文件）：%PDF- 出现在前 1KB 内即可
    // （PDF 规范亦允许 %PDF- 之前有 junk）；xref 偏移由解析器自行容错
    let pdf_head_len = 1024.min(src.size() as usize);
    let pdf_head = src.read_range(0, pdf_head_len)?;
    if find(&pdf_head, b"%PDF-") {
        return Ok(DetectResult {
            kind: FormatKind::Pdf,
            confidence: if pdf_head.starts_with(b"%PDF-") {
                0.99
            } else {
                0.85
            },
        });
    }

    let head_len = 256.min(src.size() as usize);
    let head = src.read_range(0, head_len)?;

    // UTF-16 BOM 是强签名（Windows 阅读器导出的小说常见）；UTF-32LE BOM
    // 为 FF FE 00 00，需排除（UTF-32 文本不是支持的格式）
    let utf16_bom = (head.starts_with(&[0xFF, 0xFE])
        && !head.starts_with(&[0xFF, 0xFE, 0x00, 0x00]))
        || head.starts_with(&[0xFE, 0xFF]);
    if utf16_bom {
        return Ok(DetectResult {
            kind: FormatKind::Txt,
            confidence: 0.95,
        });
    }

    let is_zip = head.starts_with(b"PK\x03\x04")
        || head.starts_with(b"PK\x05\x06")
        || head.starts_with(b"PK\x07\x08");
    if is_zip {
        if let Ok(zip) = crate::adapters::open_zip(src) {
            // 按条目名区分（mimetype 压缩/不在文件头的 EPUB 用头部字节判不出）：
            // EPUB = OPF 包描述或 container.xml；图片集 = CBZ；都不是则拒绝，
            // 避免把 EPUB 误判成 0 页 CBZ 静默导入
            let names = zip.entry_names();
            let is_epub = names.iter().any(|n| {
                n == "mimetype" || n.ends_with(".opf") || n.starts_with("META-INF/container.xml")
            });
            if is_epub {
                return Ok(DetectResult {
                    kind: FormatKind::Epub,
                    confidence: 0.98,
                });
            }
            if names
                .iter()
                .any(|n| crate::adapters::is_image_name(n.rsplit('/').next().unwrap_or(n)))
            {
                return Ok(DetectResult {
                    kind: FormatKind::Cbz,
                    confidence: 0.9,
                });
            }
            return Err(ParseError::NotSupported);
        }
        // zip 打不开（损坏/超限）：退回头部启发式，让解析器给出具体错误
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

    #[test]
    fn utf16_bom_txt_is_supported() {
        // UTF-16LE：BOM + 交错 NUL——Windows 阅读器导出的常见编码，不能当二进制垃圾拒绝
        let mut le = vec![0xFF, 0xFE];
        for u in "第一章 起点".encode_utf16() {
            le.extend_from_slice(&u.to_le_bytes());
        }
        let r = detect(&MemSource(le), Some("txt")).unwrap();
        assert_eq!(r.kind, FormatKind::Txt);

        let mut be = vec![0xFE, 0xFF];
        for u in "第二章 转折".encode_utf16() {
            be.extend_from_slice(&u.to_be_bytes());
        }
        let r = detect(&MemSource(be), None).unwrap();
        assert_eq!(r.kind, FormatKind::Txt);

        // UTF-32LE BOM（FF FE 00 00）不是支持的格式
        let utf32 = vec![0xFF, 0xFE, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00];
        assert!(detect(&MemSource(utf32), Some("txt")).is_err());
    }

    #[test]
    fn pdf_with_junk_prefix_is_detected() {
        let mut junk = b"<html>saved by downloader\n".to_vec();
        junk.extend_from_slice(b"%PDF-1.7\n1 0 obj\n");
        let r = detect(&MemSource(junk), None).unwrap();
        assert_eq!(r.kind, FormatKind::Pdf);
    }
}
