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

### 安装说明

- `superpowers` 各 skill 为完整目录拷贝；`systematic-debugging` 删除了 4 个未被 SKILL.md 引用的作者自测文件（`test-*.md`、`CREATION-LOG.md`、示例脚本），核心引用文件（`root-cause-tracing.md` 等）保留。
- **未安装** anthropics/skills 中的 `docx` / `pdf` / `pptx` / `xlsx` 等 skill：它们是 Anthropic 专有许可（© Anthropic PBC, all rights reserved，绑定其服务条款），不满足宽松许可证标准。
- 升级方式：从上游仓库拉取后对照 diff 更新对应目录，并更新本表 commit 号。
