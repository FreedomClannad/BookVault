import { describe, expect, it } from "vitest";
import { isChapterHeading, MAX_HEADING_LENGTH } from "../src/chapter-rules";

describe("TXT 章节标题识别", () => {
  it.each([
    "第一章 初入江湖",
    "第0012章 觉醒",
    "第三卷 大结局",
    "Chapter 5 The Gate",
    "12、夜色",
    "3. 出发",
  ])("%s 识别为章节标题", (line) => {
    expect(isChapterHeading(line)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "第二天他醒了，窗外的雨还没有停，屋檐滴水的声音一下一下敲在青石板上，像是谁在数着更漏", // 正文长句
    "他说的是第一章里的内容，但那已经是很多年以前的事了，如今再提起，众人也只是唏嘘", // 正文含关键词但行过长
    "第一章　这个标题特别特别特别特别特别特别特别特别特别特别长，绝对不是正常章节标题而是伪装成正文的超长行", // 超长标题行
  ])("%j 不识别为章节标题", (line) => {
    expect(isChapterHeading(line)).toBe(false);
  });

  it("长度上限常量暴露给 Rust 侧镜像测试使用", () => {
    expect(MAX_HEADING_LENGTH).toBeGreaterThan(0);
  });
});
