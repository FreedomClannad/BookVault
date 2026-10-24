//! 格式适配器注册表（ADR-002）：每种格式独立实现，互不依赖。

pub mod cbz;
pub mod epub;
pub mod image_dir;
pub mod pdf;
pub mod txt;

use crate::error::{ParseError, Result};
use crate::secure_zip::{SecureZip, ZipLimits};
use crate::{BookParser, BookSource, FormatKind};

/// 从 BookSource 打开安全 zip（EPUB/CBZ 共用；Box<dyn SeekRead> 实现 Read+Seek）
pub(crate) fn open_zip(src: &dyn BookSource) -> Result<SecureZip<Box<dyn crate::SeekRead>>> {
    let reader = src.seek_reader().ok_or(ParseError::NotSupported)?;
    SecureZip::open(reader, ZipLimits::default())
}

/// 按格式取解析器。ImageDir 是目录型源，不走 BookSource，见 [`image_dir::parse_directory`]
pub fn parser_for(kind: FormatKind) -> Result<&'static dyn BookParser> {
    match kind {
        FormatKind::Epub => Ok(&epub::EpubParser),
        FormatKind::Txt => Ok(&txt::TxtParser),
        FormatKind::Pdf => Ok(&pdf::PdfParser),
        FormatKind::Cbz => Ok(&cbz::CbzParser),
        FormatKind::ImageDir => Err(ParseError::NotSupported),
    }
}

/// zip 内图片条目扩展名（CBZ / 图片文件夹共用）
pub(crate) const IMAGE_EXTENSIONS: [&str; 8] =
    ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "jxl"];

pub(crate) fn is_image_name(name: &str) -> bool {
    let ext = name.rsplit('.').next().map(str::to_ascii_lowercase);
    matches!(ext.as_deref(), Some(e) if IMAGE_EXTENSIONS.contains(&e))
}

pub(crate) fn mime_for(name: &str) -> String {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "jxl" => "image/jxl",
        "xhtml" | "html" | "htm" => "application/xhtml+xml",
        "css" => "text/css",
        "js" => "text/javascript",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "svg" => "image/svg+xml",
        "ncx" => "application/x-dtbncx+xml",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// 自然排序比较（`page2 < page10`）；CBZ 与图片文件夹共用。
/// 规则：按「数字段 / 非数字段」分段，数字段按数值比较。
pub(crate) fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    fn next_seg(s: &str) -> (&str, &str, bool) {
        let first = s.chars().next().expect("non-empty checked by caller");
        let is_digit = first.is_ascii_digit();
        let end = s
            .find(|c: char| c.is_ascii_digit() != is_digit)
            .unwrap_or(s.len());
        (&s[..end], &s[end..], is_digit)
    }
    let (mut a, mut b) = (a, b);
    loop {
        match (a.is_empty(), b.is_empty()) {
            (true, true) => return Ordering::Equal,
            (true, false) => return Ordering::Less,
            (false, true) => return Ordering::Greater,
            _ => {}
        }
        let (sa, ra, da) = next_seg(a);
        let (sb, rb, db) = next_seg(b);
        let ord = if da && db {
            // 数值比较：先比去零位数，再逐字符（等长时字典序=数值序）；
            // 值相等时按原串（零填充在前），保证排序稳定确定
            let ta = sa.trim_start_matches('0');
            let tb = sb.trim_start_matches('0');
            ta.len()
                .cmp(&tb.len())
                .then_with(|| ta.cmp(tb))
                .then_with(|| sa.cmp(sb))
        } else {
            sa.cmp(sb)
        };
        if ord != Ordering::Equal {
            return ord;
        }
        a = ra;
        b = rb;
    }
}

#[cfg(test)]
mod tests {
    use super::natural_cmp;
    use std::cmp::Ordering::*;

    #[test]
    fn natural_sort_handles_numeric_trap() {
        assert_eq!(natural_cmp("page2.png", "page10.png"), Less);
        assert_eq!(natural_cmp("page10.png", "page2.png"), Greater);
        assert_eq!(natural_cmp("page001.png", "page1.png"), Less); // 值相等按原串
        assert_eq!(natural_cmp("a1b2", "a1b10"), Less);
        assert_eq!(natural_cmp("page1.png", "page1.png"), Equal);
    }
}
