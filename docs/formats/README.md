# 格式适配器说明（M1 交付）

> **文档说明**：每种格式适配器的解析行为、已知局限与脏样本处理方式。发现新局限请追加到对应小节（需求 §5.1：记录解析器名称/版本与已知问题，便于诊断）。
> 状态：M1 完成时的快照；解析器版本见 `bv-formats` crate 版本（ParserInfo）。

## 总览

统一入口 `bv_formats::parse_book(path)`（文件或目录）→ `ParsedBook { kind, sha256, parser, metadata, contents }`。
探测：`detect()` 签名优先（`%PDF-` / ZIP 头 + mimetype），扩展名仅作 TXT 弱提示——伪装扩展名用例已覆盖。

| 适配器                  | 输出                                       | 安全措施                      |
| ----------------------- | ------------------------------------------ | ----------------------------- |
| `adapters/txt.rs`       | Novel：章节→字节区间（流式扫描，512KB/块） | 无解压面；编码检测见下        |
| `adapters/cbz.rs`       | Comic：自然排序页列表                      | SecureZip 预检 + 读取二次限额 |
| `adapters/epub.rs`      | Novel：spine 章节 + nav/NCX 标题           | 同上                          |
| `adapters/pdf.rs`       | Document：页数 + 书签（lopdf，ADR-005）    | 渲染不在 Rust 侧              |
| `adapters/image_dir.rs` | Comic：一层目录+子目录自然排序             | 相对路径越根拒绝              |

## TXT 编码策略（chardetng + encoding_rs）

1. BOM 优先（UTF-8/UTF-16LE/UTF-16BE）。
2. chardetng 猜测（前 64KB）；**CJK 歧义消解**：若猜测非 UTF-8 但样本严格合法 UTF-8（容忍采样尾部在多字节序列中间截断）且含多字节序列，则改判 UTF-8。原因：纯中文无 BOM 文件 chardetng 常猜 GB18030，而 GBK 尾字节落在 ASCII 区间，几乎不可能整段通过 UTF-8 校验。
3. 章节规则与 `packages/shared/chapter-rules.ts` 同源，`tests/matrix.rs::chapter_rules_mirror` 做源码级镜像校验（规则 id 与 MAX_HEADING_LENGTH=40）。

**已知局限**：UTF-16 无 BOM 文件会在 detect 阶段因 NUL 字节被拒（NotSupported）——真实样本出现后再处理；`get_resource` 每次打开章节都重新流式扫描定位区间（正确但非最优，P1 可加缓存）。

## EPUB

- container.xml → OPF；metadata 取首个 dc:title、全部 dc:creator、dc:language、dc:identifier。
- 目录：EPUB3 nav（`properties="nav"`）优先，EPUB2 NCX（spine@toc）回退；章节以 spine 顺序为准，标题来自目录映射。
- 封面：`cover-image` 属性优先，`meta name="cover"` 回退。
- **已知局限**：脏 XML 采取「尽力解析」策略（忽略解析错误继续返回已收集内容）；HTML/NCX 里的 cover 页面（xhtml 封面页）不识别，只识别图片封面；DRM EPUB 会因加密 zip 条目被 SecureZip 拒绝（Unsafe，符合需求 §1.3 不做 DRM 绕过）。

## CBZ / 图片文件夹

- 自然排序：数字段按数值比较，值相等按原串（零填充在前）；`page2 < page10` 陷阱用例覆盖。
- 封面启发：cover/thumbnail 命名优先，否则首图。
- 图片文件夹：根目录一层 + 子目录一层；**内容哈希为结构哈希**（相对路径+文件大小的有序 sha256），同尺寸不同内容的替换检测不到——P1 可升级逐文件哈希。
- 限额：条目 ≤4096、单条目解压 ≤64MB、总解压 ≤128MB（`ZipLimits` 可配置）；`bomb.cbz`（256MB 零）被 LimitExceeded 拒绝、`traversal.cbz`（`../evil.txt`）被 Unsafe 拒绝，错误信息可诊断。

## PDF（ADR-005）

- lopdf 提取页数/Info 标题/书签；CJK 标题 lossy 解码可能乱码（真实中文 PDF 到位后修正）。
- 加密 PDF → Corrupted 可诊断错误。
