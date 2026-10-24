//! bv-formats：BookVault 格式适配层（Phase 1 计划 §2.4）。
//!
//! 对外只暴露统一的探测/解析接口；M1 起每种格式一个独立适配器，适配器之间互不依赖。
//! 安全底线（需求 §9.3）：解压必须防路径穿越/压缩炸弹，解析失败不得破坏原文件；
//! 解析产出必须携带解析器名/版本与源文件哈希。

pub mod detect;
pub mod error;

pub use detect::{detect_from_extension, DetectResult, FormatKind};
pub use error::{ParseError, Result};
