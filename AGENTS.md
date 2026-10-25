# AGENTS.md

> 本文件遵循 AGENTS.md 开放标准（https://github.com/agentsmd/agents.md），由 AI 编程助手自动加载。
> 只放每次会话都必须生效的精简规则；详细标准见 `docs/` 与 `.agents/skills/`（见文末索引）。

## 项目概述

**BookVault** —— 个人小说与漫画阅读器（桌面端 + 移动端 + 自托管 NAS 服务端），局域网优先、混合存储、离线可用。

- 权威需求：`docs/requirements/BOOKVAULT_AI_PROJECT_BRIEF.md`（产品方向以其为准，不得擅自更改其「已确认」决策）。
- 当前进度：**Phase 1 代码完成（M0–M4 ✅，2026-10-24）**：格式核心、桌面本地闭环（SQLite 三层模型 + 四阅读器 + 进度哈希绑定）、NAS 服务端（配对/书库/流式上传/同步，Docker Compose）、双设备 e2e 同步测试通过；`make check` 全绿。剩余：GUI 人工验证清单（计划 §13）与 P1 及后续阶段。Phase 1 计划：`docs/plans/phase-1-implementation-plan.md`（已确认，三层模型 Work/Edition/BookFile）。
- 交互移植（参考 Wenku8_Flutter，仅对齐交互、未复制 GPL 代码）：**包 A 阅读器交互 ✅（分页/竖排/翻页动画/逐书记忆，commit `9b61aba`）**；包 B 书架与查找、包 C 书签/听书/动效开关、EPUB 分页适配未做，已知限制与真机验证清单见 `docs/plans/interaction-port-backlog.md`（继续此工作前必读）。

## 沟通约定

与用户沟通使用中文；代码、标识符、commit message 使用英文。

## 硬性规则（违反即返工）

1. **先检查仓库再动手**：读本文件、需求文档相关章节、目录结构、`git status`；不要假设仓库是空的或干净的。
2. **小步推进**：一次围绕一个可验证目标修改；说明准备改哪些文件、为什么。
3. **保护现有配置与数据**：不擅自覆盖配置、删除文件、重置数据库、执行不可逆命令；高危操作必须先问。
4. **先计划后编码**：跨模块改动先给出方案、接口边界和验收标准，等确认再动。
5. **保持分层**：UI 不直接绑定解析库、不发 SQL；解析、导入、存储、同步各有清晰职责（详见 `bookvault-dev-standards` skill）。
6. **不伪造能力**：未实现的功能/格式不得标注「已支持」；兼容性必须经真实样本测试验证。
7. **新增依赖要有理由**：验证许可证、维护活跃度、平台支持、体积、替代方案（检查单见 `bookvault-dev-standards` skill §4）。
8. **测试优先并如实报告**：为格式识别、进度序列化、冲突处理、导入安全、API 行为写测试；运行相关测试并报告真实结果，失败不许说完成。
9. **数据库变更必须走版本化 migration**，禁止破坏性 DDL。
10. **安全默认值**：不提交密钥、不记录凭据、不允许任意 URL/文件路径访问、不默认同步私密内容；URL 导入必须防 SSRF；解压必须防 ZIP Slip/炸弹（需求 §9）。

## 常用命令

```bash
make check                         # 一键：格式检查 + lint + 全部测试（改动后必跑）
make fmt / make lint / make test   # 单项；make audit 为依赖审计
cd apps/desktop && pnpm tauri dev  # 桌面端开发运行（GUI，需人工交互验证）
python3 scripts/gen-samples.py     # 重建测试样本（samples/ 不入库）
```

## 架构速览（规划，详见 Phase 1 计划 §2）

- 分层：UI → 应用业务 → 格式适配 → 本地数据；服务端：API → 任务 → 持久化。
- 格式探测/元数据解析在 Rust（`crates/bv-formats`，客户端壳与服务端共用）；渲染在 TS（WebView）。
- 领域类型只在 `packages/shared` 定义一次；`packages/shared` 禁止依赖 DOM / Node API / 运行时库。

## 文档索引

| 位置                                              | 用途                                                   |
| ------------------------------------------------- | ------------------------------------------------------ |
| `docs/requirements/BOOKVAULT_AI_PROJECT_BRIEF.md` | 产品需求与架构约定（权威）                             |
| `docs/README.md`                                  | 文档总索引                                             |
| `docs/plans/phase-1-implementation-plan.md`       | Phase 1 技术方案、里程碑与验收标准（✅ 已确认）        |
| `docs/standards/AI_DEV_PROCESS.md`                | AI 开发流程规范调研与本仓库采用方案                    |
| `.agents/skills/bookvault-dev-standards/`         | 代码开发标准 skill                                     |
| `.agents/skills/bookvault-ui-style/`              | UI 样式规范 skill                                      |
| `.agents/skills/bookvault-rules/`                 | AI 协作工作流与汇报格式 skill                          |
| `.agents/skills/README.md`                        | 全部 skill 清单（3 个自研 + 8 个三方，含来源与许可证） |
