# ADR-005：PDF 元数据解析选型（lopdf）

- 状态：✅ 已采纳（2026-10-24，spike 通过）
- 关联：Phase 1 计划 §3 表格、M1.5 任务

## 背景

M1 需要在 Rust 侧提取 PDF 页数、标题与书签目录（渲染走前端 pdf.js，ADR-002）。候选：`lopdf`（MIT）与 `pdf` crate（MIT）。

## 决策

采用 **lopdf 0.46.0**（MIT，源码级许可证核验）。

## Spike 结论（样本 `samples/pdf/text-bookmarks.pdf`，脚本手工构造）

| 能力      | 结果                                                              | 说明                                                                    |
| --------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 页数      | ✅ `get_pages().len()`                                            |                                                                         |
| Info 标题 | ✅ trailer → Info → /Title                                        | 用 lossy UTF-8 解码；**CJK 标题可能乱码**（PDF 文本串编码多样，见局限） |
| 书签目录  | ✅ `get_toc()` 返回 `Toc { toc: Vec<TocType{level,title,page}> }` | 页码已由 lopdf 解析为 1-based 页号，无需自建 ObjectId 反查              |

测试：`crates/bv-formats/tests/matrix.rs::pdf_pages_title_and_bookmarks`（3 页 + 2 书签全通过）。

## 局限（记录于 docs/formats/，P1 视真实样本再决定是否加强）

1. CJK /Title 与书签标题按 PDFDocEncoding 或 UTF-16BE 编码时当前用 lossy 解码，可能乱码；真实中文 PDF 样本到位后用 `decode_text_string` 路径修正。
2. 扫描型 PDF（页面图像）与加密 PDF 不在 M1 范围（加密应返回 NotSupported/Corrupted，由 SecureZip 之外的 PDF 层处理——目前 lopdf 对加密文件会 Err，映射为 Corrupted，可诊断）。

## 替代方案

`pdf` crate 类型更现代但 API 面更大；lopdf 已满足 M1 需求且样例验证通过，不引入第二依赖。
