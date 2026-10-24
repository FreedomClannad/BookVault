/**
 * TXT 章节标题识别规则（M1.4 与 Rust 侧同源；本文件是规则的唯一定义处，
 * Rust 侧由 M1.8 的镜像一致性测试保证不失同步）。
 *
 * 规则刻意保守：章节标题必须「行首匹配 + 短行」，避免把正文里恰好含
 * 「第X章」字样的长段落误切为章节（计划 §8 风险 6）。
 */

export interface ChapterRule {
  id: string;
  pattern: RegExp;
  description: string;
}

/** 章节标题行的最大长度（字符），超过即视为正文 */
export const MAX_HEADING_LENGTH = 40;

export const CHAPTER_RULES: readonly ChapterRule[] = [
  {
    id: "cn-chapter",
    pattern: /^[（(【\[]?第[零一二三四五六七八九十百千万0-9]{1,12}[章节卷回部集][）)】\]]?\s*\S*/,
    description: "中文「第X章/节/卷/回/部/集」",
  },
  {
    id: "en-chapter",
    pattern: /^Chapter\s+\d{1,4}(\.|\s|$)/i,
    description: "英文 Chapter N",
  },
  {
    id: "numeric-heading",
    pattern: /^\d{1,3}[、.．]\s*\S+/,
    description: "数字编号「1. 标题 / 一、标题」形态",
  },
] as const;

/** 判断一行文本是否为章节标题 */
export function isChapterHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HEADING_LENGTH) {
    return false;
  }
  return CHAPTER_RULES.some((rule) => rule.pattern.test(trimmed));
}
