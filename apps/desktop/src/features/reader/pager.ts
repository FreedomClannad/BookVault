/**
 * 滚动模式小说的翻页原语（电子书式「内容优先」导航的 UI 层契约）：
 * Reader 层统一先按屏推进正文，翻到章首/章末边界（原语返回 false）才跨章——
 * 章只是内容流的分节，不再作为翻页的最小单位。TXT（滚动模式）与 EPUB（iframe
 * 滚动）各自实现；分页/竖排模式不经过此契约（屏号导航由 Reader 层直接驱动）。
 */
export interface ScrollPager {
  /** 向下翻一屏；已在章末返回 false（调用方据此跨到下一章章首） */
  pageDown(): boolean;
  /** 向上翻一屏；已在章首返回 false（调用方据此跨到上一章章尾） */
  pageUp(): boolean;
}
