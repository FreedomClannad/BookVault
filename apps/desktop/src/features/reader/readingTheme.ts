/**
 * 阅读主题 token 源（ui-style §2：阅读主题独立于 UI 主题，4 档）。
 * 所有阅读面板（TXT/EPUB/漫画/PDF）与 EPUB iframe 注入样式统一从这里取值，
 * 禁止在组件里另写色值。持久化键：reader.theme。
 */

export interface ReadingTheme {
  id: ReadingThemeId;
  label: string;
  bg: string;
  fg: string;
  /** 弱化文字（页码、加载占位）——在 bg 上保持可读的低对比色 */
  muted: string;
}

export type ReadingThemeId = "paper" | "sepia" | "gray" | "black";

export const READING_THEMES: Record<ReadingThemeId, ReadingTheme> = {
  paper: { id: "paper", label: "纸白", bg: "#fbfaf7", fg: "#26282c", muted: "#8a8d93" },
  sepia: { id: "sepia", label: "米黄", bg: "#f4eddc", fg: "#3a3328", muted: "#96876e" },
  gray: { id: "gray", label: "暗灰", bg: "#24262a", fg: "#c8cbd0", muted: "#7d8188" },
  black: { id: "black", label: "纯黑", bg: "#000000", fg: "#b9bdc4", muted: "#6d7076" },
};

const STORAGE_KEY = "reader.theme";

export function loadReadingTheme(): ReadingTheme {
  const id = localStorage.getItem(STORAGE_KEY) as ReadingThemeId | null;
  return (id && READING_THEMES[id]) || READING_THEMES.sepia;
}

export function saveReadingTheme(id: ReadingThemeId): void {
  localStorage.setItem(STORAGE_KEY, id);
}
