# ADR-004：Tauri 2 全局快捷键 + 多窗口 spike（快速隐藏底层能力验证）

- 状态：✅ 编译级验证通过（2026-10-24）；交互级验证待负责人人工执行
- 关联：Phase 1 计划 §5 M0.6、风险 4；需求 §2.1（P2 特性的前提）

## 背景

桌面端 P2 的「快速隐藏」「模拟工作界面」依赖 Tauri 2 的全局快捷键与多窗口能力。若不可行需尽早换壳，避免 M2 之后返工。

## 决策与实现

依赖 `tauri-plugin-global-shortcut = "2"`（MIT OR Apache-2.0，官方维护）。实现位于 `apps/desktop/src-tauri/src/lib.rs`：

1. **全局快捷键** `CmdOrCtrl+Shift+B`：`with_shortcuts` 注册，handler 中 `hide()/show()+set_focus()` 切换主窗口（label `main`）。
2. **多窗口伪装**：`open_decoy_window` Tauri 命令，用 `WebviewWindowBuilder` 创建/聚焦第二个窗口（label `decoy`，title "Terminal"，当前加载同一 SPA——真实中性界面为 P2 交付物）。

## 验证状态

- ✅ `cargo check --workspace` 与 `make check`（clippy deny）通过；插件 API 与 Tauri 2 兼容。
- ⏳ 人工验证步骤（负责人执行）：
  ```bash
  cd apps/desktop && pnpm tauri dev
  ```
  1. 窗口出现后按 `Cmd+Shift+B` → 主窗口应隐藏；再按 → 恢复并聚焦。
  2. macOS 首次运行需在 系统设置 → 隐私与安全性 → 辅助功能/输入监控 中允许该应用（全局快捷键需要）。
  3. WebView 控制台执行 `await __TAURI__.core.invoke("open_decoy_window")`（或 M2 接 UI 后点按钮）→ 应出现 "Terminal" 窗口。

## 结论

编译级可行，风险解除（保留）；若人工验证失败，回退方案为快捷键改用应用内快捷键（非全局）+ 托盘恢复，或评估 wry/wgx 混合壳——P2 前再决策。

## 后续

- decoy 窗口内容、窗口标题/预览的隐私规则（需求 §2.1：私密书名不得出现在窗口标题）在 P2 实现；本 spike 的窗口均为中性标题。
