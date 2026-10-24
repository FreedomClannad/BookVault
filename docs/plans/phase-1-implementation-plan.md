# BookVault 第一阶段实施计划

> **文档说明**
>
> - 用途：第一阶段（对应需求文档 §10 的 P0）的技术方案、任务拆分与验收标准，作为后续开发的查找与对照依据。
> - 状态：✅ **已确认**（2026-10-24 负责人确认全部决策，记录见 §9）；下一步启动 M0。
> - 维护：里程碑推进时更新各节状态标记（⏳ 未启动 / 🚧 进行中 / ✅ 完成 / ❌ 阻塞）；结构变化记入下方修订记录。
>
> **修订记录**
>
> | 版本 | 日期       | 变更                                                                                                                                                                                                                                                    |
> | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | v1   | 2026-10-24 | 初版：现状评估、选型、里程碑 M0–M4                                                                                                                                                                                                                      |
> | v2   | 2026-10-24 | 详化：工具链基线、模块依赖规则、关键接口草图、SQLite DDL、里程碑任务级拆分、测试矩阵、样本清单、ADR 计划、时间线；**补全 v1 缺失的 PDF 解析/阅读任务**                                                                                                  |
> | v3   | 2026-10-24 | 决策确认（§9）：单仓 / Rust+TS 分层 / M0–M4；**领域模型按负责人决定采用 Work–Edition–BookFile 三层**（§4 重写）                                                                                                                                         |
> | v4   | 2026-10-24 | 流程走查补缺 13 项：根 README（0.1）、图标生成（0.4）、chapter-rules 同源测试（1.8）、M2 设备 ID/设置持久化/目录导入/文件丢失处理（2.3/2.9/2.11/2.12）、M3 流式上传与许可证清单、备份文档（3.5/3.9）、ADR 009；新增 §12「明确不做清单」与两条待提供信息 |
> | v5   | 2026-10-24 | M1 完成：bv-formats 全 P0 格式适配器 + 测试矩阵全绿；新增 ADR-005 与 docs/formats/；TXT 编码 CJK 歧义消解（合法 UTF-8 优先）                                                                                                                            |

需求文档指 [`docs/requirements/BOOKVAULT_AI_PROJECT_BRIEF.md`](../requirements/BOOKVAULT_AI_PROJECT_BRIEF.md)。

---

## 1. 现状评估（2026-10-24）

- `main` 分支**零提交**；需求文档与 `icon.jpeg` 已暂存；`.idea/` 未跟踪（M0 加入 `.gitignore`）。
- 已就位的规范资产：`AGENTS.md`（根目录）、`docs/`（本计划 + 流程规范）、`.agents/skills/`（3 自研 + 8 三方，见 [`.agents/skills/README.md`](../../.agents/skills/README.md)）。
- ~~代码、依赖、测试均为零。**绿地阶段**，直接搭 monorepo，无需迁移兼容。~~（M0 完成后注：脚手架已就位，`make check` 全绿，样本可由 `scripts/gen-samples.py` 重建。）

## 2. 技术选型与目录结构

### 2.1 目录结构（细化）

```
BookVault/
├── apps/
│   ├── desktop/                      # Tauri 2 桌面端（M0 创建骨架，M2 成型）
│   │   ├── src/
│   │   │   ├── app/                  # 路由、全局状态、Tauri 命令绑定（唯一允许 invoke 的层）
│   │   │   ├── features/
│   │   │   │   ├── library/          # 书架、搜索、分类
│   │   │   │   ├── reader/           # 统一阅读器框架 + novel/comic/pdf 三个渲染器
│   │   │   │   ├── import/           # 导入任务 UI
│   │   │   │   └── settings/         # 主题、阅读设置、NAS 连接（M4）
│   │   │   └── shared/               # app 内部共享 UI 组件（非跨端）
│   │   └── src-tauri/                # Rust 壳：文件访问、哈希、本地 SQLite、调用 bv-formats
│   └── server/                       # NAS 服务端 Axum（M3 创建）
│       └── src/
│           ├── api/                  # 路由、中间件（认证/限流）、错误响应
│           ├── services/             # 书库、文件存储、同步、配对
│           └── storage/              # sqlx + migrations + content-addressed 文件存储
├── crates/
│   ├── bv-formats/                   # 格式探测与元数据/目录解析（桌面壳与服务端共用）
│   │   └── src/
│   │       ├── detect.rs             # 综合探测（扩展名+MIME+签名）
│   │       ├── secure_zip.rs         # 带限额的 ZIP 读取（防炸弹/穿越）
│   │       └── adapters/             # epub.rs / txt.rs / pdf.rs / cbz.rs / image_dir.rs
│   └── bv-protocol/                  # /api/v1 DTO（Rust），字段与 packages/shared 对齐
├── packages/
│   ├── shared/                       # 纯 TS 领域类型+纯函数（零 DOM/零运行时依赖）
│   │   └── src/
│   │       ├── domain.ts             # Work / Edition / BookFile / Device / ImportTask / ReadingLocation
│   │       └── chapter-rules.ts      # TXT 章节切分规则表（与 Rust 侧共用同一规则集）
│   └── reader-epub/                  # foliate-js 封装（vendored，见 §3）
├── docs/
│   ├── requirements/                 # 需求文档（权威）
│   ├── plans/ standards/ adr/        # 计划、规范、架构决策记录
│   └── (M1 起 formats/，M3 起 api/)
├── samples/                          # 测试样本（见 §7；小样本入库，大样本用脚本获取）
├── scripts/                          # 样本获取、开发辅助脚本
├── .agents/skills/                   # 项目级 skills（自研+三方）
├── AGENTS.md                         # AI 协作硬规则（自动加载）
├── pnpm-workspace.yaml
├── Cargo.toml                        # Cargo workspace 根
└── docker-compose.yml                # M3 起
```

### 2.2 工具链版本基线（M0 锁定具体版本号并写入 README）

| 工具        | 基线                                                                                                                      | 约束来源                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Rust        | stable，**MSRV ≥ 1.88**                                                                                                   | zip crate 9.x 的 MSRV 要求 |
| Node / pnpm | Node 20 LTS / pnpm 9+                                                                                                     | Tauri 2 与 Vite 生态       |
| Tauri       | 2.x                                                                                                                       | 需求 §3                    |
| React + TS  | React 18 + TS 5.x，`strict: true`                                                                                         | —                          |
| 测试        | Rust `cargo test`；TS `vitest`；服务端集成测试 `reqwest` 对 test server；UI E2E 复用 `webapp-testing` skill（Playwright） | —                          |
| Lint        | `rustfmt` + `clippy`；`eslint` + `prettier`；依赖审计 `cargo deny`/`cargo audit` + `pnpm audit`                           | zip crate yank 事件教训    |

### 2.3 模块依赖规则（用工具强制，不只靠约定）

```
apps/desktop/src/features ──只允许──▶ app 层接口 ──▶ Tauri 命令 ──▶ src-tauri ──▶ bv-formats / SQLite
apps/server/api ──▶ services ──▶ storage / bv-formats
packages/*  ◀──类型引用── 所有 TS 端（packages/shared 不依赖任何项目内包）
bv-protocol 字段 ◀──手工对齐──▶ packages/shared（M0 起加字段一致性测试）；chapter-rules ◀──镜像测试同源──▶ Rust 侧（M1.8 落地）
```

- ESLint 用 `eslint-plugin-boundaries`（或等价方案）限制 `features/*` 可 import 的层；Rust 侧用 crate 边界天然隔离。
- 禁止项（dev-standards §1 的执行化）：`features/*` import 解析库 / 发 SQL / fetch NAS；`packages/shared` import DOM 或运行时库。

### 2.4 关键接口草图（设计稿，M1/M2 定稿并记 ADR）

**Rust 侧（`crates/bv-formats`）**

```rust
pub enum FormatKind { Epub, Txt, Pdf, Cbz, ImageDir }

pub struct DetectResult { pub kind: FormatKind, pub confidence: f32 }

/// 读取抽象：支持流式/按需读，避免整本载入内存（需求 §5.1）
pub trait BookSource {
    fn size(&self) -> u64;
    fn read_range(&self, offset: u64, len: usize) -> Result<Vec<u8>>;
}

pub trait BookParser {
    fn kind(&self) -> FormatKind;
    fn detect(&self, src: &dyn BookSource) -> Result<DetectResult, ParseError>;
    fn read_metadata(&self, src: &dyn BookSource) -> Result<BookMetadata, ParseError>;
    fn read_contents(&self, src: &dyn BookSource) -> Result<BookContents, ParseError>;
    /// 资源按需读取：封面 / 章节资源 / 漫画页面
    fn get_resource(&self, src: &dyn BookSource, ref_: &ResourceRef) -> Result<ResourceData, ParseError>;
}

pub enum ParseError {
    NotSupported, Corrupted { detail: String },
    Unsafe { reason: String },            // 穿越/炸弹/超大
    LimitExceeded { what: &'static str, max: u64 },
    Io(std::io::Error),
}
```

**TS 侧（`packages/shared`，与需求 §5.3 对齐）**：`BookKind` / `BookMetadata` / `ReadingLocation`（chapter | page | comic 三态）/ `BookContents { chapters: ChapterNode[] | pages: PageNode[] }` / `ResourceRef`。

**Tauri 命令面（M2）**：`import_from_paths` / `list_works` / `get_work` / `open_book(fileId) → BookContents` / `get_resource(fileId, ref) → bytes` / `save_reading_progress(fileId, location)`；（M4 增）`nas_connect` / `nas_sync_status` / `nas_push_changes`。

**服务端 API**：需求 §8 的端点集合；M3 交付 health / devices / library items / 文件上传下载 / sync changes·ack，其余端点留 P1。

## 3. 格式解析库选型与许可证（2026-10-24 核实）

| 用途                        | 首选                                 | 许可证                               | 备选                   | 集成方式                                                                           |
| --------------------------- | ------------------------------------ | ------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------- |
| EPUB 解析+渲染（TS）        | **foliate-js**                       | MIT（其依赖 zip.js 为 BSD-3-Clause） | epub.js（MIT，维护慢） | vendoring：git 子模块或固定 commit 拷贝入 `packages/reader-epub/vendor/`，锁定版本 |
| PDF 渲染（TS）              | **pdf.js**（`pdfjs-dist`）           | Apache-2.0                           | —                      | npm 依赖，锁精确版本                                                               |
| PDF 元数据/页数（Rust，M1） | **lopdf**（spike 验证）              | MIT                                  | `pdf` crate（MIT）     | M1 做 1 天 spike 后定，记 ADR 005                                                  |
| ZIP/CBZ（Rust）             | **zip** 9.x                          | MIT OR Apache-2.0                    | —                      | 锁精确版本（官方已 yank 9.x 前全部版本）；配解压限额                               |
| ZIP（TS，渲染期按需取页）   | **fflate**                           | MIT                                  | jszip（MIT）           | npm 依赖                                                                           |
| TXT 编码检测/解码（Rust）   | **chardetng** + **encoding_rs**      | Apache-2.0 OR MIT                    | —                      | cargo 依赖                                                                         |
| 图片自然排序                | 自研 `Intl.Collator({numeric:true})` | —                                    | —                      | 15 行内 + 测试                                                                     |

核实来源：foliate-js（github.com/johnfactotum/foliate-js，MIT 由 Foliate 仓库确认）、pdf.js（github.com/mozilla/pdf.js，Apache-2.0）、fflate（github.com/101arrowz/fflate，MIT）、zip（crates.io/crates/zip，MIT OR Apache-2.0；yank 事件见 reddit.com/r/rust/comments/1x7eejc）、chardetng / encoding_rs（github.com/hsivonen/chardetng、docs.rs/encoding_rs）。

P1 预研（现阶段不引入）：CBR/RAR 许可证风险（unrar 非 OSI，倾向 libarchive BSD 或隔离进程）；MOBI/AZW3 复用 foliate-js。

## 4. 领域模型与数据存储

### 4.1 领域模型（`packages/shared` 定义，服务端用 `bv-protocol` 对齐）

```
Work             id, title, authors[], description?, language?, coverRef?, identifiers{}
Edition          id, workId, label(版本名), source?, language?, notes?
BookFile         id, editionId, format, origin('local'|'nas'), path, size, sha256,
                 parserInfo { parser, version }
ReadingProgress  deviceId, bookFileId, contentSha256(版本绑定), location, updatedAt
Device           id, name, pairedAt, status
ImportTask       id, sourceType, status(pending|running|done|failed|cancelled), error?, createdAt
ReadingLocation  chapter{chapterId, progress, anchor?} | page{pageIndex} | comic{chapterId?, imageIndex}
```

层级：**Work 1—N Edition 1—N BookFile**。

- Edition 表示同一作品的**内容版本**（如「某出版社 EPUB 版」与「网络流传 TXT 版」是两个 Edition）；同一 Edition 下的不同格式/副本是多个 BookFile。
- 阅读进度始终绑定最细粒度的 BookFile + 内容哈希；切换文件/版本时进度不自动迁移（按章节 ID 迁移留 P1 优化）。
- 导入归属：新文件默认新建 Work + Edition；导入确认步骤可搜索并改挂到已有作品/版本（对应需求 §6.1 第 8 步的重复检测）。

> **决策记录（§9-3）**：负责人选择第一阶段直接采用三层模型（v2 曾建议一对多最简起步）；导入 UI 与去重逻辑按上述「默认新建 + 可改挂」实现，控制复杂度。

### 4.2 桌面端 SQLite DDL 草图（M2 落地为 migration 001）

```sql
CREATE TABLE works (
  id TEXT PRIMARY KEY,                       -- ULID
  title TEXT NOT NULL, authors TEXT NOT NULL DEFAULT '[]',   -- JSON
  description TEXT, language TEXT, identifiers TEXT NOT NULL DEFAULT '{}',
  cover_path TEXT,                           -- 提取的封面缓存
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE editions (
  id TEXT PRIMARY KEY,                       -- ULID
  work_id TEXT NOT NULL REFERENCES works(id),
  label TEXT NOT NULL DEFAULT '',            -- 版本名，如「出版版」「网络TXT版」
  source TEXT, language TEXT, notes TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE book_files (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id),
  format TEXT NOT NULL CHECK (format IN ('epub','txt','pdf','cbz','image_dir')),
  origin TEXT NOT NULL CHECK (origin IN ('local','nas')),
  path TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  parser TEXT NOT NULL, parser_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (sha256, path)
);
CREATE TABLE reading_progress (
  device_id TEXT NOT NULL,
  book_file_id TEXT NOT NULL REFERENCES book_files(id),
  content_sha256 TEXT NOT NULL,              -- 进度绑定文件版本（需求 §5.3）
  location TEXT NOT NULL,                    -- JSON ReadingLocation
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, book_file_id)
);
CREATE TABLE import_tasks (
  id TEXT PRIMARY KEY, source_type TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
```

### 4.3 服务端 SQLite DDL 草图（M3 落地）

```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  token_hash TEXT NOT NULL,                  -- 只存哈希，绝不存明文
  paired_at INTEGER NOT NULL, revoked_at INTEGER
);
-- editions / files 与桌面端字段对齐；files 用 content-addressed 存储：
--   data/files/ab/cd/<sha256>.<ext>
CREATE TABLE files (
  id TEXT PRIMARY KEY, edition_id TEXT NOT NULL REFERENCES editions(id),
  sha256 TEXT NOT NULL UNIQUE, size INTEGER NOT NULL,
  storage_path TEXT NOT NULL, format TEXT NOT NULL,
  uploaded_by TEXT REFERENCES devices(id), created_at INTEGER NOT NULL
);
CREATE TABLE change_log (                    -- 同步权威：服务端单调序号（需求 §7.2）
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  payload TEXT NOT NULL,                     -- JSON
  device_id TEXT, created_at INTEGER NOT NULL
);
-- 阅读进度按 (device_id, file_id) 存每设备一行；客户端按 updatedAt 合并，
-- 冲突时保留双方（显示「设备A 85% / 设备B 12%」让用户选），不静默丢弃。
```

### 4.4 不变量（测试必须覆盖）

1. 进度行的 `content_sha256` 必须等于关联文件的当前哈希；失配时 UI 明确降级（提示文件已变更），不静默沿用。
2. 同一 sha256 的文件在本地库只入一次（导入去重）；导入默认新建 Work+Edition，确认步骤可改挂已有作品/版本（需求 §6.1 第 8 步）。
3. 服务端 `change_log.seq` 单调递增，游标只前进；客户端 ack 之前变更可重放（幂等）。
4. 删除操作区分「移除索引 / 删缓存 / 删 NAS 原件」三档（需求 §9.4），M2 只实现前两档。
5. Edition 必须隶属唯一 Work；删除 Work / Edition 前级联检查其下文件并二次确认。

## 5. 里程碑与任务拆分

> 顺序：M0 → M1 → M2 → M3 → M4。M0–M2 为本地闭环（需求 §13.5），M3/M4 在 M2 验收后启动。

### M0 脚手架 — ✅（2026-10-24 完成，`make check` 全绿；spike 人工验证步骤见 ADR-004，约 0.5 周）

| #   | 任务                                                                                                                                                             | 产出                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0.1 | `.gitignore`（`.idea/`、`node_modules`、`target/`、`dist/`、`samples/**/*.epub` 等大文件例外规则）+ **根 README.md**（简介/结构/命令/文档入口）+ 首次正式 commit | 干净基线                                  |
| 0.2 | Cargo workspace 根 + `bv-formats` / `bv-protocol` 空 crate（thiserror 错误骨架、clippy=deny warnings）                                                           | `cargo test` 空跑通                       |
| 0.3 | pnpm workspace + `packages/shared`（tsconfig strict + vitest 空跑通）                                                                                            | `pnpm test` 空跑通                        |
| 0.4 | `apps/desktop`：create-tauri-app（React+TS+Vite）跑通 `dev`；`icon.jpeg` 转换并生成 Tauri 全套图标                                                               | 可启动空窗口                              |
| 0.5 | lint 全家：rustfmt/clippy、eslint/prettier、`cargo deny` + `pnpm audit` 配置                                                                                     | 一键 `check` 脚本（Makefile 或 justfile） |
| 0.6 | **Spike：Tauri 2 全局快捷键 + 多窗口切换**（快速隐藏的底层能力）                                                                                                 | ADR 004 结论（可行/替代方案）             |
| 0.7 | ADR 001–003（monorepo、解析/渲染分层、进度-哈希绑定）；`samples/` 清单 + 获取脚本                                                                                | 文档基线                                  |

**验收**：`just check` 一条命令全绿；spike 结论入 ADR；本计划状态标记更新。

### M1 格式核心 `bv-formats` — ✅（2026-10-24 完成：26 个测试全绿、lopdf spike 通过见 ADR-005、解析器局限见 docs/formats/；依赖 M0）

| #   | 任务                   | 要点                                                                                                                                                                                                                     |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | 综合探测 `detect`      | 扩展名 + MIME + 签名（`PK\x03\x04`→zip 系再查 EPUB mimetype、`%PDF`、图片头）；伪装扩展名用例                                                                                                                            |
| 1.2 | `secure_zip`           | 基于 central directory 预检：总解压大小上限、单文件上限、条目数上限、路径穿越过滤；超限报 `Unsafe/LimitExceeded`                                                                                                         |
| 1.3 | EPUB 适配器            | container.xml → OPF：metadata（title/creator/language/identifier/cover）+ spine + 目录（nav 优先、NCX 回退）+ 资源清单                                                                                                   |
| 1.4 | TXT 适配器             | chardetng 检测 + encoding_rs 解码（GBK/GB18030/UTF-8 BOM 用例）；章节切分（规则表：`第X章/卷`、`Chapter N` 等，规则集与 `packages/shared/chapter-rules.ts` 同源）；**输出章节→字节区间映射**，阅读时按需读段，不整本载入 |
| 1.5 | PDF 适配器             | lopdf spike（1 天）：页数、标题、书签目录；失败则换 `pdf` crate（ADR 005）。M1 不做文本提取，渲染归 pdf.js                                                                                                               |
| 1.6 | CBZ / 图片文件夹适配器 | 条目枚举 + 自然排序（`vol.2/page10` 陷阱用例）+ 封面启发式（首图/名为 cover）；图片文件夹递归一层、混合文件过滤                                                                                                          |
| 1.7 | `parserInfo` + sha256  | 所有解析产出携带解析器名/版本 + 源哈希（进度绑定前提）                                                                                                                                                                   |
| 1.8 | 样本与测试落地         | §6 测试矩阵全绿；恶意样本拒绝且错误可诊断；chapter-rules 与 `packages/shared` 的一致性镜像测试（同源机制，§2.3）                                                                                                         |

**验收**：每格式 ≥3 真实样本用例通过；GBK TXT 正确解码；穿越/炸弹样本被拒；大文件流式（>50MB TXT 不整本载入，内存上限用例）。

### M2 桌面端本地闭环 — ⏳（约 2 周；依赖 M1）

| #    | 任务              | 要点                                                                                                                                                                                          |
| ---- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Tauri 命令层      | `import_from_paths`：复制到暂存区 → detect → sha256 → 安全解析 → 元数据/目录入库 → 提取封面缓存；新文件默认新建 Work+Edition，导入确认 UI 可改挂已有作品/版本；后台任务不阻塞 UI（需求 §6.1） |
| 2.2  | 本地 SQLite       | rusqlite + migration 001（§4.2 DDL，含 editions 表）；去重（sha256 已存在则提示，不重复入库）                                                                                                 |
| 2.3  | 书架 UI           | 封面网格/列表（ui-style §5 tokens）；导入对话框 + 拖拽导入 + **目录选择导入**（图片文件夹）                                                                                                   |
| 2.4  | 阅读器框架        | 统一 Reader 组件：消费 `BookContents` + `get_resource`，按 BookKind 分发渲染器；键盘导航                                                                                                      |
| 2.5  | TXT 阅读器        | 章节导航 + 章内滚动进度；字号/行高/主题设置（ui-style §3）                                                                                                                                    |
| 2.6  | EPUB 阅读器       | foliate-js（vendored）封装：目录跳转、进度回调 → `chapter{chapterId, progress}`                                                                                                               |
| 2.7  | PDF 阅读器        | pdf.js：页码模型 `page{pageIndex}`、缩放、书签目录                                                                                                                                            |
| 2.8  | 漫画阅读器        | CBZ（fflate 按需取页）+ 图片文件夹；单页翻页 + 条漫滚动；预加载 ±2 页（ui-style §4）                                                                                                          |
| 2.9  | 阅读位置保存/恢复 | 退出自动保存；重开恢复；**哈希失配降级**（提示「文件已变更」+ 保留/重置选择）；打开时源文件丢失/不可读给出可诊断错误                                                                          |
| 2.10 | E2E 冒烟          | `webapp-testing` skill（Playwright）：导入→书架→打开→翻页→重启→位置恢复                                                                                                                       |
| 2.11 | 本地设备 ID       | 首次启动生成 ULID 并持久化（进度表 `device_id` 来源，§4.2）                                                                                                                                   |
| 2.12 | 设置持久化        | 阅读主题/字号/行高等用户设置存储，方案随 ADR 009 定（settings 表或 config JSON）                                                                                                              |

**验收**：TXT 小说 + CBZ 漫画 + EPUB 各导入一本，关闭重开位置准确；文件移动/换版本进度不串位；断网状态下一切正常（本地无 NAS 依赖）。

### M3 NAS 服务端最小 API — ⏳（约 1.5 周；依赖 M2 验收）

| #   | 任务              | 要点                                                                                                                        |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | Axum 骨架         | `/api/v1/health`、配置（端口/数据目录/env）、结构化日志（不记敏感字段）                                                     |
| 3.2 | sqlx + migrations | §4.3 DDL 落地                                                                                                               |
| 3.3 | 设备配对          | 首次启动生成配对码（控制台/文件输出）→ `POST /devices/pair` 换 token → 中间件校验（token 只存哈希）                         |
| 3.4 | 书库 API          | `GET /library/items`（分页、格式过滤）、`/items/{id}`、`/contents`、`/resources/{id}`                                       |
| 3.5 | 文件传输          | 上传：body 大小限制 + **流式落盘** + sha256 校验 + content-addressed 存储（§4.3）；下载：支持 Range（断点续传基础）         |
| 3.6 | 同步 API          | 写操作记 `change_log`；`GET /sync/changes?cursor` 增量拉取 + `POST /sync/ack`；进度按设备存行、冲突保留双方                 |
| 3.7 | SSRF 防护预留     | URL 导入 P1 才做，但本阶段把「拒绝 loopback/私网段」的校验函数和测试先写好（需求 §9.2）                                     |
| 3.8 | Docker Compose    | 多阶段构建、volume 布局（`data/db`、`data/files`、`config/`）、healthcheck；README 部署步骤（目标架构待负责人提供，见 §12） |
| 3.9 | 合规与备份文档    | 生成依赖许可证清单（`cargo deny` + `pnpm licenses` → `THIRD_PARTY_NOTICES.md`）；部署 README 补「备份/恢复 data 卷」步骤    |

**验收**：`docker compose up` → health 通过；两客户端配对互不串扰；上传→下载哈希一致；进度变更按游标增量拉取；集成测试（reqwest 对 test server）覆盖正常+错误码+未授权拒绝。

### M4 端到端同步闭环 — ⏳（约 1 周；依赖 M3）

| #   | 任务           | 要点                                                     |
| --- | -------------- | -------------------------------------------------------- |
| 4.1 | NAS 连接 UI    | 手动地址 + 配对码输入（自动发现是 P1 辅助项，需求 §7.2） |
| 4.2 | 客户端同步引擎 | 本地变更队列（断网 pending）、游标管理、指数退避重试     |
| 4.3 | 上传/下载任务  | 进度显示、取消；大文件按需下载 + 「离线可用」标记        |
| 4.4 | 断网演练       | 关 NAS → 本地阅读正常 → 重启 → 队列清空、进度一致        |
| 4.5 | 验收脚本       | 两个桌面 profile 模拟两设备，跑需求 §10 验收闭环         |

**验收（需求 §10 原文场景）**：设备 A 导入小说+漫画上传 NAS；设备 B 获取书库、打开、保存进度；两端重连后进度一致。

## 6. 测试矩阵

| 用例类型                   | EPUB             | TXT                       | PDF        | CBZ              | 图片夹            |
| -------------------------- | ---------------- | ------------------------- | ---------- | ---------------- | ----------------- |
| 识别：正常扩展名           | ✓                | ✓                         | ✓          | ✓                | ✓                 |
| 识别：伪装扩展名（靠签名） | ✓（改名为 .txt） | —                         | ✓          | ✓（改名为 .zip） | —                 |
| 元数据提取                 | ✓ OPF            | ✓ 文件名启发              | ✓ lopdf    | ✓ 首图封面       | ✓                 |
| 目录/章节/页序             | ✓ nav+NCX 回退   | ✓ 切分规则                | ✓ 书签     | ✓ 自然排序陷阱   | ✓ 自然排序        |
| 恶意样本                   | ✓ zip 炸弹       | —                         | —          | ✓ 路径穿越       | —                 |
| 编码                       | UTF-8            | GBK / GB18030 / UTF-8 BOM | —          | —                | ✓ 非 ASCII 文件名 |
| 流式/内存上限              | ✓ 按需取资源     | ✓ >50MB 分段              | ✓ 按需取页 | ✓ 按需取页       | ✓                 |
| 进度往返 + 哈希失配降级    | ✓                | ✓                         | ✓          | ✓                | ✓                 |

另：同步三件套（游标推进 / 断线重连 / 冲突保留双方）在 M3/M4 集成测试覆盖；SSRF 校验函数单测在 M3.7。

## 7. 样本清单（`samples/`，M0.7 落实获取脚本）

| 格式   | 最小集                                   | 建议补充                                     |
| ------ | ---------------------------------------- | -------------------------------------------- |
| EPUB   | 最小合法包、中文正文+CSS、带封面图       | 残缺 OPF、NCX-only（无 nav）、加密字体       |
| TXT    | UTF-8 无章节、GBK 有章节、GB18030 生僻字 | >50MB 长文（脚本生成）、BOM 变体             |
| PDF    | 文本型 3 页 + 书签                       | 扫描型（页面图像）留 P1                      |
| CBZ    | 常规命名、`page1/page10` 排序陷阱        | 构造的路径穿越样本、高压缩比炸弹（脚本生成） |
| 图片夹 | 一层目录 20 张                           | 嵌套子目录、混合非图片文件                   |

来源优先级：用户提供真实文件 > 公有领域电子书（如古腾堡中文部）> 脚本生成。大样本不入库，`scripts/fetch-samples.sh` 可重建。

## 8. 技术风险

| #   | 风险                                         | 应对                                                                                |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | foliate-js 不发 npm，官方用法是 vendoring    | 子模块/固定 commit 拷贝入 `vendor/`，升级对照 diff；隔离在 `reader-epub` 包内不外泄 |
| 2   | zip crate 供应链（官方 yank 9.x 前全部版本） | 锁精确版本；CI `cargo deny`/`audit` + `pnpm audit`                                  |
| 3   | 真实世界 EPUB/TXT 脏样本                     | §7 样本集先行；解析失败必须可诊断不崩溃（错误分类入 ADR）                           |
| 4   | Tauri 2 全局快捷键/多窗口（快速隐藏底层）    | M0.6 spike 提前验证，不可行则 ADR 记替代方案                                        |
| 5   | lopdf 对非常规 PDF 兼容性未知                | M1.5 一天 spike，备选 `pdf` crate；M1 只承诺元数据+页数                             |
| 6   | 章节切分规则误切（如正文含「第一章」字样）   | 规则表可配置 + 置信度（连续命中才算章节）；样本回归                                 |

## 9. 决策记录（2026-10-24 负责人确认）

| #   | 决策          | 结论                                                                                                                                     |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 仓库结构      | ✅ 单仓 Monorepo（§2.1）                                                                                                                 |
| 2   | 解析/渲染分层 | ✅ Rust 解析（bv-formats）+ TS 渲染                                                                                                      |
| 3   | 领域模型      | ✅ **直接采用 Work / Edition / BookFile 三层模型**（未采纳 v2 的一对多最简建议；§4 已按三层重写，导入按「默认新建 + 可改挂」控制复杂度） |
| 4   | 样本来源      | ✅ 先用脚本生成合成样本（`scripts/fetch-samples.sh` / 生成器），后续由负责人补充真实文件（§7）                                           |
| 5   | 阶段范围      | ✅ M0–M4 完整闭环（约 8 周，§11）                                                                                                        |

## 10. ADR 计划（随里程碑撰写，存 `docs/adr/`）

| #   | 主题                                   | 时点  |
| --- | -------------------------------------- | ----- |
| 001 | Monorepo 与 workspace 工具选型         | M0    |
| 002 | 解析（Rust）/ 渲染（TS）分层边界       | M0    |
| 003 | 阅读进度与内容哈希绑定及降级策略       | M0    |
| 004 | Tauri 全局快捷键与多窗口 spike 结论    | M0    |
| 005 | PDF 元数据解析库（lopdf vs pdf crate） | M1    |
| 006 | 设备配对与 token 认证方案              | M3    |
| 007 | Content-addressed 文件存储布局         | M3    |
| 008 | 同步游标与冲突保留策略                 | M3/M4 |
| 009 | 桌面端 schema 迁移机制与用户设置存储   | M2    |

## 11. 时间线总览

| 周    | 里程碑 | 关键产出                               |
| ----- | ------ | -------------------------------------- |
| W1    | M0     | 脚手架 + 一键 check + ADR + spike 结论 |
| W2–W3 | M1     | `bv-formats` 全 P0 格式 + 测试矩阵全绿 |
| W4–W5 | M2     | 桌面本地阅读闭环（TXT/EPUB/PDF/漫画）  |
| W6–W7 | M3     | NAS API + Docker Compose               |
| W8    | M4     | 双设备同步闭环验收                     |

> 估算基于 AI 辅助开发的节奏；纯人工开发按 ×2–3 放宽。M2/M3 之间的边界允许并行预研，但验收顺序不变。

## 12. 明确不做清单（第一阶段范围外，防止范围漂移）

与需求 §10 阶段划分一致，M0–M4 **不实施**以下项；被问及时按此回答：

- 打包分发（dmg/msi/AppImage）：M4 验收用双 profile 模拟两设备；安装包 P1 再做。
- 局域网自动发现：P1；M4 只做手动地址 + 配对码。
- 元数据刮削、OPDS、直链下载、断点续传 UI 完善：P1。
- MOBI/AZW3、FB2、CBR、CB7、HTML/Markdown：P1。
- 私密书架、快速隐藏成品、模拟工作界面、文件加密：P2（M0.6 仅验证底层能力）。
- 完整备份恢复流程、OCR/格式转换：P2。
- 远程访问、多用户/家庭成员权限：P3。

**待负责人提供**（不阻塞 M0–M2，M3 前需要）：

1. 目标 NAS 的型号 / CPU 架构 / Docker 版本 —— 决定 M3.8 镜像目标平台。
2. 代码托管平台（GitHub / 自建 / 无）—— 决定检查走远端 CI 还是仅本地 `make check`；**当前按「仅本地 check」实施**。
