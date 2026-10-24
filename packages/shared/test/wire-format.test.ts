import { describe, expect, it } from "vitest";
import type { ReadingLocation } from "../src/domain";

/**
 * 线格式契约：与 crates/bv-protocol 的 Rust 测试互为镜像。
 * 两侧任何 JSON 形状变化都必须同步修改另一侧（计划 §2.3）。
 */
describe("ReadingLocation 线格式（镜像 bv-protocol）", () => {
  it("chapter 形态使用 camelCase 字段与 type 判别", () => {
    const loc: ReadingLocation = { type: "chapter", chapterId: "ch-1", progress: 0.42 };
    expect(JSON.parse(JSON.stringify(loc))).toEqual({
      type: "chapter",
      chapterId: "ch-1",
      progress: 0.42,
    });
  });

  it("comic 形态 imageIndex 为数字", () => {
    const loc: ReadingLocation = { type: "comic", imageIndex: 7 };
    expect(JSON.parse(JSON.stringify(loc))).toEqual({ type: "comic", imageIndex: 7 });
  });

  it("page 形态 pageIndex 为数字", () => {
    const loc: ReadingLocation = { type: "page", pageIndex: 12 };
    expect(JSON.parse(JSON.stringify(loc))).toEqual({ type: "page", pageIndex: 12 });
  });
});
