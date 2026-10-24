---
name: bookvault-dev-standards
description: BookVault 项目代码开发标准。在本仓库编写、修改或评审任何 Rust 或 TypeScript/React 代码时使用，涵盖分层架构、模块边界、错误处理、新依赖引入检查单、数据库迁移与测试要求。涉及 Tauri、Axum、SQLite、格式解析（EPUB/TXT/CBZ/PDF）或共享包 packages/shared 的开发时也必须遵循。
---

# BookVault 开发标准

> 来源：`docs/requirements/BOOKVAULT_AI_PROJECT_BRIEF.md` §4/§5/§9/§11 + `docs/plans/phase-1-implementation-plan.md`。
> 状态：Stage 0 规范稿，随 M0 脚手架落地逐步固化；与实际代码冲突时，先在文档层面达成一致再改代码。

## 1. 分层与模块边界（最重要）

依赖方向只允许自上而下：**UI → 应用业务 → 格式适配 / 数据**。

- `apps/desktop/src/features/*`（UI 层）：只调用应用业务层接口。禁止 import 具体解析库（foliate-js / pdf.js / fflate）、禁止 SQL、禁止直接 fetch NAS API。
- 应用业务层：用例编排（导入流程、阅读状态、同步协调），通过接口调用格式适配层。
- `crates/bv-formats`（格式适配，Rust）：对外只暴露 `detect / readMetadata / readContents / getResource` 风格接口 + 统一错误类型；内部每种格式一个独立适配器，适配器之间互不依赖。
- `packages/shared`：纯 TS 类型与纯函数（领域模型、ReadingLocation 序列化）。**禁止**依赖 DOM、Node API、任何运行时库——移动端要复用它。
- 渲染（WebView/TS）与解析（Rust）分离：解析产出统一目录与资源引用，阅读器组件不知道具体格式的存在。

## 2. Rust 规范

- 错误处理：用 `thiserror` 为每个 crate 定义统一错误枚举；生产路径禁止 `unwrap/expect`；错误信息可诊断（含上下文，不含敏感数据、私密书名）。
- 格式解析必须防：路径穿越（ZIP Slip）、压缩炸弹（解压前后大小/文件数上限）、超大单文件。解析失败绝不能破坏或修改原文件。
- 公共接口的输入校验放在模块入口，内部信任已校验类型。
- 解析产出必须附带 `parserInfo { parser, version }` 与源文件 sha256，用于进度绑定与诊断。

## 3. TypeScript 规范

- `strict: true`；禁 `any`（确需未知类型时用 `unknown` + 类型收窄）。
- 领域类型只在 `packages/shared` 定义一次，各端 import，不得复制定义。
- 状态管理从简起步（React 内置 + 少量 context），出现真实痛点再引库。

## 4. 新增依赖检查单（五项缺一不引入）

1. 许可证宽松：MIT / Apache-2.0 / BSD；GPL / AGPL / 非 OSI 许可证需用户明确批准。
2. 维护活跃：近 6 个月有 release 或活跃提交。
3. 支持目标平台：macOS arm64 / Windows / Linux；服务端依赖额外注意 NAS 常见 CPU 架构（x86_64 / aarch64）。
4. 包体积与传递依赖可控。
5. 无更简替代：约 50 行内能自研解决的，不引库。

引入后在 commit / 汇报中记录以上五点结论。已锁定的版本基线：zip crate 用 9.x（官方已 yank 更早全部版本）；CI 跑 `cargo audit` / `cargo deny` 做供应链检查。

## 5. 数据库

- 一律版本化 migration（服务端 sqlx migrate；桌面端按 M0 选型），禁止手写破坏性 DDL。
- 客户端与服务端 schema 分开维护；重叠实体的字段名保持一致。
- 迁移必须可回滚或有前向兼容策略；先写迁移测试再应用。

## 6. 测试要求

- 格式解析：每格式 ≥3 个真实样本（`samples/` 目录）；恶意样本（路径穿越 / 压缩炸弹）必须有用例；编码检测必须有 GBK / GB18030 用例。
- 阅读位置：序列化/反序列化用例 + 内容哈希失配时的降级用例。
- 同步：游标推进、断线重连、冲突保留用例。
- API：正常路径 + 错误码 + 越权拒绝用例。
- 改动后运行与改动范围相关的测试并在汇报中给出真实结果；测试失败不许合入。

## 7. 命名与提交

- 标识符用英文；commit message 用英文、祈使句（如 `feat: add EPUB metadata parser`）。
- 单次 commit 对应单一目标；不把格式化改动与功能改动混在一个 commit。
