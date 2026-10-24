# ADR-001：Monorepo 单工作区（pnpm + Cargo 双 workspace）

- 状态：✅ 已采纳（2026-10-24）
- 关联：Phase 1 计划 §2、决策记录 §9-1

## 背景

BookVault 含桌面端（TS + Rust）、NAS 服务端（Rust）、跨端共享领域类型（TS）。需要决定仓库组织与 workspace 工具。

## 决策

单仓 Monorepo：

- TS 侧：pnpm workspace（`apps/*`、`packages/*`）。
- Rust 侧：Cargo workspace（`crates/*`、`apps/desktop/src-tauri`），`[profile.release]` 只在根定义（member 不允许）。
- 版本基线：Rust ≥ 1.88（zip crate MSRV）、Node ≥ 20、pnpm ≥ 9。
- 质量门：`make check` 一键跑 fmt-check + clippy(deny warnings) + eslint + 全部测试；Rust 侧 `[workspace.lints]` 强制 `unsafe_code = "forbid"` 与 `clippy::all = deny`。

## 理由

跨端改动一次提交完成；`packages/shared` 与 `crates/bv-protocol` 的字段对齐靠同仓镜像测试保证（M1.8）；避免发包/子模块同步成本。

## 后果与替代方案

- 仓库内 `samples/`、`target/`、`node_modules/` 通过 `.gitignore` 控制；样本全部脚本重建、不入库。
- 替代方案（桌面/服务端分仓）被负责人否决（决策记录 §9-1）。
