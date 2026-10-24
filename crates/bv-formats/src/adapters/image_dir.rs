//! 图片文件夹适配器（目录型源，不走 BookSource——见 lib.rs 模块说明）。
//!
//! - 扫描根目录一层 + 子目录一层（计划 §5 M1.6），过滤图片扩展名，自然排序。
//! - 内容哈希为「结构哈希」：对 相对路径+文件大小 的有序列表计算 sha256。
//!   比逐文件全量哈希便宜得多；已知局限：同尺寸不同内容的替换检测不到
//!   （记录于 docs/formats/，P1 可升级为逐文件哈希）。
//! - 读取资源时做路径安全校验，拒绝任何越出书根的相对路径。

use crate::adapters::{is_image_name, mime_for, natural_cmp};
use crate::error::{ParseError, Result};
use crate::sha256_of;
use crate::{
    BookContents, BookMetadata, FormatKind, Locator, Page, ParsedBook, ParserInfo, ResourceData,
    ResourceRef,
};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

pub fn parse_directory(root: &Path) -> Result<ParsedBook> {
    let files = list_images(root)?;
    if files.is_empty() {
        return Err(ParseError::NotSupported);
    }

    // 结构哈希：文件名 + 大小 的有序列表
    let mut hasher = Sha256::new();
    for rel in &files {
        hasher.update(rel.as_bytes());
        let size = fs::metadata(resolve(root, rel)?)
            .map_err(ParseError::Io)?
            .len();
        hasher.update(size.to_le_bytes());
    }
    let digest = hasher.finalize();
    let sha256 = sha256_of(&digest);

    let cover = files.first().cloned().map(|id| ResourceRef { id });
    let metadata = BookMetadata {
        title: root
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_string),
        cover_ref: cover,
        ..Default::default()
    };
    let contents = BookContents::Comic {
        pages: files
            .into_iter()
            .enumerate()
            .map(|(i, rel)| Page {
                index: i as u32,
                locator: Locator::FilePath(rel),
            })
            .collect(),
    };
    Ok(ParsedBook {
        kind: FormatKind::ImageDir,
        sha256,
        parser: ParserInfo::current("image_dir"),
        metadata,
        contents,
    })
}

/// 图片相对路径（自然排序后）。根目录一层 + 子目录一层
pub fn list_images(root: &Path) -> Result<Vec<String>> {
    let mut rels: Vec<String> = Vec::new();
    let push = |rels: &mut Vec<String>, root: &Path, p: &Path| -> Result<()> {
        let rel = p.strip_prefix(root).map_err(|_| ParseError::NotSupported)?;
        rels.push(rel.to_string_lossy().replace('\\', "/"));
        Ok(())
    };
    for entry in fs::read_dir(root).map_err(ParseError::Io)? {
        let path = entry.map_err(ParseError::Io)?.path();
        if path.is_dir() {
            for sub in fs::read_dir(&path).map_err(ParseError::Io)? {
                let sp = sub.map_err(ParseError::Io)?.path();
                if sp.is_file() && is_image_name(&sp.to_string_lossy()) {
                    push(&mut rels, root, &sp)?;
                }
            }
        } else if path.is_file() && is_image_name(&path.to_string_lossy()) {
            push(&mut rels, root, &path)?;
        }
    }
    rels.sort_by(|a, b| natural_cmp(a, b));
    Ok(rels)
}

/// 越出书根的相对路径一律拒绝（防御式校验，正常清单不会出现）
fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    if rel.split('/').any(|seg| seg == ".." || seg.is_empty()) {
        return Err(ParseError::Unsafe {
            reason: format!("image path escapes root: {rel}"),
        });
    }
    Ok(root.join(rel))
}

/// 读取图片资源（导入与阅读共用）
pub fn get_image(root: &Path, rel: &str) -> Result<ResourceData> {
    let path = resolve(root, rel)?;
    let bytes = fs::read(&path).map_err(ParseError::Io)?;
    Ok(ResourceData {
        mime: mime_for(rel),
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_escaping_relative_path() {
        assert!(resolve(Path::new("/tmp/x"), "../evil.png").is_err());
        assert!(resolve(Path::new("/tmp/x"), "a//b.png").is_err());
        assert!(resolve(Path::new("/tmp/x"), "ok/b.png").is_ok());
    }
}
