//! 安全 ZIP 读取（需求 §9.3）。
//!
//! 打开时基于 central directory 预检（条目数 / 单条目 / 总解压大小 / 路径穿越 / 加密），
//! 读取时对实际解压量二次设限，防「头部谎报大小」的构造样本。
//! 超限一律返回可诊断的 [`ParseError::Unsafe`] / [`ParseError::LimitExceeded`]，
//! 绝不静默截断。

use crate::error::{ParseError, Result};
use std::io::{Read, Seek};
use zip::{result::ZipError, ZipArchive};

/// 解压限额（默认值覆盖正常书籍；超大漫画可由调用方放宽）
#[derive(Debug, Clone, Copy)]
pub struct ZipLimits {
    pub max_entries: usize,
    pub max_entry_uncompressed: u64,
    pub max_total_uncompressed: u64,
}

impl Default for ZipLimits {
    fn default() -> Self {
        Self {
            max_entries: 4096,
            max_entry_uncompressed: 64 * 1024 * 1024,
            max_total_uncompressed: 128 * 1024 * 1024,
        }
    }
}

pub struct SecureZip<R: Read + Seek> {
    archive: ZipArchive<R>,
    names: Vec<String>,
    limits: ZipLimits,
}

impl<R: Read + Seek> SecureZip<R> {
    pub fn open(reader: R, limits: ZipLimits) -> Result<Self> {
        let mut archive = ZipArchive::new(reader).map_err(zip_err)?;
        let len = archive.len();
        if len > limits.max_entries {
            return Err(ParseError::LimitExceeded {
                what: "zip entry count",
                max: limits.max_entries as u64,
            });
        }
        let mut names = Vec::with_capacity(len);
        let mut total: u64 = 0;
        for i in 0..len {
            let e = archive.by_index(i).map_err(zip_err)?;
            if e.is_dir() {
                continue;
            }
            if e.encrypted() {
                return Err(ParseError::Unsafe {
                    reason: format!(
                        "encrypted zip entry: {}",
                        String::from_utf8_lossy(e.name_raw())
                    ),
                });
            }
            // 路径穿越（ZIP Slip）：条目名必须能规范为压缩包内相对路径
            if e.enclosed_name().is_none() {
                return Err(ParseError::Unsafe {
                    reason: format!(
                        "zip entry escapes root: {}",
                        String::from_utf8_lossy(e.name_raw())
                    ),
                });
            }
            let size = e.size();
            if size > limits.max_entry_uncompressed {
                return Err(ParseError::LimitExceeded {
                    what: "single entry uncompressed size",
                    max: limits.max_entry_uncompressed,
                });
            }
            total = total.saturating_add(size);
            if total > limits.max_total_uncompressed {
                return Err(ParseError::LimitExceeded {
                    what: "total uncompressed size",
                    max: limits.max_total_uncompressed,
                });
            }
            names.push(String::from_utf8_lossy(e.name_raw()).into_owned());
        }
        Ok(Self {
            archive,
            names,
            limits,
        })
    }

    pub fn entry_names(&self) -> &[String] {
        &self.names
    }

    /// 读取单个条目（对实际解压量二次设限，防头部谎报）
    pub fn read_entry(&mut self, name: &str) -> Result<Vec<u8>> {
        let idx =
            self.names
                .iter()
                .position(|n| n == name)
                .ok_or_else(|| ParseError::Corrupted {
                    detail: format!("zip entry not found: {name}"),
                })?;
        let mut e = self.archive.by_index(idx).map_err(zip_err)?;
        let mut buf = Vec::new();
        e.by_ref()
            .take(self.limits.max_entry_uncompressed + 1)
            .read_to_end(&mut buf)
            .map_err(ParseError::Io)?;
        if buf.len() as u64 > self.limits.max_entry_uncompressed {
            return Err(ParseError::LimitExceeded {
                what: "single entry uncompressed size",
                max: self.limits.max_entry_uncompressed,
            });
        }
        Ok(buf)
    }
}

fn zip_err(e: ZipError) -> ParseError {
    ParseError::Corrupted {
        detail: format!("zip: {e}"),
    }
}
