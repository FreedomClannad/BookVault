/**
 * 分类词表（与 Rust 侧 library::CATEGORIES 保持一致；''=未分类）与
 * 封面占位哈希色（同一本书颜色稳定——ui-style §5）。
 */

export const CATEGORIES: string[] = [
  "玄幻",
  "都市",
  "历史",
  "武侠",
  "科幻",
  "言情",
  "悬疑",
  "漫画",
  "技术",
  "文档",
];

/** 筛选/列表展示用的格式名（与 book_files.format 枚举一致） */
export const FORMAT_LABELS: Record<string, string> = {
  epub: "EPUB",
  txt: "TXT",
  pdf: "PDF",
  cbz: "CBZ",
  image_dir: "图片文件夹",
};

export function coverHashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 34% 40%)`;
}
