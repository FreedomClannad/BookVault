#!/usr/bin/env python3
"""重建 BookVault 测试样本（Phase 1 计划 §7）。

用法：python3 scripts/gen-samples.py
样本目录 samples/ 已被 .gitignore 排除——全部样本由此脚本确定性生成，不入库。
真实文件样本由负责人后续放入 samples/real/（同样不入库）。
"""

import shutil
import struct
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"


# ---------- 最小合法 PNG（无第三方依赖） ----------

def make_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


# ---------- TXT ----------

NOVEL_UTF8 = "\n".join(
    [f"第{c}章 {t}" + "\n\n" + "山不在高，有仙则名。水不在深，有龙则灵。" * 8 for c, t in
     [("一", "初入书库"), ("二", "编码疑云"), ("三", "漫画迷宫")]]
) + "\n"

NOVEL_NO_CHAPTERS = "\n".join(
    "这是一本没有任何章节标题的小说，用来验证无章节文本的切分降级。第" + str(i) + "段落。" * 3 for i in range(20)
)

# GB18030 扩展区生僻字，验证全量解码
RARE = "第二卷 生僻字检验：喆堃犇麤龘䲟㙟𠮷"


# ---------- EPUB ----------

EPUB3_OPF = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:0f8b7c2a-gen-samples-0001</dc:identifier>
    <dc:title>样例之书（EPUB3）</dc:title>
    <dc:creator>BookVault 样本生成器</dc:creator>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>
"""

EPUB2_OPF = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="uid">urn:uuid:0f8b7c2a-gen-samples-0002</dc:identifier>
    <dc:title>样例之书（EPUB2 NCX）</dc:title>
    <dc:creator>BookVault 样本生成器</dc:creator>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/></spine>
</package>
"""

NCX = """<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:0f8b7c2a-gen-samples-0002"/></head>
  <docTitle><text>样例之书（EPUB2 NCX）</text></docTitle>
  <navMap><navPoint id="n1" playOrder="1"><navLabel><text>第一章</text></navLabel>
    <content src="text/chapter1.xhtml"/></navPoint></navMap>
</ncx>
"""

CONTAINER = """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
"""

NAV_XHTML = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><ol><li><a href="text/chapter1.xhtml">第一章</a></li></ol></nav></body>
</html>
"""


def chapter_xhtml(title: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{title}</title></head>
<body><h1>{title}</h1><p>苔痕上阶绿，草色入帘青。</p></body></html>
"""


def write_epub(path: Path, epub3: bool) -> None:
    with zipfile.ZipFile(path, "w") as zf:
        # EPUB 规范：mimetype 必须第一个且 STORED（不压缩）
        info = zipfile.ZipInfo("mimetype")
        info.compress_type = zipfile.ZIP_STORED
        zf.writestr(info, "application/epub+zip")
        zf.writestr("META-INF/container.xml", CONTAINER)
        zf.writestr("OEBPS/content.opf", EPUB3_OPF if epub3 else EPUB2_OPF)
        if epub3:
            zf.writestr("OEBPS/nav.xhtml", NAV_XHTML)
        else:
            zf.writestr("OEBPS/toc.ncx", NCX)
        zf.writestr("OEBPS/text/chapter1.xhtml", chapter_xhtml("第一章 验证样本"))


# ---------- CBZ / 图片文件夹 ----------

SORT_TRAP_NAMES = [f"page{i}.png" for i in [1, 2, 10, 11, 20, 3, 4]]  # 字典序陷阱：page10 < page2
NORMAL_NAMES = [f"page{i:03d}.png" for i in range(1, 13)]  # 零填充命名，字典序=自然序


def write_cbz(path: Path, names: list[str]) -> None:
    with zipfile.ZipFile(path, "w") as zf:
        for idx, name in enumerate(names):
            color = ((idx * 37) % 256, (idx * 73) % 256, (idx * 151) % 256)
            zf.writestr(name, make_png(32, 48, color))


# ---------- 恶意样本（仅供 M1 安全测试，勿用阅读器打开） ----------

def write_malicious() -> None:
    mal = SAMPLES / "malicious"
    mal.mkdir(parents=True, exist_ok=True)
    # 路径穿越（ZIP Slip）
    with zipfile.ZipFile(mal / "traversal.cbz", "w") as zf:
        zf.writestr("../evil.txt", "pwned")
        zf.writestr("page1.png", make_png(8, 8, (255, 0, 0)))
    # 压缩炸弹：256MB 零解压为 ~250KB
    with zipfile.ZipFile(mal / "bomb.cbz", "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("huge.bin", b"\x00" * (256 * 1024 * 1024))


def main() -> None:
    if SAMPLES.exists():
        for child in SAMPLES.iterdir():
            if child.name != "README.md":
                shutil.rmtree(child) if child.is_dir() else child.unlink()

    # TXT（覆盖 UTF-8 / GBK / GB18030 / 无章节）
    txt = SAMPLES / "txt"
    txt.mkdir(parents=True, exist_ok=True)
    (txt / "utf8-chapters.txt").write_text(NOVEL_UTF8, encoding="utf-8")
    (txt / "gbk-novel.txt").write_text(NOVEL_UTF8, encoding="gbk")
    (txt / "gb18030-rare.txt").write_text(RARE + "\n" + NOVEL_UTF8, encoding="gb18030")
    (txt / "plain-no-chapters.txt").write_text(NOVEL_NO_CHAPTERS, encoding="utf-8")

    # 图片文件夹（自然排序陷阱命名）
    imgdir = SAMPLES / "image-dir"
    imgdir.mkdir(parents=True, exist_ok=True)
    for idx, name in enumerate(SORT_TRAP_NAMES):
        (imgdir / name).write_bytes(make_png(32, 48, ((idx * 41) % 256, 0, 0)))

    # CBZ
    cbz = SAMPLES / "cbz"
    cbz.mkdir(parents=True, exist_ok=True)
    write_cbz(cbz / "normal.cbz", NORMAL_NAMES)
    write_cbz(cbz / "sort-trap.cbz", SORT_TRAP_NAMES)

    # EPUB（EPUB3+nav / EPUB2+NCX）
    epub = SAMPLES / "epub"
    epub.mkdir(parents=True, exist_ok=True)
    write_epub(epub / "minimal-epub3.epub", epub3=True)
    write_epub(epub / "ncx-only-epub2.epub", epub3=False)

    write_malicious()

    count = sum(1 for _ in SAMPLES.rglob("*") if _.is_file() and _.name != "README.md")
    print(f"samples rebuilt: {count} files under {SAMPLES}")


if __name__ == "__main__":
    main()
