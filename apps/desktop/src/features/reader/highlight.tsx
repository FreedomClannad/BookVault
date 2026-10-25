/**
 * 查找命中词的正文高亮渲染（包 B-4）：把纯文本按命中切分为 mark 片段。
 * mark 是 inline 元素，不改变多列分页的宽度量测；mark 数设上限防超长章节爆节点。
 */

import type { ReactNode } from "react";

export function highlightText(text: string, term: string, maxMarks = 300): ReactNode {
  if (!term) return text;
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let i = lower.indexOf(needle);
  let marks = 0;
  let key = 0;
  while (i >= 0 && marks < maxMarks) {
    if (i > from) parts.push(text.slice(from, i));
    parts.push(
      <mark key={key++} className="txt-hit">
        {text.slice(i, i + term.length)}
      </mark>,
    );
    marks += 1;
    from = i + term.length;
    i = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}
