# BookVault

个人小说与漫画阅读器：桌面端 + 移动端（后期）+ 自托管 NAS 服务端。局域网优先、混合存储、离线可用。

> 当前状态：**M0 脚手架阶段**（Phase 1 计划见 [docs/plans/phase-1-implementation-plan.md](docs/plans/phase-1-implementation-plan.md)，已确认）。

## 技术栈

| 端         | 技术                                          |
| ---------- | --------------------------------------------- |
| 桌面端     | Tauri 2 + React + TypeScript                  |
| NAS 服务端 | Rust + Axum（M3 启动）                        |
| 格式解析   | Rust（`crates/bv-formats`，桌面与服务端共用） |
| 数据       | SQLite（桌面 rusqlite / 服务端 sqlx）         |
| 部署       | Docker Compose（M3 起）                       |

## 仓库结构

```
apps/
  desktop/          # Tauri 2 桌面端（src 为 React，src-tauri 为 Rust 壳）
  server/           # NAS 服务端（M3 创建）
crates/
  bv-formats/       # 格式探测与解析（EPUB/TXT/PDF/CBZ/图片文件夹）
  bv-protocol/      # /api/v1 DTO（Rust），与 packages/shared 字段对齐
packages/
  shared/           # 纯 TS 领域类型 + 纯函数（零 DOM/运行时依赖）
  reader-epub/      # foliate-js 封装（M2）
docs/               # 需求、计划、规范、ADR
samples/            # 测试样本（脚本生成，见 samples/README.md）
scripts/            # 样本生成等辅助脚本
.agents/skills/     # AI 协作 skills（自研 + 三方，见其 README）
AGENTS.md           # AI 编程助手硬规则（自动加载）
```

## 常用命令

前置：Node ≥ 20、pnpm ≥ 9、Rust ≥ 1.88（stable）。

```bash
make check    # 一键：格式检查 + lint + 全部测试（Rust + TS）
make fmt      # 格式化（cargo fmt + prettier）
make lint     # clippy deny warnings + eslint
make test     # cargo test --workspace + pnpm -r test
make audit    # 依赖审计（cargo deny + pnpm audit，需先安装工具）

# 桌面端开发
cd apps/desktop && pnpm dev        # 仅前端（Vite）
cd apps/desktop && pnpm tauri dev  # 完整桌面应用

# 重建测试样本
python3 scripts/gen-samples.py
```

## 文档入口

| 文档                                                                                               | 说明                                           |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [docs/requirements/BOOKVAULT_AI_PROJECT_BRIEF.md](docs/requirements/BOOKVAULT_AI_PROJECT_BRIEF.md) | 产品需求与架构约定（权威）                     |
| [docs/plans/phase-1-implementation-plan.md](docs/plans/phase-1-implementation-plan.md)             | Phase 1 计划：里程碑 M0–M4、验收标准、决策记录 |
| [docs/standards/AI_DEV_PROCESS.md](docs/standards/AI_DEV_PROCESS.md)                               | AI 开发流程规范与本仓库执行流程                |
| [docs/adr/](docs/adr/)                                                                             | 架构决策记录                                   |
| [AGENTS.md](AGENTS.md)                                                                             | AI 协作硬规则                                  |

## 许可证

项目自身许可证未定；所有第三方依赖须为宽松许可证（MIT / Apache-2.0 / BSD），引入检查单见 `.agents/skills/bookvault-dev-standards`。依赖清单将在 M3 生成（THIRD_PARTY_NOTICES.md）。
