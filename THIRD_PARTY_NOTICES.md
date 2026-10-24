# 第三方依赖许可证清单（THIRD_PARTY_NOTICES）

> 生成方式：Rust 侧从本地 registry 实际下载源码的 Cargo.toml 逐项核验（`grep '^license'`），
> npm 侧来自 package.json / 官方仓库声明。**新增依赖必须同步更新本文件**（dev-standards §4）。
> 更新日期：2026-10-24（M0–M4）。本项目自身许可证未定。

## Rust（workspace 直接依赖）

| Crate                  | 版本               | 许可证                               | 使用方                                             |
| ---------------------- | ------------------ | ------------------------------------ | -------------------------------------------------- |
| thiserror              | 2                  | MIT OR Apache-2.0                    | bv-formats/bv-protocol                             |
| serde / serde_json     | 1                  | MIT OR Apache-2.0                    | 全部                                               |
| zip                    | **=9.0.5（锁定）** | MIT                                  | bv-formats                                         |
| chardetng              | 1.0                | Apache-2.0 OR MIT                    | bv-formats                                         |
| encoding_rs            | 0.8                | (Apache-2.0 OR MIT) AND BSD-3-Clause | bv-formats                                         |
| lopdf                  | 0.46               | MIT                                  | bv-formats                                         |
| quick-xml              | 0.42               | MIT                                  | bv-formats                                         |
| sha2                   | 0.10/0.11          | MIT OR Apache-2.0                    | bv-formats / server / desktop                      |
| axum                   | 0.8                | MIT                                  | server                                             |
| tokio                  | 1                  | MIT                                  | server / desktop(test)                             |
| tokio-util             | 0.7                | MIT                                  | server                                             |
| sqlx                   | 0.8                | MIT OR Apache-2.0                    | server                                             |
| tower / tower-http     | 0.5 / 0.6          | MIT                                  | server                                             |
| rand                   | 0.9                | MIT OR Apache-2.0                    | server                                             |
| hex                    | 0.4                | MIT OR Apache-2.0                    | server                                             |
| url                    | 2.5                | MIT OR Apache-2.0                    | server（SSRF 校验）                                |
| futures-util           | 0.3                | MIT OR Apache-2.0                    | server                                             |
| reqwest                | 0.13               | MIT OR Apache-2.0                    | desktop（http-json，无 TLS feature）               |
| rusqlite               | 0.32               | MIT                                  | desktop（libsqlite3-sys bundled，公有领域 SQLite） |
| ulid                   | 3.0                | MIT                                  | desktop                                            |
| tauri / tauri-plugin-* | 2.x                | Apache-2.0 OR MIT                    | desktop                                            |
| tempfile               | 3                  | MIT OR Apache-2.0                    | 测试                                               |

## npm（直接依赖）

| 包                                         | 许可证            | 说明                             |
| ------------------------------------------ | ----------------- | -------------------------------- |
| react / react-dom                          | MIT               | UI                               |
| @tauri-apps/api、@tauri-apps/plugin-dialog | MIT OR Apache-2.0 | IPC / 文件选择                   |
| pdfjs-dist                                 | Apache-2.0        | PDF 渲染                         |
| fflate                                     | MIT               | CBZ 按需解压（渲染期，M2 备用）  |
| typescript                                 | Apache-2.0        | 构建                             |
| vite / vitest / eslint 系 / prettier       | MIT 系            | 工具链                           |
| tailwindcss / @tailwindcss/vite            | MIT               | 样式（v4 @theme 令牌 + utility） |

## 三方 skills（.agents/skills/，随仓库分发）

见 [`.agents/skills/README.md`](.agents/skills/README.md)：obra/superpowers（MIT，@2ce8aa1）6 个；
anthropics/skills（Apache-2.0，@dbd4588）2 个。

## 明确不引入

- anthropics/skills 的 docx/pdf/pptx/xlsx 等：Anthropic 专有许可（绑定服务条款），不满足宽松许可证标准。
- unrar 系（CBR，P1 评估）：非 OSI 许可，倾向 libarchive（BSD）或隔离进程方案。
