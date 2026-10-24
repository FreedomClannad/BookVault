# ADR-009：桌面端 schema 迁移与设置存储

- 状态：✅ 已实现（M2）
- 关联：需求 §9.4、Phase 1 计划 §5 M2.2/2.12

## 决策

1. **迁移**：rusqlite + `PRAGMA user_version` 版本化（`src-tauri/src/db.rs` 的
   `MIGRATIONS` 数组，逐版本 `execute_batch` + 递增 user_version）。幂等：重复打开跳过
   已应用版本（测试覆盖）。破坏性 DDL 禁止（AGENTS.md 规则 9）。
   服务端用 sqlx::migrate!（独立迁移目录），两端 schema 分开维护、字段名对齐。
2. **设置存储分两层**：
   - `settings` 表（key-value，SQLite）：设备 ID、NAS 连接配置（含 token）、同步游标——
     需要跨会话一致且参与同步逻辑的状态；
     其中 `device_id`/`nas_cursor` 为保留键，禁止 UI 直写。
   - `localStorage`（WebView）：阅读器即时偏好（字号、漫画适应模式）——纯展示偏好，
     跟随设备不需要同步；P1 若要求跨设备同步再迁入 settings 表。

## 理由

- 桌面端单进程访问 SQLite，PRAGMA user_version 比 runner 依赖少且足够；
- 设置分层的判据是「是否被同步/业务逻辑消费」。
