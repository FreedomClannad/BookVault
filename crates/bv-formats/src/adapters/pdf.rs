//! PDF 适配器（M1.6 spike，ADR-005）：lopdf 提取页数、Info 标题与书签目录。
//! M1 不做文本提取与页面渲染——阅读走前端 pdf.js（ADR-002）。

use crate::error::{ParseError, Result};
use crate::{
    BookContents, BookMetadata, BookParser, BookSource, ParserInfo, ResourceData, ResourceRef,
    TocItem,
};
use lopdf::Object;

pub struct PdfParser;

impl BookParser for PdfParser {
    fn kind(&self) -> crate::FormatKind {
        crate::FormatKind::Pdf
    }

    fn parser_info(&self) -> ParserInfo {
        ParserInfo::current("pdf")
    }

    fn read_metadata(&self, src: &dyn BookSource) -> Result<BookMetadata> {
        let doc = load(src)?;
        let metadata = BookMetadata {
            title: info_title(&doc),
            ..Default::default()
        };
        Ok(metadata)
    }

    fn read_contents(&self, src: &dyn BookSource) -> Result<BookContents> {
        let doc = load(src)?;
        let pages = doc.get_pages().len() as u32;
        // lopdf 的 get_toc 已把书签解析为 { level, title, page }
        let mut toc = Vec::new();
        match doc.get_toc() {
            Ok(t) => {
                for d in t.toc {
                    let title = d.title.trim().to_string();
                    if !title.is_empty() {
                        toc.push(TocItem {
                            title,
                            page: d.page as u32,
                        });
                    }
                }
            }
            Err(_) => { /* 无书签或书签损坏：目录为空，不阻塞解析 */ }
        }
        Ok(BookContents::Document { pages, toc })
    }

    /// PDF 页面渲染在前端 pdf.js，Rust 侧不提供页面资源
    fn get_resource(&self, _src: &dyn BookSource, _r: &ResourceRef) -> Result<ResourceData> {
        Err(ParseError::NotSupported)
    }
}

fn load(src: &dyn BookSource) -> Result<lopdf::Document> {
    let reader = src.seek_reader().ok_or(ParseError::NotSupported)?;
    lopdf::Document::load_from(std::io::BufReader::new(reader)).map_err(|e| ParseError::Corrupted {
        detail: format!("pdf: {e}"),
    })
}

/// Info 字典的 /Title（PDF 文本串编码多样，M1 用 lossy 解码，局限记录于 ADR-005）
fn info_title(doc: &lopdf::Document) -> Option<String> {
    let info_id = match doc.trailer.get(b"Info") {
        Ok(Object::Reference(id)) => *id,
        _ => return None,
    };
    let info = doc.get_object(info_id).ok()?;
    let dict = match info {
        Object::Stream(s) => &s.dict,
        Object::Dictionary(d) => d,
        _ => return None,
    };
    match dict.get(b"Title") {
        Ok(Object::String(bytes, _)) => {
            let t = String::from_utf8_lossy(bytes).trim().to_string();
            (!t.is_empty()).then_some(t)
        }
        _ => None,
    }
}
