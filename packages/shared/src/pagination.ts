/**
 * 多列分页的纯几何计算：桌面 TXT 阅读器的分页 / 竖排 / 对页引擎使用，
 * 未来移动端阅读器复用。只做算术——packages/shared 禁止依赖 DOM / Node。
 *
 * 模型：正文在固定高度的容器里按列宽分栏（CSS 多列，竖排为 vertical-rl）。
 * 一「屏」（sheet）展示一列（单页）或两列（对页）；翻页 = 容器平移一个 step。
 * 进度换算：章内比例 r ∈ [0,1]，读第 s 屏（0 基）存 r=(s+1)/sheets，
 * 恢复时 s = ceil(r*sheets)-1（读写互逆，见 pagination.test.ts）。
 */

/** 两列之间的中缝（列间距），横排竖排同义 */
export const COLUMN_GAP = 56;

/** 版心左右最小留白（px），防止贴边 */
export const PAGE_MARGIN = 48;

/**
 * 一屏（sheet）的可见宽度：受视口与版心上限双重约束。
 * 版心按「桌面每行 30–42 字」（ui-style §3）取 36 字 ≈ 36*fontSize；
 * 对页为两列 + 中缝。窗口过窄时退化为视口减留白。
 */
export function sheetWidth(
  viewportW: number,
  fontSize: number,
  spread: boolean,
  gap: number = COLUMN_GAP,
): number {
  if (!(viewportW > 0) || !(fontSize > 0)) return 0;
  const single = fontSize * 36;
  const want = spread ? single * 2 + gap : single;
  const capped = Math.min(viewportW - PAGE_MARGIN * 2, want);
  return Math.max(single / 2, capped);
}

/** 列宽与翻页步长：单页一列；对页两列（中缝 gap）。step = 一屏宽 + 中缝。 */
export function sheetGeometry(
  viewportW: number,
  fontSize: number,
  spread: boolean,
  gap: number = COLUMN_GAP,
): { columnWidth: number; step: number } {
  const sw = sheetWidth(viewportW, fontSize, spread, gap);
  return {
    columnWidth: spread ? (sw - gap) / 2 : sw,
    step: sw > 0 ? sw + gap : 0,
  };
}

/**
 * 量出的内容总宽 → 列数。多列布局的滚动总宽 ≈ n*(列宽+缝) - 缝
 * （末列无尾缝），四舍五入吸收亚像素误差。
 */
export function columnCount(
  contentWidth: number,
  columnWidth: number,
  gap: number = COLUMN_GAP,
): number {
  if (!(columnWidth > 0) || !(contentWidth > 0)) return 1;
  return Math.max(1, Math.round((contentWidth + gap) / (columnWidth + gap)));
}

/** 列数 → 屏数：对页两列一屏（奇数列时末屏半满） */
export function sheetCount(columns: number, spread: boolean): number {
  const n = Math.max(1, Math.ceil(columns));
  return spread ? Math.max(1, Math.ceil(n / 2)) : n;
}

/** 第 sheet 屏的平移量；竖排方向取反由渲染层处理 */
export function sheetOffset(sheet: number, step: number): number {
  return sheet * step;
}

/** 保存的进度比例 → 恢复到的屏号（0 基）。r=0 → 首屏，r=1 → 末屏。 */
export function sheetFromProgress(ratio: number, sheets: number): number {
  if (!(sheets > 1)) return 0;
  const r = Math.min(1, Math.max(0, ratio));
  // epsilon 吸收 (s+1)/sheets 的浮点回乘误差（如 6/40*40 = 6.000…01 会使 ceil 多进一）
  return Math.min(sheets - 1, Math.max(0, Math.ceil(r * sheets - 1e-9) - 1));
}

/** 屏号 → 保存的进度比例（读完第 s 屏记 (s+1)/sheets；单屏恒 1） */
export function sheetToProgress(sheet: number, sheets: number): number {
  if (!(sheets > 1)) return 1;
  return Math.min(1, Math.max(0, (sheet + 1) / sheets));
}
