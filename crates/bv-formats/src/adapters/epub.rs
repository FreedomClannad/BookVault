//! EPUB 适配器：container.xml → OPF（metadata + manifest + spine），
//! 目录取 EPUB3 nav（`properties="nav"`）优先、EPUB2 NCX 回退。
//! 一律经 [`SecureZip`](crate::secure_zip::SecureZip) 读取。

use crate::adapters::{mime_for, open_zip};
use crate::error::{ParseError, Result};
use crate::secure_zip::SecureZip;
use crate::{
    BookContents, BookMetadata, BookParser, BookSource, Chapter, Locator, ParserInfo, ResourceData,
    ResourceRef, SeekRead,
};
use quick_xml::events::Event;
use quick_xml::{Reader, XmlVersion};
use std::collections::BTreeMap;

pub struct EpubParser;

impl BookParser for EpubParser {
    fn kind(&self) -> crate::FormatKind {
        crate::FormatKind::Epub
    }

    fn parser_info(&self) -> ParserInfo {
        ParserInfo::current("epub")
    }

    fn read_metadata(&self, src: &dyn BookSource) -> Result<BookMetadata> {
        let mut zip = open_zip(src)?;
        let opf_path = locate_opf(&mut zip)?;
        let opf = read_text_entry(&mut zip, &opf_path)?;
        let parsed = parse_opf(&opf, &parent_dir(&opf_path));
        let mut metadata = parsed.metadata;
        // 封面：cover-image 属性优先，meta name=cover 回退
        if let Some(item) = parsed
            .manifest
            .values()
            .find(|i| i.properties.split_whitespace().any(|p| p == "cover-image"))
        {
            metadata.cover_ref = Some(ResourceRef {
                id: item.resolved_href.clone(),
            });
        } else if let Some(id) = &parsed.cover_meta_id {
            if let Some(item) = parsed.manifest.get(id) {
                metadata.cover_ref = Some(ResourceRef {
                    id: item.resolved_href.clone(),
                });
            }
        }
        Ok(metadata)
    }

    fn read_contents(&self, src: &dyn BookSource) -> Result<BookContents> {
        let mut zip = open_zip(src)?;
        let opf_path = locate_opf(&mut zip)?;
        let opf = read_text_entry(&mut zip, &opf_path)?;
        let parsed = parse_opf(&opf, &parent_dir(&opf_path));
        let toc = build_toc(&mut zip, &parsed, &opf_path);

        let mut chapters = Vec::new();
        for idref in &parsed.spine {
            let Some(item) = parsed.manifest.get(idref) else {
                continue;
            };
            if !item.media_type.contains("xhtml") && !item.media_type.contains("html") {
                continue;
            }
            let href = &item.resolved_href;
            chapters.push(Chapter {
                id: href.clone(),
                title: toc.get(href).cloned(),
                locator: Locator::ZipEntry(href.clone()),
            });
        }
        if chapters.is_empty() {
            return Err(ParseError::Corrupted {
                detail: "epub spine has no readable chapter".into(),
            });
        }
        Ok(BookContents::Novel {
            chapters,
            encoding: None,
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

// ---------- zip 内文本读取 ----------

pub(crate) fn read_text_entry(
    zip: &mut SecureZip<Box<dyn SeekRead>>,
    name: &str,
) -> Result<String> {
    let bytes = zip.read_entry(name)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// container.xml → OPF 路径
pub(crate) fn locate_opf(zip: &mut SecureZip<Box<dyn SeekRead>>) -> Result<String> {
    const CONTAINER: &str = "META-INF/container.xml";
    if !zip.entry_names().iter().any(|n| n == CONTAINER) {
        return Err(ParseError::Corrupted {
            detail: "epub missing META-INF/container.xml".into(),
        });
    }
    let xml = read_text_entry(zip, CONTAINER)?;
    let mut reader = Reader::from_str(&xml);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if e.local_name().as_ref() == "rootfile" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == "full-path" {
                            return Ok(attr.value.into_owned());
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    Err(ParseError::Corrupted {
        detail: "container.xml has no rootfile".into(),
    })
}

// ---------- OPF ----------

#[derive(Debug, Default, Clone)]
pub(crate) struct ManifestItem {
    pub id: String,
    pub resolved_href: String,
    pub media_type: String,
    pub properties: String,
}

#[derive(Debug, Default)]
pub(crate) struct OpfData {
    pub metadata: BookMetadata,
    pub manifest: BTreeMap<String, ManifestItem>,
    pub spine: Vec<String>,
    pub spine_toc: Option<String>,
    pub cover_meta_id: Option<String>,
}

fn parent_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

/// href 相对 OPF 目录解析为 zip 内全路径（去 fragment、处理 ./ 与 ../）
pub(crate) fn resolve_href(base_dir: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    let joined = if base_dir.is_empty() {
        href.to_string()
    } else {
        format!("{base_dir}/{href}")
    };
    let mut parts: Vec<&str> = Vec::new();
    for seg in joined.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

pub(crate) fn parse_opf(xml: &str, opf_dir: &str) -> OpfData {
    let mut data = OpfData::default();
    let mut reader = Reader::from_str(xml);
    #[derive(PartialEq)]
    enum Section {
        None,
        Metadata,
        Manifest,
        Spine,
    }
    let mut section = Section::None;
    let mut meta_field: Option<&'static str> = None;
    let mut ident_key = String::new();
    let mut text_buf = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = e.local_name().as_ref().to_string();
                match name.as_str() {
                    "metadata" => section = Section::Metadata,
                    "manifest" => section = Section::Manifest,
                    "spine" => {
                        section = Section::Spine;
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == "toc" {
                                data.spine_toc = Some(attr.value.into_owned());
                            }
                        }
                    }
                    "title" | "creator" | "language" | "identifier"
                        if section == Section::Metadata =>
                    {
                        meta_field = Some(match name.as_str() {
                            "title" => "title",
                            "creator" => "creator",
                            "language" => "language",
                            _ => "identifier",
                        });
                        ident_key.clear();
                        text_buf.clear();
                        if meta_field == Some("identifier") {
                            for attr in e.attributes().flatten() {
                                let key = attr.key.as_ref();
                                if key == "id" || key.ends_with(":scheme") {
                                    ident_key = attr.value.into_owned();
                                }
                            }
                        }
                    }
                    "item" if section == Section::Manifest => {
                        if let Some(item) = parse_manifest_item(&e, opf_dir) {
                            data.manifest.insert(item.id.clone(), item);
                        }
                    }
                    "itemref" if section == Section::Spine => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == "idref" {
                                data.spine.push(attr.value.into_owned());
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                "item" if section == Section::Manifest => {
                    if let Some(item) = parse_manifest_item(&e, opf_dir) {
                        data.manifest.insert(item.id.clone(), item);
                    }
                }
                "itemref" if section == Section::Spine => {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == "idref" {
                            data.spine.push(attr.value.into_owned());
                        }
                    }
                }
                "meta" if section == Section::Metadata => {
                    let mut name_v = String::new();
                    let mut content_v = String::new();
                    for attr in e.attributes().flatten() {
                        match attr.key.as_ref() {
                            "name" => name_v = attr.value.into_owned(),
                            "content" => content_v = attr.value.into_owned(),
                            _ => {}
                        }
                    }
                    if name_v == "cover" {
                        data.cover_meta_id = Some(content_v);
                    }
                }
                _ => {}
            },
            Ok(Event::Text(t)) => {
                if meta_field.is_some() {
                    text_buf.push_str(&t.xml_content(XmlVersion::default()));
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                "metadata" | "manifest" | "spine" => section = Section::None,
                "title" | "creator" | "language" | "identifier" => {
                    let value = text_buf.trim().to_string();
                    match meta_field.take() {
                        Some("title") => {
                            if data.metadata.title.is_none() && !value.is_empty() {
                                data.metadata.title = Some(value);
                            }
                        }
                        Some("creator") => {
                            if !value.is_empty() {
                                data.metadata.authors.push(value);
                            }
                        }
                        Some("language") => {
                            if data.metadata.language.is_none() && !value.is_empty() {
                                data.metadata.language = Some(value);
                            }
                        }
                        Some("identifier") if !value.is_empty() => {
                            let key = if ident_key.is_empty() {
                                "id".to_string()
                            } else {
                                ident_key.clone()
                            };
                            data.metadata.identifiers.push((key, value));
                        }
                        _ => {}
                    }
                    text_buf.clear();
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => break, // 脏 OPF：尽力返回已收集内容
            _ => {}
        }
    }
    data
}

fn parse_manifest_item(e: &quick_xml::events::BytesStart, opf_dir: &str) -> Option<ManifestItem> {
    let mut id = String::new();
    let mut href = String::new();
    let mut media_type = String::new();
    let mut properties = String::new();
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            "id" => id = attr.value.into_owned(),
            "href" => href = attr.value.into_owned(),
            "media-type" => media_type = attr.value.into_owned(),
            "properties" => properties = attr.value.into_owned(),
            _ => {}
        }
    }
    if id.is_empty() || href.is_empty() {
        return None;
    }
    Some(ManifestItem {
        resolved_href: resolve_href(opf_dir, &href),
        id,
        media_type,
        properties,
    })
}

// ---------- 目录（nav 优先 / NCX 回退） ----------

/// href（zip 全路径，无 fragment）→ 标题
pub(crate) fn build_toc(
    zip: &mut SecureZip<Box<dyn SeekRead>>,
    parsed: &OpfData,
    opf_path: &str,
) -> BTreeMap<String, String> {
    // 1) EPUB3 nav
    if let Some(nav_item) = parsed
        .manifest
        .values()
        .find(|i| i.properties.split_whitespace().any(|p| p == "nav"))
    {
        if let Ok(xml) = read_text_entry(zip, &nav_item.resolved_href) {
            let nav_dir = parent_dir(&nav_item.resolved_href);
            let mut map = BTreeMap::new();
            for (href, title) in parse_nav_links(&xml) {
                map.entry(resolve_href(&nav_dir, &href)).or_insert(title);
            }
            if !map.is_empty() {
                return map;
            }
        }
    }
    // 2) EPUB2 NCX
    if let Some(toc_id) = &parsed.spine_toc {
        if let Some(ncx_item) = parsed.manifest.get(toc_id) {
            if let Ok(xml) = read_text_entry(zip, &ncx_item.resolved_href) {
                let ncx_dir = parent_dir(opf_path);
                let mut map = BTreeMap::new();
                for (src, title) in parse_ncx_points(&xml) {
                    map.entry(resolve_href(&ncx_dir, &src)).or_insert(title);
                }
                return map;
            }
        }
    }
    BTreeMap::new()
}

/// nav 文档中所有 <a href="...">text</a>
fn parse_nav_links(xml: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut reader = Reader::from_str(xml);
    let mut pending_href: Option<String> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.local_name().as_ref() == "a" => {
                for attr in e.attributes().flatten() {
                    if attr.key.as_ref() == "href" {
                        pending_href = Some(attr.value.into_owned());
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if let Some(href) = &pending_href {
                    let title = t.xml_content(XmlVersion::default()).trim().to_string();
                    if !title.is_empty() {
                        out.push((href.clone(), title));
                    }
                }
            }
            Ok(Event::End(e)) if e.local_name().as_ref() == "a" => {
                pending_href = None;
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

/// NCX navPoint：<navLabel><text>t</text></navLabel><content src="..."/>
fn parse_ncx_points(xml: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut reader = Reader::from_str(xml);
    let mut title: Option<String> = None;
    let mut in_label_text = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                "text" => in_label_text = true,
                "content" => {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == "src" {
                            let src = attr.value.into_owned();
                            if let Some(t) = title.take() {
                                out.push((src, t));
                            }
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Text(t)) => {
                if in_label_text {
                    title = Some(t.xml_content(XmlVersion::default()).trim().to_string());
                }
            }
            Ok(Event::End(e)) if e.local_name().as_ref() == "text" => in_label_text = false,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}
