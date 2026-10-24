//! TXT 适配器：编码检测（chardetng + encoding_rs）+ 流式章节切分。
//!
//! - 编码：BOM 优先，其次 chardetng 猜测（GBK/GB18030/UTF-8 等）。
//! - 章节：分块流式扫描（默认 512KB/块），内存中只保留当前块与未完结行，
//!   输出「章节标题 → 源文件字节区间」映射，阅读时按需读取（需求 §5.1）。
//! - 章节规则与 `packages/shared/src/chapter-rules.ts` 同源，一致性由
//!   `tests/matrix.rs::chapter_rules_mirror` 源码级测试保证（M1.8）。

use crate::error::{ParseError, Result};
use crate::{
    BookContents, BookMetadata, BookParser, BookSource, Chapter, Locator, ParserInfo, ResourceData,
    ResourceRef,
};

const SCAN_CHUNK: usize = 512 * 1024;

pub struct TxtParser;

impl BookParser for TxtParser {
    fn kind(&self) -> crate::FormatKind {
        crate::FormatKind::Txt
    }

    fn parser_info(&self) -> ParserInfo {
        ParserInfo::current("txt")
    }

    fn read_metadata(&self, src: &dyn BookSource) -> Result<BookMetadata> {
        let enc = detect_encoding(src)?;
        let mut meta = BookMetadata {
            title: src.name().map(|n| {
                n.trim_end_matches(".txt")
                    .trim_end_matches(".TXT")
                    .to_string()
            }),
            ..Default::default()
        };
        // 中文占比高时给出语言提示（启发，可被刮削器覆盖）
        let sample = src.read_range(0, 4096.min(src.size() as usize))?;
        let text = enc.decode(&sample).0;
        let cjk = text
            .chars()
            .filter(|c| ('\u{4E00}'..='\u{9FFF}').contains(c))
            .count();
        let total = text.chars().count().max(1);
        if cjk as f64 / total as f64 > 0.2 {
            meta.language = Some("zh".into());
        }
        Ok(meta)
    }

    fn read_contents(&self, src: &dyn BookSource) -> Result<BookContents> {
        let enc = detect_encoding(src)?;
        let chapters = scan_chapters(src, enc)?;
        Ok(BookContents::Novel {
            chapters: chapters
                .into_iter()
                .enumerate()
                .map(|(i, c)| Chapter {
                    id: format!("ch-{i}"),
                    title: c.title,
                    locator: Locator::ByteRange {
                        start: c.start,
                        end: c.end,
                    },
                })
                .collect(),
            encoding: Some(enc.name()),
        })
    }

    /// 资源 id = "ch-{i}"（与 Chapter.id 一致）。重新流式扫描定位区间后按需读取，
    /// 不整本载入；解码为 UTF-8 返回
    fn get_resource(&self, src: &dyn BookSource, r: &ResourceRef) -> Result<ResourceData> {
        let idx: usize =
            r.id.strip_prefix("ch-")
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| ParseError::Corrupted {
                    detail: format!("bad txt resource id: {}", r.id),
                })?;
        let enc = detect_encoding(src)?;
        let chapters = scan_chapters(src, enc)?;
        let ch = chapters.get(idx).ok_or_else(|| ParseError::Corrupted {
            detail: format!("txt chapter out of range: {idx}"),
        })?;
        let raw = src.read_range(ch.start, (ch.end - ch.start) as usize)?;
        let text = enc.decode(&raw).0;
        Ok(ResourceData {
            mime: "text/plain; charset=utf-8".into(),
            bytes: text.into_owned().into_bytes(),
        })
    }
}

/// 编码检测：BOM 优先，其次 chardetng（喂前 64KB 样本）。
/// CJK 歧义消解：chardetng 对纯中文 UTF-8 无 BOM 文件可能猜 GB18030——
/// 若样本严格合法 UTF-8 且含多字节序列则优先 UTF-8（GBK 尾字节落在
/// ASCII 区间，几乎不可能整段通过 UTF-8 校验）。
pub(crate) fn detect_encoding(src: &dyn BookSource) -> Result<&'static encoding_rs::Encoding> {
    let sample_len = 64 * 1024.min(src.size() as usize);
    let sample = src.read_range(0, sample_len)?;
    if let Some((enc, _)) = encoding_rs::Encoding::for_bom(&sample) {
        return Ok(enc);
    }
    let mut det = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    det.feed(&sample, true);
    let guess = det.guess(None, chardetng::Utf8Detection::Allow);
    if guess != encoding_rs::UTF_8 && sample.iter().any(|b| *b >= 0x80) && is_likely_utf8(&sample) {
        return Ok(encoding_rs::UTF_8);
    }
    Ok(guess)
}

/// 严格 UTF-8 校验，容忍采样在多字节序列中间截断（结尾不完整算合法）
fn is_likely_utf8(sample: &[u8]) -> bool {
    match std::str::from_utf8(sample) {
        Ok(_) => true,
        Err(e) => e.error_len().is_none() && e.valid_up_to() > 0,
    }
}

pub(crate) struct RawChapter {
    pub title: Option<String>,
    pub start: u64,
    pub end: u64,
}

/// 流式扫描章节：分块读源，按行解码判断章节标题，记录字节区间
pub(crate) fn scan_chapters(
    src: &dyn BookSource,
    enc: &'static encoding_rs::Encoding,
) -> Result<Vec<RawChapter>> {
    let total = src.size();
    let mut chapters: Vec<RawChapter> = Vec::new();
    let mut current: Option<(Option<String>, u64)> = None; // (title, start)
    let mut pending: Vec<u8> = Vec::new();
    let mut pending_off = 0u64; // pending[0] 对应的文件偏移
    let mut pos = 0u64;

    let handle_line = |bytes: &[u8],
                       line_off: u64,
                       chapters: &mut Vec<RawChapter>,
                       current: &mut Option<(Option<String>, u64)>| {
        let line = if bytes.last() == Some(&b'\r') {
            &bytes[..bytes.len() - 1]
        } else {
            bytes
        };
        let text = enc.decode(line).0;
        if is_chapter_heading(&text) {
            let title = text.trim().to_string();
            if let Some((prev_title, start)) = current.take() {
                chapters.push(RawChapter {
                    title: prev_title,
                    start,
                    end: line_off,
                });
            }
            *current = Some((Some(title), line_off));
        }
    };

    while pos < total {
        let want = SCAN_CHUNK.min((total - pos) as usize);
        let buf = src.read_range(pos, want)?;
        pos += buf.len() as u64;
        pending.extend_from_slice(&buf);

        let mut cursor = 0usize;
        while let Some(rel) = pending[cursor..].iter().position(|b| *b == b'\n') {
            let nl = cursor + rel;
            handle_line(
                &pending[cursor..nl],
                pending_off + cursor as u64,
                &mut chapters,
                &mut current,
            );
            cursor = nl + 1;
        }
        if cursor > 0 {
            pending.drain(..cursor);
            pending_off += cursor as u64;
        }
    }
    // EOF 结尾的最后一段（无换行）
    if !pending.is_empty() {
        handle_line(&pending, pending_off, &mut chapters, &mut current);
    }
    if let Some((title, start)) = current.take() {
        chapters.push(RawChapter {
            title,
            start,
            end: total,
        });
    }
    // 无任何章节标题：整本作为单章
    if chapters.is_empty() {
        chapters.push(RawChapter {
            title: None,
            start: 0,
            end: total,
        });
    }
    Ok(chapters)
}

// ---------- 章节规则（与 packages/shared/src/chapter-rules.ts 同源） ----------

/// 章节标题行的最大长度（字符）；与 TS 侧 MAX_HEADING_LENGTH 一致
pub const MAX_HEADING_LENGTH: usize = 40;
/// 规则 id 清单；与 TS 侧 CHAPTER_RULES 一致（镜像测试校验）
pub const CHAPTER_RULE_IDS: [&str; 3] = ["cn-chapter", "en-chapter", "numeric-heading"];

const CN_NUMERAL: &str = "零一二三四五六七八九十百千万";
const CN_UNIT: &str = "章节卷回部集";
const CN_OPEN: &str = "（(【[";
const CN_CLOSE: &str = "）)】]";

/// 判断一行文本是否为章节标题（先 trim；空行/超长行直接否决）
pub fn is_chapter_heading(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() || t.chars().count() > MAX_HEADING_LENGTH {
        return false;
    }
    cn_chapter(t) || en_chapter(t) || numeric_heading(t)
}

/// /^[（(【\[]?第[零一二三四五六七八九十百千万0-9]{1,12}[章节卷回部集][）)】\]]?\s*\S*/
fn cn_chapter(t: &str) -> bool {
    let mut cs = t.chars().peekable();
    if matches!(cs.peek(), Some(c) if CN_OPEN.contains(*c)) {
        cs.next();
    }
    if cs.next() != Some('第') {
        return false;
    }
    let mut n = 0usize;
    while matches!(cs.peek(), Some(c) if CN_NUMERAL.contains(*c) || c.is_ascii_digit()) {
        cs.next();
        n += 1;
        if n > 12 {
            return false;
        }
    }
    if n == 0 {
        return false;
    }
    matches!(cs.next(), Some(c) if CN_UNIT.contains(c)) && {
        if matches!(cs.peek(), Some(c) if CN_CLOSE.contains(*c)) {
            cs.next();
        }
        true
    }
}

/// /^Chapter\s+\d{1,4}(\.|\s|$)/i
fn en_chapter(t: &str) -> bool {
    let Some(rest) = t
        .strip_prefix("Chapter")
        .or_else(|| t.strip_prefix("CHAPTER"))
    else {
        return false;
    };
    let trimmed = rest.trim_start();
    if trimmed.len() == rest.len() {
        return false; // 要求至少一个空白
    }
    let digits: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() || digits.len() > 4 {
        return false;
    }
    let tail = &trimmed[digits.len()..];
    match tail.chars().next() {
        None => true,
        Some('.') => true,
        Some(c) => c.is_whitespace(),
    }
}

/// /^\d{1,3}[、.．]\s*\S+/
fn numeric_heading(t: &str) -> bool {
    let digits: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() || digits.len() > 3 {
        return false;
    }
    let rest = &t[digits.len()..];
    let Some(sep) = rest.chars().next() else {
        return false;
    };
    if !matches!(sep, '、' | '.' | '．') {
        return false;
    }
    let after = rest[sep.len_utf8()..].trim_start();
    match after.chars().next() {
        Some(c) => !c.is_whitespace(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heading_rules_match_shared_test_vectors() {
        for line in [
            "第一章 初入江湖",
            "第0012章 觉醒",
            "第三卷 大结局",
            "Chapter 5 The Gate",
            "12、夜色",
            "3. 出发",
        ] {
            assert!(is_chapter_heading(line), "should match: {line}");
        }
        for line in [
            "",
            "   ",
            "第二天他醒了，窗外的雨还没有停，屋檐滴水的声音一下一下敲在青石板上，像是谁在数着更漏",
            "他说的是第一章里的内容，但那已经是很多年以前的事了，如今再提起，众人也只是唏嘘不已感慨万千",
        ] {
            assert!(!is_chapter_heading(line), "should NOT match: {line}");
        }
    }

    #[test]
    fn chapter_mixed_case_english() {
        assert!(is_chapter_heading("CHAPTER 12"));
        assert!(is_chapter_heading("Chapter 12"));
        assert!(!is_chapter_heading("Chapter12")); // 无空白分隔
    }
}
