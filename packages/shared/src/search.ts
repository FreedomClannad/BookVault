/**
 * 全文查找的纯文本处理：EPUB 章节 HTML 去标签、命中定位与上下文截取。
 * 桌面端阅读器的整书/章内查找使用，未来移动端复用。
 * 只做字符串运算——packages/shared 禁止依赖 DOM / Node（DOMParser 也不行）。
 *
 * 定位模型：命中以「章内字符比例」表达（hitIndex / plainLength），由各端
 * 换算成滚动位置或分页屏号，与阅读进度（ADR-003）同一套比例语义。
 */

export interface SearchHit {
  /** 命中首字符在章节纯文本中的下标（0 基） */
  index: number;
  /** 命中词在章节纯文本中的字符比例 ∈ [0,1]，用于跳转定位 */
  ratio: number;
  /** 命中前后各留 contextLen 个字符的预览片段 */
  before: string;
  hit: string;
  after: string;
}

/** stripHtml 后的实体/空白已规范化；去标签会留下换行，片段里压缩为单空格 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const MAX_QUERY_LEN = 64;

/**
 * 在章节纯文本中找全部命中（大小写不敏感，按原文toLowerCase匹配）。
 * 每章至多 maxHits 条、查询词超长直接不搜——大书逐章检索时的防爆仓。
 * 空查询 / 空文本返回 []；命中重叠不吞并（顺序扫描）。
 */
export function findHits(
  text: string,
  query: string,
  opts: { maxHits?: number; contextLen?: number } = {},
): SearchHit[] {
  const { maxHits = 50, contextLen = 18 } = opts;
  const q = query.trim();
  if (!q || q.length > MAX_QUERY_LEN || !text) return [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const hits: SearchHit[] = [];
  let from = 0;
  while (hits.length < maxHits) {
    const i = lower.indexOf(needle, from);
    if (i < 0) break;
    hits.push({
      index: i,
      ratio: text.length > 0 ? i / text.length : 0,
      before: snippet(text, Math.max(0, i - contextLen), i),
      hit: text.slice(i, i + q.length),
      after: snippet(text, i + q.length, Math.min(text.length, i + q.length + contextLen)),
    });
    from = i + q.length;
  }
  return hits;
}

/** 截片段并压掉换行（列表预览单行展示） */
function snippet(s: string, start: number, end: number): string {
  return s.slice(start, end).replace(/\n+/g, " ");
}
