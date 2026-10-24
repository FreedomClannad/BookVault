//! M1 测试矩阵（Phase 1 计划 §6）。
//!
//! 样本由 `scripts/gen-samples.py` 生成（确定性、不入库）；缺失时自动重建。

use bv_formats::adapters::image_dir;
use bv_formats::{detect_path, parse_book, BookContents, FileSource, FormatKind, ParseError};
use std::fs;
use std::io::Write as _;
use std::path::PathBuf;
use std::process::Command;

fn ws_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}

fn samples() -> PathBuf {
    let root = ws_root();
    let marker = root.join("samples/txt/utf8-chapters.txt");
    if !marker.exists() {
        let out = Command::new("python3")
            .arg(root.join("scripts/gen-samples.py"))
            .output()
            .expect("run gen-samples.py");
        assert!(
            out.status.success(),
            "gen-samples failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    root.join("samples")
}

// ---------- 1. 探测 ----------

#[test]
fn detect_formats_by_signature() {
    let s = samples();
    for (file, kind) in [
        ("epub/minimal-epub3.epub", FormatKind::Epub),
        ("pdf/text-bookmarks.pdf", FormatKind::Pdf),
        ("cbz/normal.cbz", FormatKind::Cbz),
        ("txt/utf8-chapters.txt", FormatKind::Txt),
    ] {
        let r = detect_path(&s.join(file)).unwrap_or_else(|e| panic!("{file}: {e}"));
        assert_eq!(r.kind, kind, "{file}");
    }
    // 目录 → 图片文件夹
    let r = detect_path(&s.join("image-dir")).unwrap();
    assert_eq!(r.kind, FormatKind::ImageDir);
}

#[test]
fn detect_disguised_extension_by_signature() {
    let s = samples();
    let tmp = tempfile::tempdir().unwrap();
    // EPUB 伪装成 .txt
    let fake = tmp.path().join("disguised.txt");
    fs::copy(s.join("epub/minimal-epub3.epub"), &fake).unwrap();
    let r = detect_path(&fake).unwrap();
    assert_eq!(r.kind, FormatKind::Epub);
    // CBZ 伪装成 .zip
    let fake = tmp.path().join("disguised.zip");
    fs::copy(s.join("cbz/normal.cbz"), &fake).unwrap();
    let r = detect_path(&fake).unwrap();
    assert_eq!(r.kind, FormatKind::Cbz);
}

// ---------- 2. TXT ----------

#[test]
fn txt_utf8_chapters() {
    let s = samples();
    let book = parse_book(&s.join("txt/utf8-chapters.txt")).unwrap();
    assert_eq!(book.kind, FormatKind::Txt);
    assert_eq!(book.parser.parser, "txt");
    let BookContents::Novel { chapters, encoding } = book.contents else {
        panic!("expected novel");
    };
    assert_eq!(chapters.len(), 3);
    assert!(chapters[0].title.as_deref().unwrap().contains("初入书库"));
    assert_eq!(encoding, Some("UTF-8")); // BOM 无，但 chardetng 猜 UTF-8
    assert_eq!(book.sha256.len(), 64);
}

#[test]
fn txt_gbk_decodes_chinese() {
    let s = samples();
    let book = parse_book(&s.join("txt/gbk-novel.txt")).unwrap();
    let BookContents::Novel { chapters, .. } = book.contents else {
        panic!()
    };
    assert_eq!(chapters.len(), 3);
    // 章节内容按需读取并解码为 UTF-8
    let src = FileSource::open(&s.join("txt/gbk-novel.txt")).unwrap();
    let parser = bv_formats::parser_for(FormatKind::Txt).unwrap();
    let res = parser
        .get_resource(
            &src,
            &bv_formats::ResourceRef {
                id: chapters[0].id.clone(),
            },
        )
        .unwrap();
    let text = String::from_utf8(res.bytes).unwrap();
    assert!(
        text.contains("山不在高"),
        "decoded: {}",
        &text[..text.len().min(60)]
    );
}

#[test]
fn txt_gb18030_rare_characters() {
    let s = samples();
    let book = parse_book(&s.join("txt/gb18030-rare.txt")).unwrap();
    let BookContents::Novel { chapters, .. } = book.contents else {
        panic!()
    };
    assert_eq!(chapters.len(), 4, "第二卷 + 三个第X章");
    assert!(chapters[0].title.as_deref().unwrap().contains("生僻字"));
    let src = FileSource::open(&s.join("txt/gb18030-rare.txt")).unwrap();
    let parser = bv_formats::parser_for(FormatKind::Txt).unwrap();
    let res = parser
        .get_resource(
            &src,
            &bv_formats::ResourceRef {
                id: chapters[0].id.clone(),
            },
        )
        .unwrap();
    let text = String::from_utf8(res.bytes).unwrap();
    assert!(text.contains("喆堃犇"), "rare chars lost");
}

#[test]
fn txt_without_chapters_falls_back_to_single() {
    let s = samples();
    let book = parse_book(&s.join("txt/plain-no-chapters.txt")).unwrap();
    let BookContents::Novel { chapters, .. } = book.contents else {
        panic!()
    };
    assert_eq!(chapters.len(), 1);
    assert!(chapters[0].title.is_none());
}

/// 流式验证：60MB 长文（内存中不整本持有；扫描按 512KB 分块）
#[test]
fn txt_large_file_streaming_scan() {
    let tmp = tempfile::tempdir().unwrap();
    let big = tmp.path().join("big.txt");
    let chapter = "床前明月光，疑是地上霜。".repeat(2000); // ~12KB
    {
        let mut f = fs::File::create(&big).unwrap();
        for i in 1..=5000 {
            // ~60MB：每 250 段一个章节标题
            if i % 250 == 1 {
                writeln!(f, "第{i:04}章 长河落日").unwrap();
            }
            writeln!(f, "{chapter}").unwrap();
        }
    }
    assert!(
        fs::metadata(&big).unwrap().len() > 50 * 1024 * 1024,
        "sample must exceed 50MB"
    );
    let book = parse_book(&big).unwrap();
    let BookContents::Novel { chapters, .. } = book.contents else {
        panic!()
    };
    assert_eq!(chapters.len(), 20, "5000/250 = 20 chapters");
}

// ---------- 3. 章节规则与 packages/shared 的镜像一致性（M1.8） ----------

#[test]
fn chapter_rules_mirror_packages_shared() {
    let ts = fs::read_to_string(ws_root().join("packages/shared/src/chapter-rules.ts")).unwrap();
    for id in bv_formats::adapters::txt::CHAPTER_RULE_IDS {
        assert!(
            ts.contains(&format!("id: \"{id}\"")),
            "rule {id} missing in packages/shared"
        );
    }
    let rust_max = bv_formats::adapters::txt::MAX_HEADING_LENGTH;
    assert!(
        ts.contains(&format!("MAX_HEADING_LENGTH = {rust_max}")),
        "MAX_HEADING_LENGTH drift: rust={rust_max}"
    );
}

// ---------- 4. CBZ / 图片文件夹 ----------

#[test]
fn cbz_normal_and_sort_trap() {
    let s = samples();
    let book = parse_book(&s.join("cbz/normal.cbz")).unwrap();
    let BookContents::Comic { pages } = book.contents else {
        panic!()
    };
    assert_eq!(pages.len(), 12);
    assert!(book.metadata.cover_ref.is_some());

    let book = parse_book(&s.join("cbz/sort-trap.cbz")).unwrap();
    let BookContents::Comic { pages } = book.contents else {
        panic!()
    };
    let names: Vec<String> = pages
        .iter()
        .map(|p| match &p.locator {
            bv_formats::Locator::ZipEntry(n) => n.clone(),
            _ => unreachable!(),
        })
        .collect();
    assert_eq!(
        names,
        [
            "page1.png",
            "page2.png",
            "page3.png",
            "page4.png",
            "page10.png",
            "page11.png",
            "page20.png"
        ]
    );
}

#[test]
fn image_dir_natural_order_and_resource() {
    let s = samples();
    let dir = s.join("image-dir");
    let book = parse_book(&dir).unwrap();
    assert_eq!(book.kind, FormatKind::ImageDir);
    assert_eq!(book.sha256.len(), 64);
    let BookContents::Comic { pages } = book.contents else {
        panic!()
    };
    assert_eq!(pages.len(), 7);
    let first = match &pages[0].locator {
        bv_formats::Locator::FilePath(p) => p.clone(),
        _ => unreachable!(),
    };
    assert_eq!(first, "page1.png");
    let img = image_dir::get_image(&dir, &first).unwrap();
    assert_eq!(img.mime, "image/png");
    assert!(img.bytes.starts_with(b"\x89PNG"));
}

// ---------- 5. EPUB ----------

#[test]
fn epub3_metadata_spine_and_resource() {
    let s = samples();
    let path = s.join("epub/minimal-epub3.epub");
    let book = parse_book(&path).unwrap();
    assert_eq!(book.metadata.title.as_deref(), Some("样例之书（EPUB3）"));
    assert_eq!(book.metadata.language.as_deref(), Some("zh"));
    assert!(!book.metadata.identifiers.is_empty());
    let BookContents::Novel { chapters, .. } = book.contents else {
        panic!()
    };
    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].id, "OEBPS/text/chapter1.xhtml");
    // nav 目录提供章节标题
    assert_eq!(chapters[0].title.as_deref(), Some("第一章"));
    // 按需读取章节资源
    let src = FileSource::open(&path).unwrap();
    let parser = bv_formats::parser_for(FormatKind::Epub).unwrap();
    let res = parser
        .get_resource(
            &src,
            &bv_formats::ResourceRef {
                id: chapters[0].id.clone(),
            },
        )
        .unwrap();
    let text = String::from_utf8(res.bytes).unwrap();
    assert!(text.contains("苔痕上阶绿"));
}

#[test]
fn epub2_ncx_fallback_toc() {
    let s = samples();
    let book = parse_book(&s.join("epub/ncx-only-epub2.epub")).unwrap();
    assert_eq!(
        book.metadata.title.as_deref(),
        Some("样例之书（EPUB2 NCX）")
    );
    let BookContents::Novel { chapters, .. } = book.contents else {
        panic!()
    };
    assert_eq!(chapters.len(), 1);
    assert_eq!(
        chapters[0].title.as_deref(),
        Some("第一章"),
        "title from NCX navMap"
    );
}

// ---------- 6. PDF（lopdf spike，ADR-005） ----------

#[test]
fn pdf_pages_title_and_bookmarks() {
    let s = samples();
    let book = parse_book(&s.join("pdf/text-bookmarks.pdf")).unwrap();
    assert_eq!(book.metadata.title.as_deref(), Some("Sample PDF Document"));
    let BookContents::Document { pages, toc } = book.contents else {
        panic!()
    };
    assert_eq!(pages, 3);
    assert_eq!(toc.len(), 2);
    assert_eq!(toc[0].title, "Chapter 1");
    assert_eq!(toc[0].page, 1);
    assert_eq!(toc[1].page, 2);
}

// ---------- 7. 恶意样本拒绝（需求 §9.3） ----------

#[test]
fn malicious_traversal_rejected() {
    let s = samples();
    let err = parse_book(&s.join("malicious/traversal.cbz")).unwrap_err();
    match err {
        ParseError::Unsafe { reason } => assert!(reason.contains("escapes"), "{reason}"),
        other => panic!("expected Unsafe, got: {other:?}"),
    }
}

#[test]
fn malicious_zip_bomb_rejected() {
    let s = samples();
    let err = parse_book(&s.join("malicious/bomb.cbz")).unwrap_err();
    assert!(
        matches!(err, ParseError::LimitExceeded { .. }),
        "expected LimitExceeded, got: {err:?}"
    );
}

// ---------- 8. parse_book 全格式贯通（parserInfo + sha256） ----------

#[test]
fn parse_book_carries_parser_info_and_hash_for_all_formats() {
    let s = samples();
    for (file, expected_parser) in [
        ("txt/utf8-chapters.txt", "txt"),
        ("cbz/normal.cbz", "cbz"),
        ("epub/minimal-epub3.epub", "epub"),
        ("pdf/text-bookmarks.pdf", "pdf"),
    ] {
        let book = parse_book(&s.join(file)).unwrap();
        assert_eq!(book.parser.parser, expected_parser, "{file}");
        assert!(!book.parser.version.is_empty(), "{file}");
        assert_eq!(book.sha256.len(), 64, "{file}");
        assert!(book.sha256.chars().all(|c| c.is_ascii_hexdigit()), "{file}");
    }
    // 同一文件两次解析哈希一致（进度绑定前提，ADR-003）
    let p = s.join("txt/utf8-chapters.txt");
    assert_eq!(
        parse_book(&p).unwrap().sha256,
        parse_book(&p).unwrap().sha256
    );
}
