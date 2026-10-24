//! bv-protocol：`/api/v1` DTO 定义。
//!
//! 字段与 `packages/shared/src/domain.ts` 手工对齐（计划 §2.3，M1 起加一致性镜像测试）。
//! JSON 序列化格式即线格式：`ReadingLocation` 用 `type` 标签的 tag 形态，
//! 与 TS 侧判别联合 `{ type: "chapter" | "page" | "comic" }` 一致。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default)]
    pub identifiers: BTreeMap<String, String>,
}

/// 内容版本（三层模型：Work 1—N Edition 1—N BookFile，计划 §4.1）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Edition {
    pub id: String,
    pub work_id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum BookFormat {
    Epub,
    Txt,
    Pdf,
    Cbz,
    ImageDir,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookFile {
    pub id: String,
    pub edition_id: String,
    pub format: BookFormat,
    pub origin: BookFileOrigin,
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub parser: String,
    pub parser_version: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BookFileOrigin {
    Local,
    Nas,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ReadingLocation {
    Chapter {
        chapter_id: String,
        progress: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor: Option<String>,
    },
    Page {
        page_index: u32,
    },
    Comic {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        chapter_id: Option<String>,
        image_index: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub device_id: String,
    pub book_file_id: String,
    /// 进度绑定文件版本（需求 §5.3），失配时客户端必须降级处理
    pub content_sha256: String,
    pub location: ReadingLocation,
    pub updated_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 线格式契约：TS 侧依赖这些 JSON 形状，改动必须双侧同步
    #[test]
    fn reading_location_wire_format_matches_ts_discriminated_union() {
        let loc = ReadingLocation::Chapter {
            chapter_id: "ch-1".into(),
            progress: 0.42,
            anchor: None,
        };
        let json = serde_json::to_value(&loc).unwrap();
        assert_eq!(json["type"], "chapter");
        assert_eq!(json["chapterId"], "ch-1");

        let loc = ReadingLocation::Comic {
            chapter_id: None,
            image_index: 7,
        };
        let json = serde_json::to_value(&loc).unwrap();
        assert_eq!(json["type"], "comic");
        assert_eq!(json["imageIndex"], 7);

        let loc = ReadingLocation::Page { page_index: 12 };
        let json = serde_json::to_value(&loc).unwrap();
        assert_eq!(json["type"], "page");
        assert_eq!(json["pageIndex"], 12);
    }

    /// 字段名采用 camelCase（与 packages/shared 一致），snake_case 仅用于枚举值
    #[test]
    fn book_file_serializes_camel_case_fields_and_snake_case_format() {
        let f = BookFile {
            id: "f1".into(),
            edition_id: "e1".into(),
            format: BookFormat::ImageDir,
            origin: BookFileOrigin::Local,
            path: "/tmp/x".into(),
            size: 10,
            sha256: "ab".into(),
            parser: "image_dir".into(),
            parser_version: "0.1".into(),
        };
        let json = serde_json::to_value(&f).unwrap();
        assert_eq!(json["editionId"], "e1");
        assert_eq!(json["format"], "image_dir");
        assert_eq!(json["origin"], "local");
    }
}
