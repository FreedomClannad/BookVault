import { describe, expect, it } from "vitest";
import { findHits, stripHtml } from "../src/search";

describe("stripHtml", () => {
  it("removes tags, script/style blocks and comments, keeps text", () => {
    const html = `<p>山不在高</p><script>alert("x")</script><style>p{color:red}</style><!--注--><p>有仙则名</p>`;
    expect(stripHtml(html)).toBe("山不在高 有仙则名");
  });

  it("decodes common entities (entity last so &amp;lt; stays decoded once)", () => {
    expect(stripHtml(`<p>a &amp; b &lt;c&gt; &nbsp;&quot;x&quot;</p>`)).toBe(`a & b <c> "x"`);
  });

  it("collapses runs of blank lines but keeps paragraph breaks as single newlines", () => {
    expect(stripHtml(`<p>一</p>\n\n\n   <p>二</p>`)).toBe("一\n二");
  });

  it("leaves plain text untouched", () => {
    expect(stripHtml("剑来")).toBe("剑来");
  });
});

describe("findHits", () => {
  const text = "剑来。剑去。再剑来。";

  it("finds all case-insensitive hits with ratio and snippets", () => {
    const hits = findHits(text, "剑来");
    expect(hits).toHaveLength(2);
    expect(hits[0]!.index).toBe(0);
    expect(hits[0]!.ratio).toBe(0);
    expect(hits[0]!.hit).toBe("剑来");
    // 「剑来。剑去。再剑来。」共 10 字符，第二处命中在下标 7
    expect(hits[1]!.index).toBe(7);
    expect(hits[1]!.ratio).toBeCloseTo(7 / 10);
  });

  it("matches English case-insensitively but echoes the original casing", () => {
    const hits = findHits("Wenku8 and wenku8", "WENKU8");
    expect(hits).toHaveLength(2);
    expect(hits[1]!.hit).toBe("wenku8");
  });

  it("returns [] for empty/oversized query or empty text", () => {
    expect(findHits(text, "  ")).toEqual([]);
    expect(findHits("", "剑")).toEqual([]);
    expect(findHits(text, "x".repeat(65))).toEqual([]);
  });

  it("caps hits at maxHits and non-overlapping scanning skips contained matches", () => {
    expect(findHits("aaaa", "aa")).toHaveLength(2); // aa|aa 不重叠
    expect(findHits("剑来".repeat(10), "剑来", { maxHits: 3 })).toHaveLength(3);
  });

  it("snippets replace newlines with spaces for single-line previews", () => {
    const hits = findHits("前文\n剑来\n后文", "剑来", { contextLen: 2 });
    // 命中在下标 3，向前 2 字符是「文\n」，换行压成空格；向后 2 字符是「\n后」
    expect(hits[0]!.before).toBe("文 ");
    expect(hits[0]!.after).toBe(" 后");
  });
});
