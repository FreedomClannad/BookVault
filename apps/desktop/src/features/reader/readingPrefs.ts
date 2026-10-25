/**
 * 阅读偏好的统一来源：**全局默认 + 按书覆盖** 两层（Wenku8 式「一本书一套排版」）。
 *
 * - 全局默认：设置页（Settings.tsx）编辑。键沿用历史 reader.theme / reader.fontSize /
 *   reader.lineHeight / reader.font，新增 reader.pageMode / reader.spread /
 *   reader.anim / reader.animSpeed / reader.autoSec。
 * - 按书覆盖：阅读器排版面板编辑，存 reader.work.<workId>（JSON 白名单字段）；
 *   workId 来自 open_book（同一作品多版本共享一套设置）。
 * - theme 保持全局：阅读主题是环境偏好，不随书切换。
 *
 * EPUB iframe 是独立文档、CSS 变量跨不过边界，所有排版值由调用方插值注入
 * （readingTheme.ts 仍是主题色权威源）。
 */

import { loadReadingTheme, saveReadingTheme, type ReadingTheme } from "./readingTheme";

/** 小说阅读模式：分页（横排）/ 滚动 / 竖排分页（ui-style §3：平移翻页默认） */
export type PageMode = "paged" | "scroll" | "vertical";

/** 翻页动画：平移 / 覆盖（新页盖旧页）/ 无 */
export type PageAnim = "slide" | "cover" | "none";

export interface ReadingPrefs {
  theme: ReadingTheme;
  fontSize: number;
  lineHeight: number;
  serif: boolean;
  pageMode: PageMode;
  /** 对页：分页/竖排时一屏两列（宽屏阅读）；滚动模式忽略 */
  spread: boolean;
  anim: PageAnim;
  /** 翻页动画时长 ms */
  animSpeed: number;
  /** 自动阅读：每屏（滚动模式按屏宽换算滚速）秒数 */
  autoSec: number;
}

/** 按书覆盖层可持久化的字段（theme 有意排除，见文件头） */
export interface WorkPrefsPatch {
  fontSize: number;
  lineHeight: number;
  serif: boolean;
  pageMode: PageMode;
  spread: boolean;
  anim: PageAnim;
  animSpeed: number;
  autoSec: number;
}

/** ui-style §3 字体栈：正文默认黑体，衬线阅读可选宋体 */
export const FONT_SANS =
  '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
export const FONT_SERIF = 'Georgia, "Songti SC", "SimSun", "Noto Serif SC", serif';

const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 28;
const LINE_HEIGHT_MIN = 1.4;
const LINE_HEIGHT_MAX = 2.0;
const ANIM_SPEED_MIN = 120;
const ANIM_SPEED_MAX = 800;
const AUTO_SEC_MIN = 2;
const AUTO_SEC_MAX = 60;

/** 翻页动画速度档位（排版面板用）：快 / 中 / 慢 */
export const ANIM_SPEED_PRESETS: { label: string; value: number }[] = [
  { label: "快", value: 200 },
  { label: "中", value: 340 },
  { label: "慢", value: 520 },
];

/** 自动阅读档位（秒/屏）；滚动模式按 px/s = 900/autoSec 换算 */
export const AUTO_SEC_PRESETS = [4, 8, 15, 30];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampFontSize(size: number): number {
  return clamp(size, FONT_SIZE_MIN, FONT_SIZE_MAX);
}

export function clampLineHeight(height: number): number {
  const snapped = Math.round(height * 10) / 10;
  return clamp(snapped, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX);
}

function clampAnimSpeed(ms: number): number {
  return clamp(Math.round(ms), ANIM_SPEED_MIN, ANIM_SPEED_MAX);
}

function clampAutoSec(sec: number): number {
  return clamp(Math.round(sec), AUTO_SEC_MIN, AUTO_SEC_MAX);
}

function asPageMode(v: unknown): PageMode {
  return v === "scroll" || v === "vertical" || v === "paged" ? v : "paged";
}

function asPageAnim(v: unknown): PageAnim {
  return v === "slide" || v === "cover" || v === "none" ? v : "slide";
}

function loadGlobal(): ReadingPrefs {
  const fontSize = Number(localStorage.getItem("reader.fontSize") ?? 18);
  const lineHeight = Number(localStorage.getItem("reader.lineHeight") ?? 1.7);
  return {
    theme: loadReadingTheme(),
    fontSize: clampFontSize(Number.isFinite(fontSize) ? fontSize : 18),
    lineHeight: clampLineHeight(Number.isFinite(lineHeight) ? lineHeight : 1.7),
    serif: localStorage.getItem("reader.font") === "serif",
    pageMode: asPageMode(localStorage.getItem("reader.pageMode")),
    spread: localStorage.getItem("reader.spread") === "1",
    anim: asPageAnim(localStorage.getItem("reader.anim")),
    animSpeed: clampAnimSpeed(Number(localStorage.getItem("reader.animSpeed") ?? 340) || 340),
    autoSec: clampAutoSec(Number(localStorage.getItem("reader.autoSec") ?? 8) || 8),
  };
}

function saveGlobal(p: ReadingPrefs): void {
  saveReadingTheme(p.theme.id);
  localStorage.setItem("reader.fontSize", String(p.fontSize));
  localStorage.setItem("reader.lineHeight", String(p.lineHeight));
  localStorage.setItem("reader.font", p.serif ? "serif" : "sans");
  localStorage.setItem("reader.pageMode", p.pageMode);
  localStorage.setItem("reader.spread", p.spread ? "1" : "0");
  localStorage.setItem("reader.anim", p.anim);
  localStorage.setItem("reader.animSpeed", String(p.animSpeed));
  localStorage.setItem("reader.autoSec", String(p.autoSec));
}

const workKey = (workId: string) => `reader.work.${workId}`;

/** 读按书覆盖层；localStorage 可能被手改，逐字段校验（非法即回退全局默认） */
function loadWorkPatch(workId: string): Partial<WorkPrefsPatch> {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(workKey(workId)) ?? "null");
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const o = raw as Record<string, unknown>;
  const patch: Partial<WorkPrefsPatch> = {};
  if (Number.isFinite(o.fontSize)) patch.fontSize = clampFontSize(Number(o.fontSize));
  if (Number.isFinite(o.lineHeight)) patch.lineHeight = clampLineHeight(Number(o.lineHeight));
  if (typeof o.serif === "boolean") patch.serif = o.serif;
  if (typeof o.pageMode === "string") patch.pageMode = asPageMode(o.pageMode);
  if (typeof o.spread === "boolean") patch.spread = o.spread;
  if (typeof o.anim === "string") patch.anim = asPageAnim(o.anim);
  if (Number.isFinite(o.animSpeed)) patch.animSpeed = clampAnimSpeed(Number(o.animSpeed));
  if (Number.isFinite(o.autoSec)) patch.autoSec = clampAutoSec(Number(o.autoSec));
  return patch;
}

/**
 * 载入偏好：无 workId（设置页/骨架屏）→ 全局默认；
 * 有 workId（阅读器）→ 全局默认叠加按书覆盖。
 */
export function loadReadingPrefs(workId?: string): ReadingPrefs {
  const base = loadGlobal();
  if (!workId) return base;
  return { ...base, ...loadWorkPatch(workId) };
}

/** 保存偏好：有 workId 只写按书覆盖层（不动全局默认），无 workId 写全局 */
export function saveReadingPrefs(prefs: ReadingPrefs, workId?: string): void {
  if (!workId) {
    saveGlobal(prefs);
    return;
  }
  const patch: WorkPrefsPatch = {
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    serif: prefs.serif,
    pageMode: prefs.pageMode,
    spread: prefs.spread,
    anim: prefs.anim,
    animSpeed: prefs.animSpeed,
    autoSec: prefs.autoSec,
  };
  localStorage.setItem(workKey(workId), JSON.stringify(patch));
}

/** 清除某本书的排版覆盖，回到全局默认（排版面板「恢复默认」） */
export function resetWorkPrefs(workId: string): void {
  localStorage.removeItem(workKey(workId));
}
