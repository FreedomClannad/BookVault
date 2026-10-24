//! CBZ 适配器：zip 条目过滤 + 自然排序 + 封面启发（cover 命名优先，否则首图）。
//! 一律通过 [`SecureZip`](crate::secure_zip::SecureZip) 读取（防穿越/炸弹）。

use crate::adapters::{is_image_name, mime_for, natural_cmp, open_zip};
use crate::error::Result;
use crate::secure_zip::SecureZip;
use crate::{
    BookContents, BookMetadata, BookParser, BookSource, Locator, Page, ParserInfo, ResourceData,
    ResourceRef,
};

pub struct CbzParser;

impl BookParser for CbzParser {
    fn kind(&self) -> crate::FormatKind {
        crate::FormatKind::Cbz
    }

    fn parser_info(&self) -> ParserInfo {
        ParserInfo::current("cbz")
    }

    fn read_metadata(&self, src: &dyn BookSource) -> Result<BookMetadata> {
        let zip = open_zip(src)?;
        let pages = image_entries(&zip);
        Ok(BookMetadata {
            title: src
                .name()
                .map(|n| n.rsplit_once('.').map(|(s, _)| s).unwrap_or(n).to_string()),
            cover_ref: cover_entry(&pages).map(|id| ResourceRef { id }),
            ..Default::default()
        })
    }

    fn read_contents(&self, src: &dyn BookSource) -> Result<BookContents> {
        let zip = open_zip(src)?;
        let pages = image_entries(&zip);
        Ok(BookContents::Comic {
            pages: pages
                .into_iter()
                .enumerate()
                .map(|(i, name)| Page {
                    index: i as u32,
                    locator: Locator::ZipEntry(name),
                })
                .collect(),
        })
    }

    fn get_resource(&self, src: &dyn BookSource, r: &ResourceRef) -> Result<ResourceData> {
        let mut zip = open_zip(src)?;
        let bytes = zip.read_entry(&r.id)?;
        Ok(ResourceData {
            mime: mime_for(&r.id),
            bytes,
        })
    }
}

/// 图片条目（自然排序后）
pub(crate) fn image_entries(zip: &SecureZip<Box<dyn crate::SeekRead>>) -> Vec<String> {
    let mut names: Vec<String> = zip
        .entry_names()
        .iter()
        .filter(|n| is_image_name(n))
        .cloned()
        .collect();
    names.sort_by(|a, b| natural_cmp(a, b));
    names
}

/// 封面启发：cover/thumbnail 命名优先，否则首图
fn cover_entry(pages: &[String]) -> Option<String> {
    pages
        .iter()
        .find(|n| {
            let ln = n.to_ascii_lowercase();
            ln.contains("cover") || ln.contains("thumbnail")
        })
        .or_else(|| pages.first())
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cover_prefers_named_cover() {
        let pages = vec!["page001.png".to_string(), "cover.png".to_string()];
        assert_eq!(cover_entry(&pages).as_deref(), Some("cover.png"));
        let pages = vec!["a.png".to_string(), "b.png".to_string()];
        assert_eq!(cover_entry(&pages).as_deref(), Some("a.png"));
    }
}
