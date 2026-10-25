import { describe, expect, it } from "vitest";
import {
  COLUMN_GAP,
  columnCount,
  sheetCount,
  sheetFromProgress,
  sheetGeometry,
  sheetOffset,
  sheetToProgress,
  sheetWidth,
} from "../src/pagination";

describe("sheetGeometry 版心几何", () => {
  it("单页：列宽 = 一屏宽，步长 = 屏宽 + 缝", () => {
    const g = sheetGeometry(1440, 18, false);
    expect(g.columnWidth).toBe(sheetWidth(1440, 18, false));
    expect(g.step).toBe(g.columnWidth + COLUMN_GAP);
  });

  it("对页：两列 + 中缝拼满一屏", () => {
    const g = sheetGeometry(1440, 18, true);
    expect(g.columnWidth * 2 + COLUMN_GAP).toBeCloseTo(sheetWidth(1440, 18, true));
    expect(g.step).toBe(sheetWidth(1440, 18, true) + COLUMN_GAP);
  });

  it("版心受 36 字上限约束，不会被宽屏拉长", () => {
    // 18px * 36 字 = 648px；1600px 视口也不应超过它
    expect(sheetWidth(1600, 18, false)).toBe(648);
    // 对页 648*2+56 = 1352 < 1600-96，同样不受视口挤压
    expect(sheetWidth(1600, 18, true)).toBe(648 * 2 + COLUMN_GAP);
  });

  it("窄窗口退化为视口减留白；非法输入返回 0", () => {
    expect(sheetWidth(720, 28, false)).toBe(720 - 48 * 2);
    expect(sheetWidth(0, 18, false)).toBe(0);
    expect(sheetWidth(1440, 0, true)).toBe(0);
  });
});

describe("columnCount / sheetCount 计数", () => {
  it("内容总宽 = n*(列宽+缝)-缝 恰好 n 列", () => {
    const cw = 648;
    for (const n of [1, 2, 5, 17]) {
      const total = n * (cw + COLUMN_GAP) - COLUMN_GAP;
      expect(columnCount(total, cw)).toBe(n);
    }
  });

  it("亚像素误差不增列；零/负输入至少 1 列", () => {
    expect(columnCount(648 * 3 + 0.4, 648)).toBe(3);
    expect(columnCount(0, 648)).toBe(1);
    expect(columnCount(1000, 0)).toBe(1);
  });

  it("对页：列数 → 屏数向上取整", () => {
    expect(sheetCount(7, true)).toBe(4);
    expect(sheetCount(8, true)).toBe(4);
    expect(sheetCount(7, false)).toBe(7);
  });
});

describe("进度比例 ↔ 屏号（ADR-003 进度序列化的分页形态）", () => {
  it("读写互逆：任意屏号存取一圈回到原屏", () => {
    for (let sheets = 2; sheets <= 40; sheets++) {
      for (let s = 0; s < sheets; s++) {
        expect(sheetFromProgress(sheetToProgress(s, sheets), sheets)).toBe(s);
      }
    }
  });

  it("边界：r=0 回首屏、r=1 回末屏、单屏恒回 0/存 1", () => {
    expect(sheetFromProgress(0, 12)).toBe(0);
    expect(sheetFromProgress(1, 12)).toBe(11);
    expect(sheetFromProgress(0.5, 1)).toBe(0);
    expect(sheetToProgress(0, 1)).toBe(1);
  });

  it("越界比例收敛到有效区间", () => {
    expect(sheetFromProgress(-0.3, 10)).toBe(0);
    expect(sheetFromProgress(1.7, 10)).toBe(9);
    expect(sheetToProgress(99, 10)).toBe(1);
  });
});

describe("sheetOffset 平移量", () => {
  it("线性递增，方向符号由渲染层处理", () => {
    expect(sheetOffset(0, 704)).toBe(0);
    expect(sheetOffset(3, 704)).toBe(3 * 704);
  });
});
