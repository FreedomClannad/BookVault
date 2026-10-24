# AI 开发流程规范：调研结论与本仓库采用方案

> **文档说明**
>
> - 用途：回答「有没有针对 AI 开发流程的规范可以照着做」，记录业界调研结论，以及本仓库实际采用的方案与执行流程。
> - 状态：✅ 已采纳落地（根目录 `AGENTS.md` 与 `.agents/skills/` 已创建）。
> - 调研日期：2026-10-24。链接均来自当次检索结果。

---

## 1. 调研结论

### 1.1 AGENTS.md —— 开放事实标准（✅ 已采用）

**AGENTS.md**（官方仓库 https://github.com/agentsmd/agents.md）是当前 AI 辅助开发最通用的开放标准：在仓库根目录放一个 `AGENTS.md`（「给 AI 代理的 README」），写明项目概述、常用命令、架构、代码风格与行为边界，主流 AI 编程工具会自动加载。InfoQ 于 2025-08 报道其成为开放标准；2026 年的实践文章普遍将其与规格文档（Specs）、Agent Skills 并列为 AI 开发三件套。

本仓库落地方式：

- 根目录 [`AGENTS.md`](../../AGENTS.md)：只放每次会话必须生效的精简硬规则（自动加载，保持短小）。
- ZCode 原生支持 workspace 级 `AGENTS.md`，与该标准兼容；其他遵循该标准的工具同样能读。

### 1.2 规格先行（Spec-first）实践（✅ 部分采用，融入流程）

业界共识（Addy Osmani《How to write a good spec for AI agents》、Augment Code《Living specs for AI agent development》、Tim Deschryver《Keep Agentic AI Simple》等）：

1. **先写规格再写代码**：目标、边界、验收标准写清楚后，AI 执行成功率显著提高；
2. **规格是活文档**：随代码演进同步维护，不写完即弃；
3. **分层边界**：must / should / may 分级，避免全部堆成硬约束。

本仓库落地方式：每个里程碑先明确「验收标准」再动工（见 `docs/plans/phase-1-implementation-plan.md` §5）；重大技术决策记入 `docs/adr/`（M0 起）。

### 1.3 项目级 Skills（✅ 已采用）

Skills 是随仓库分发的任务型规范：平时只在上下文占一行描述，触发对应任务时才加载全文，适合承载详细标准而不膨胀每次会话的上下文。本仓库放在 **`.agents/skills/`**（跨工具的标准位置，ZCode 会自动发现；若需 ZCode 专属覆盖，同名 skill 放 `.zcode/skills/` 优先级更高）。

已创建三个项目 skill（依据需求文档编写；此类内容没有现成官方包可下载，故为项目自研）：

| Skill                     | 内容                                                                          | 触发场景                       |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------ |
| `bookvault-dev-standards` | 分层架构、模块边界、错误处理、依赖引入检查单、数据库迁移、测试要求            | 编写/修改/评审 Rust 或 TS 代码 |
| `bookvault-ui-style`      | 设计基调、design tokens、中文阅读排版、漫画翻页/滚动、书架与隐私 UI、可访问性 | 实现或调整任何界面             |
| `bookvault-rules`         | 标准任务流程、必须暂停确认的场景清单、结束汇报固定格式                        | 执行任何开发任务               |

### 1.4 第三方 skills（2026-10-24 安装）

按 `bookvault-dev-standards` §4 的许可证标准筛选安装了 **8 个三方 skill**（来源、commit 与许可证见 [`.agents/skills/README.md`](../../.agents/skills/README.md)）：

- [obra/superpowers](https://github.com/obra/superpowers)（MIT）：`brainstorming`、`writing-plans`、`executing-plans`、`test-driven-development`、`systematic-debugging`、`verification-before-completion`——与 §2 流程互补的执行方法类 skill。
- [anthropics/skills](https://github.com/anthropics/skills)（Apache-2.0，仅限个别 skill）：`frontend-design`、`webapp-testing`。
- ⚠️ 注意：anthropics/skills 仓库中的 `docx` / `pdf` / `pptx` / `xlsx` 等 skill 为 **Anthropic 专有许可**（© Anthropic PBC，绑定其服务条款），不满足宽松许可证标准，**未安装**。

## 2. 本仓库 AI 开发流程（照此执行）

```
领任务 → 查现状 → 定方案 → 实现 → 验证 → 汇报
```

1. **领任务**：读根目录 `AGENTS.md` 硬规则 + 需求文档相关章节 + `docs/` 对应文档。
2. **查现状**：`git status` / 相关代码 / 现有测试；仓库实态与描述不符时先报告再动手。
3. **定方案**：小改动（≤3 文件、无公共接口变更、无新依赖）直接实现；其余先出计划（改动文件、接口边界、验收标准）等确认。
4. **实现**：代码遵守 `bookvault-dev-standards`；界面遵守 `bookvault-ui-style`；一次一个可验证目标。
5. **验证**：运行与改动相关的测试与 lint；格式解析用 `samples/` 真实样本。
6. **汇报**：按 `bookvault-rules` 的固定模板输出（改动 / 验证 / 未完成与限制 / 风险与下一步）。

## 3. 来源

- AGENTS.md 官方仓库：https://github.com/agentsmd/agents.md
- InfoQ: AGENTS.md Emerges as Open Standard for AI Coding（2025-08）：https://www.infoq.com/news/2025/08/agents-md
- Addy Osmani: How to write a good spec for AI agents（2026-01）：https://addyosmani.com/blog/good-spec
- AI Hero: A Complete Guide To AGENTS.md（2026-01）：https://www.aihero.dev/a-complete-guide-to-agents-md
- Tim Deschryver: Keep Agentic AI Simple（2026-04）：https://timdeschryver.dev/blog/keep-agentic-ai-simple-a-practical-workflow-for-software-development
- Augment Code: Living Specs for AI Agent Development（2026-03）：https://www.augmentcode.com/guides/living-specs-for-ai-agent-development
