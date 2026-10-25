//! 探测边界用例：zip 系（EPUB/CBZ 按条目名区分）与 PDF 头部容错。
//! 真实世界常见来源：mimetype 被压缩的 EPUB（部分构建工具）、下载器包裹的 PDF。

use std::io::Write;
use std::path::Path;

use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use bv_formats::{detect_path, FormatKind};

fn write_zip(path: &Path, entries: &[(&str, &[u8])], deflate_mimetype: bool) {
    let f = std::fs::File::create(path).unwrap();
    let mut zw = ZipWriter::new(f);
    for (name, data) in entries {
        let mut opts = SimpleFileOptions::default();
        if *name == "mimetype" && deflate_mimetype {
            opts = opts.compression_method(zip::CompressionMethod::Deflated);
        }
        zw.start_file(name, opts).unwrap();
        zw.write_all(data).unwrap();
    }
    zw.finish().unwrap();
}

#[test]
fn epub_with_compressed_mimetype_is_epub() {
    let tmp = tempfile::tempdir().unwrap();
    let p = tmp.path().join("compressed-mimetype.epub");
    write_zip(
        &p,
        &[
            ("mimetype", b"application/epub+zip".as_slice()),
            (
                "content.opf",
                b"<?xml version=\"1.0\"?><package xmlns=\"http://www.idpf.org/2007/opf\"/>",
            ),
            ("c1.xhtml", b"<html><body><p>text</p></body></html>"),
        ],
        true,
    );
    let r = detect_path(&p).unwrap();
    assert_eq!(r.kind, FormatKind::Epub);
}

#[test]
fn zip_with_images_is_cbz() {
    let tmp = tempfile::tempdir().unwrap();
    let p = tmp.path().join("images.zip");
    write_zip(
        &p,
        &[
            ("page1.png", b"fakepng".as_slice()),
            ("page2.png", b"fakepng"),
        ],
        false,
    );
    let r = detect_path(&p).unwrap();
    assert_eq!(r.kind, FormatKind::Cbz);
}

#[test]
fn zip_without_epub_or_images_is_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let p = tmp.path().join("misc.zip");
    write_zip(&p, &[("readme.txt", b"hello".as_slice())], false);
    assert!(
        detect_path(&p).is_err(),
        "非 EPUB 非图片集的 zip 必须拒绝而不是误判 CBZ"
    );
}
