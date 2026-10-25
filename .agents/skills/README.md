# .agents/skills/ 清单

> **说明**：本目录是跨工具标准的项目级 skill 位置，ZCode 等代理会自动发现（ZCode 专属覆盖可放 `.zcode/skills/`，同名优先）。
> 引入标准：遵循 `bookvault-dev-standards` §4 依赖检查单——**非宽松许可证（MIT / Apache-2.0 / BSD）一律不装**。

## 自研 skill（依据需求文档编写，随本仓库演进）

| Skill | 用途 |
|---|---|
| `bookvault-rules` | AI 协作工作流：任务流程、暂停确认清单、汇报模板 |
| `bookvault-dev-standards` | 代码开发标准：分层、模块边界、错误处理、依赖检查单、迁移、测试 |
| `bookvault-ui-style` | UI 样式规范：design tokens、中文排版、漫画阅读、隐私 UI 红线 |

## 三方 skill（2026-10-24 安装）

| Skill | 来源 | 许可证 | 用途 |
|---|---|---|---|
| `brainstorming` | [obra/superpowers](https://github.com/obra/superpowers) @ `2ce8aa1` | MIT | 需求发散与方案收敛的结构化引导 |
| `writing-plans` | 同上 | MIT | 把目标写成可执行、带验收标准的详细计划 |
| `executing-plans` | 同上 | MIT | 按计划逐步执行并保持节奏 |
| `test-driven-development` | 同上 | MIT | 红-绿-重构 TDD 循环 |
| `systematic-debugging` | 同上 | MIT | 从根因定位 bug，反对盲改试错 |
| `verification-before-completion` | 同上 | MIT | 声称「完成」前的验证清单 |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) @ `dbd4588` | Apache-2.0（随目录 LICENSE.txt） | 有个性、非模板化的前端视觉设计指导 |
| `webapp-testing` | 同上 | Apache-2.0（随目录 LICENSE.txt） | Playwright 端到端测试本地 Web 应用 |

## 三方 skill（2026-10-25 安装，UI/设计专项）

| Skill | 来源 | 许可证 | 用途 |
|---|---|---|---|
| `ui-ux-pro-max` 及配套 6 件（`design` / `design-system` / `brand` / `banner-design` / `slides` / `ui-styling`） | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) @ `d14efff` | MIT（`ui-styling` 内容为 Apache-2.0，随目录 LICENSE） | 可搜索本地设计数据库：79 风格 / 192 配色 / 74 字体搭配 / 119 UX 指南 / 22 技术栈，按 `--domain` 查询 |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) @ `9368675` | Apache-2.0（随目录 LICENSE） | 设计语言与命令：`/polish` `/audit` `/critique` `/distill` `/animate` 等，61 条确定性检测规则，可产出 `DESIGN.md` |
| `taste-skill`（frontmatter 内部名 `design-taste-frontend`） | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) @ `12af471` | MIT（随目录 LICENSE） | 反模板「高级感」设计：247 个精选站点提炼的艺术指导库 + 真实浏览器截图检查与修正循环 |
| `ui-skills-root` + 8 个子技能（`baseline-ui` / `improve-ui` / `fixing-accessibility` / `fixing-metadata` / `fixing-motion-performance` / `component-canvas` / `create-canvas` / `create-design-md`） | [ibelick/ui-skills](https://github.com/ibelick/ui-skills) @ `55363c3` | MIT（随目录 LICENSE） | 设计工程师规则集：MUST/SHOULD/NEVER 基线（Tailwind 一致性）、无障碍/SEO 元数据/动效性能修复、画布与 DESIGN.md 生成 |

### 安装说明（2026-10-25 批次）

- `ui-ux-pro-max-skill` 按其官方发布集 `.claude/skills/` 完整安装 7 个 skill；设计数据为自包含 CSV（含 Google Fonts 许可数据），仅拷贝 skill 目录，未带入上游 `cli/`。
- `impeccable` 取 `plugin/skills/impeccable`（自包含：SKILL.md + reference + scripts），未带入上游 99MB 的测试目录；各 harness 目录（.claude/.cursor/…）内容相同，只需一份。
- `ui-skills` 按上游 `skills/` 全量安装 9 个；注意 `ui-skills-root` 的路由机制设计为调用其 `ui-skills` CLI 拉取内容，离线场景以各 skill 自带文本为准。
- 本批新增约 15MB（`.agents/skills/` 总计 16MB）；每个安装目录均附上游 LICENSE 文件。
- **优先级约定**：三方 UI skill 是设计决策的参考数据库与检查工具；项目 UI 行为的权威仍是自研 `bookvault-ui-style`（design tokens、中文排版、隐私红线），冲突时以项目规范为准。

### 安装说明

- `superpowers` 各 skill 为完整目录拷贝；`systematic-debugging` 删除了 4 个未被 SKILL.md 引用的作者自测文件（`test-*.md`、`CREATION-LOG.md`、示例脚本），核心引用文件（`root-cause-tracing.md` 等）保留。
- **未安装** anthropics/skills 中的 `docx` / `pdf` / `pptx` / `xlsx` 等 skill：它们是 Anthropic 专有许可（© Anthropic PBC, all rights reserved，绑定其服务条款），不满足宽松许可证标准。
- 升级方式：从上游仓库拉取后对照 diff 更新对应目录，并更新本表 commit 号。
