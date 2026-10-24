//! bv-formats：BookVault 格式适配层（Phase 1 计划 §2.4、ADR-002）。
//!
//! - 对外统一接口：[`detect`]（综合探测）、[`parse_book`]（一次解析出元数据+目录+哈希）、
//!   [`BookParser`]（按格式的细粒度读取）。
//! - 安全底线（需求 §9.3）：zip 读取一律走 [`secure_zip::SecureZip`]（防穿越/炸弹/超额）；
//!   解析失败不得破坏原文件。
//! - 产出必须携带 [`ParserInfo`] 与源哈希（需求 §5.1、ADR-003）。
//!
//! 图片文件夹是目录型源，不走 [`BookSource`]，见 [`adapters::image_dir`]。

pub mod adapters;
pub mod detect;
pub mod error;
pub mod secure_zip;

pub use adapters::parser_for;
pub use detect::{detect, detect_path, DetectResult, FormatKind};
pub use error::{ParseError, Result};

use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

/// 统一读取抽象（计划 §2.4）：按需读字节区间，避免整本载入内存
pub trait BookSource {
    fn size(&self) -> u64;
    fn read_range(&self, offset: u64, len: usize) -> Result<Vec<u8>>;
    /// 源文件名（元数据标题启发用），默认未知
    fn name(&self) -> Option<&str> {
        None
    }
    /// 可寻址读取句柄（PDF 等「按 xref 随机访问」的格式用），默认不支持
    fn seek_reader(&self) -> Option<Box<dyn SeekRead>> {
        None
    }
}

/// Read + Seek 的 trait 对象
pub trait SeekRead: std::io::Read + std::io::Seek {}
impl<T: std::io::Read + std::io::Seek> SeekRead for T {}

/// 文件实现的 BookSource：按区间打开读取（线程安全；M2 如有性能需求再复用句柄）
pub struct FileSource {
    path: PathBuf,
    size: u64,
}

impl FileSource {
    pub fn open(path: &Path) -> Result<Self> {
        let meta = fs::metadata(path).map_err(ParseError::Io)?;
        if meta.is_dir() {
            return Err(ParseError::NotSupported);
        }
        Ok(Self {
            path: path.to_path_buf(),
            size: meta.len(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl BookSource for FileSource {
    fn size(&self) -> u64 {
        self.size
    }

    fn read_range(&self, offset: u64, len: usize) -> Result<Vec<u8>> {
        use std::io::{Read, Seek, SeekFrom};
        let mut f = fs::File::open(&self.path).map_err(ParseError::Io)?;
        f.seek(SeekFrom::Start(offset)).map_err(ParseError::Io)?;
        let mut buf = Vec::with_capacity(len.min(1 << 20));
        f.take(len as u64)
            .read_to_end(&mut buf)
            .map_err(ParseError::Io)?;
        Ok(buf)
    }

    fn name(&self) -> Option<&str> {
        self.path.file_name().and_then(|n| n.to_str())
    }

    fn seek_reader(&self) -> Option<Box<dyn SeekRead>> {
        fs::File::open(&self.path)
            .ok()
            .map(|f| Box::new(f) as Box<dyn SeekRead>)
    }
}

/// 整源 sha256（导入时一次完成，阅读路径无开销——ADR-003）
pub fn sha256_source(src: &dyn BookSource) -> Result<String> {
    const CHUNK: u64 = 256 * 1024;
    let mut hasher = Sha256::new();
    let mut off = 0u64;
    while off < src.size() {
        let n = CHUNK.min(src.size() - off) as usize;
        let buf = src.read_range(off, n)?;
        hasher.update(&buf);
        off += n as u64;
    }
    Ok(sha256_of(&hasher.finalize()))
}

/// sha256 摘要 → 64 位小写十六进制
pub fn sha256_of(digest: &[u8]) -> String {
    let mut s = String::with_capacity(digest.len() * 2);
    for b in digest {
        let _ = write!(s, "{b:02x}");
    }
    s
}

/// 解析器身份（需求 §5.1：记录解析器名称/版本，便于诊断与迁移）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParserInfo {
    pub parser: &'static str,
    pub version: &'static str,
}

impl ParserInfo {
    pub fn current(parser: &'static str) -> Self {
        Self {
            parser,
            version: env!("CARGO_PKG_VERSION"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ResourceRef {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResourceData {
    pub mime: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct BookMetadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub description: Option<String>,
    pub language: Option<String>,
    /// (scheme/id 类型, 值)，如 ("uid", "urn:uuid:...")
    pub identifiers: Vec<(String, String)>,
    pub cover_ref: Option<ResourceRef>,
}

/// 统一目录（需求 §5.1：适配器输出统一元数据、目录、资源与阅读位置模型）
#[derive(Debug, Clone, PartialEq)]
pub enum BookContents {
    /// 小说（EPUB/TXT）：章节列表 + 文本编码（TXT 按需读取时解码用）
    Novel {
        chapters: Vec<Chapter>,
        encoding: Option<&'static str>,
    },
    /// 漫画（CBZ/图片文件夹）：自然排序后的页面
    Comic { pages: Vec<Page> },
    /// 文档（PDF）：页数 + 书签目录（渲染走前端 pdf.js，M1 不做文本提取）
    Document { pages: u32, toc: Vec<TocItem> },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Chapter {
    pub id: String,
    pub title: Option<String>,
    pub locator: Locator,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    pub index: u32,
    pub locator: Locator,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Locator {
    /// zip 内条目名（EPUB 章节资源 / CBZ 页面）
    ZipEntry(String),
    /// 源文件字节区间 [start, end)（TXT 章节，按需读取）
    ByteRange { start: u64, end: u64 },
    /// 相对于书根的文件路径（图片文件夹）
    FilePath(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct TocItem {
    pub title: String,
    pub page: u32,
}

/// 完整解析结果：[`parse_book`] 的输出
#[derive(Debug, Clone)]
pub struct ParsedBook {
    pub kind: FormatKind,
    /// 源内容哈希（进度绑定用，ADR-003）；图片文件夹为结构哈希（见 docs/formats）
    pub sha256: String,
    pub parser: ParserInfo,
    pub metadata: BookMetadata,
    pub contents: BookContents,
}

/// 按格式细粒度解析接口（计划 §2.4 草图的落地）
pub trait BookParser {
    fn kind(&self) -> FormatKind;
    fn parser_info(&self) -> ParserInfo;
    fn read_metadata(&self, src: &dyn BookSource) -> Result<BookMetadata>;
    fn read_contents(&self, src: &dyn BookSource) -> Result<BookContents>;
    /// 按引用读取资源（封面 / 章节 / 页面）
    fn get_resource(&self, src: &dyn BookSource, r: &ResourceRef) -> Result<ResourceData>;
}

/// 统一入口（M2 导入流水线核心调用）：识别 → 元数据+目录 → 哈希
pub fn parse_book(path: &Path) -> Result<ParsedBook> {
    if path.is_dir() {
        return adapters::image_dir::parse_directory(path);
    }
    let src = FileSource::open(path)?;
    let det = detect(&src, path.extension().and_then(|e| e.to_str()))?;
    let parser = parser_for(det.kind)?;
    let metadata = parser.read_metadata(&src)?;
    let contents = parser.read_contents(&src)?;
    let sha256 = sha256_source(&src)?;
    Ok(ParsedBook {
        kind: det.kind,
        sha256,
        parser: parser.parser_info(),
        metadata,
        contents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_info_carries_crate_version() {
        let info = ParserInfo::current("txt");
        assert_eq!(info.parser, "txt");
        assert!(info.version.starts_with("0."));
    }
}
