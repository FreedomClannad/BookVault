# 测试样本（samples/）

> **说明**：本目录被 `.gitignore` 排除，全部样本由 `python3 scripts/gen-samples.py` 确定性重建（决策记录 §9-4）。
> 真实文件样本由负责人后续放入 `samples/real/`（同样不入库，避免版权与体积问题）。

## 现有合成样本清单

| 路径 | 覆盖的测试点 |
|---|---|
| `txt/utf8-chapters.txt` | UTF-8 中文 + 「第X章」切分 |
| `txt/gbk-novel.txt` | GBK 编码识别与解码 |
| `txt/gb18030-rare.txt` | GB18030 扩展区生僻字 |
| `txt/plain-no-chapters.txt` | 无章节标题的降级切分 |
| `image-dir/`（7 张，page1/page10/… 陷阱命名） | 图片文件夹适配 + 自然排序 |
| `cbz/normal.cbz`（12 页，零填充命名） | CBZ 常规解析 |
| `cbz/sort-trap.cbz`（page1/page10/page2…） | 自然排序陷阱（字典序错误顺序） |
| `epub/minimal-epub3.epub` | EPUB3：OPF + nav 目录 |
| `epub/ncx-only-epub2.epub` | EPUB2：NCX 目录回退 |
| `pdf/text-bookmarks.pdf` | PDF：3 页 + Info 标题 + 2 书签（脚本手工构造，书签用 ASCII 规避编码差异） |
| `malicious/traversal.cbz` | ZIP Slip 路径穿越（必须被拒绝） |
| `malicious/bomb.cbz` | 压缩炸弹 256MB 解压上限（必须被拒绝） |

⚠️ `malicious/` 下的文件仅供 M1 安全测试读取，**不要**用任何阅读器打开或手动解压。

## 尚缺的真实样本（等负责人提供，M1 前最佳）

- 残缺 OPF / 无 nav 的真实 EPUB、带字体与 CSS 的复杂 EPUB
- >50MB 长篇 TXT（集成测试中动态生成 330MB 用例，不落盘 samples/）
- 文本型带书签真实 PDF（当前为脚本构造样本）、扫描型 PDF（P1）
