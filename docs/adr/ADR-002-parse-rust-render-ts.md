# ADR-002：格式解析在 Rust、渲染在 TS（WebView）

- 状态：✅ 已采纳（2026-10-24）
- 关联：需求 §5.1、Phase 1 计划 §2.3/§2.4、决策记录 §9-2

## 背景

P0 需要解析 EPUB/TXT/PDF/CBZ/图片文件夹并阅读。解析可在 Rust（Tauri 壳/服务端）或 TS（WebView）实现。

## 决策

- **解析**（探测、签名识别、安全解压、哈希、元数据/目录提取）在 Rust：`crates/bv-formats`，桌面壳与 NAS 服务端导入流水线共用。
- **渲染**在 TS（WebView）：EPUB=filiate-js（vendored）、PDF=pdf.js、CBZ 按需取页=fflate。
- 接口边界：`bv-formats` 只暴露 `detect / read_metadata / read_contents / get_resource` + 统一 `ParseError`；阅读器组件只消费「目录 + 资源引用」，不知道具体格式。

## 理由

服务端导入（M3）必须复用同一套解析与安全防护（ZIP Slip / 压缩炸弹限额，需求 §9.3）；Rust 侧做这些防护比 WebView 可靠且可测。渲染库（foliate-js / pdf.js）本身是浏览器生态，留在 TS 侧零成本。

## 后果

- 资源按需读取走 Tauri 命令（`get_resource`），有 IPC 开销——阅读器需做预加载（ui-style §4 漫画 ±2 页）抵消。
- TXT 章节切分规则表定义在 `packages/shared`（TS），Rust 侧同源镜像（M1.8 一致性测试）。
- 替代方案「全 TS 解析」被否决：服务端无法复用、安全防护薄弱。
