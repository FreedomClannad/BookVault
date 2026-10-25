/**
 * 统一阅读器框架（沉浸式）：阅读时全窗口接管、正文铺满，不再有常驻侧栏与双层工具栏。
 * 交互模型（ui-style §1「工具栏自动隐藏，交互时浮现」）：
 * - 底部悬浮工具栏：鼠标移动/点击唤出，静止 2.5s 淡出；悬停或目录抽屉打开时不隐藏；
 * - 章节目录/书签/页码跳转：右侧滑出抽屉（覆盖式，不挤压正文）；
 * - 键盘：←/→ 翻章/翻页（PgUp/PgDn 同向），空格仅用于漫画与 PDF，小说保留空格滚屏；
 * - 小说分页/竖排（Wenku8 式交互）：页码导航状态上提至此（ADR-002），翻页动画由
 *   TxtReader 呈现；排版面板按书记忆（readingPrefs 两层：全局默认 + 按书覆盖）。
 * 进度保存绑定内容哈希（ADR-003），卸载时立即落盘；分页屏号与章内比例互转后存取。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { sheetFromProgress, sheetToProgress } from "@bookvault/shared";
import { api, type OpenedBook, type ReadingLocation } from "../../app/api";
import { ComicReader, type ComicFit } from "./ComicReader";
import { EpubReader } from "./EpubReader";
import { PdfReader } from "./PdfReader";
import { TxtReader } from "./TxtReader";
import { isTypingTarget } from "./keyboard";
import {
  ANIM_SPEED_PRESETS,
  AUTO_SEC_PRESETS,
  clampFontSize,
  clampLineHeight,
  loadReadingPrefs,
  resetWorkPrefs,
  saveReadingPrefs,
  type PageAnim,
  type PageMode,
  type ReadingPrefs,
} from "./readingPrefs";
import { READING_THEMES } from "./readingTheme";

interface Props {
  fileId: string;
  onExit: () => void;
}

type ComicMode = "page" | "scroll";

const COMIC_FITS: ComicFit[] = ["fit-width", "fit-height", "original"];
const COMIC_FIT_LABEL: Record<ComicFit, string> = {
  "fit-width": "适宽",
  "fit-height": "适高",
  original: "原始",
};
const CHROME_HIDE_DELAY_MS = 2500;

function ChromeBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 cursor-pointer items-center rounded-full px-2.5 text-[13px] text-chrome-fg/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function ChromeDivider() {
  return <span className="mx-0.5 h-5 w-px flex-none bg-white/15" aria-hidden="true" />;
}

/** 排版面板里的一行分段选择器 */
function SegRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { v: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 flex-none text-chrome-muted">{label}</span>
      <div className="flex flex-1 gap-1">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`flex-1 cursor-pointer rounded-md px-1 py-1 text-xs transition-colors ${
              o.v === value
                ? "bg-seal/90 text-white"
                : "bg-white/5 text-chrome-fg/80 hover:bg-white/10"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 排版面板（Wenku8 式「一本书一套排版」）：改动即按书记忆，恢复默认回全局 */
function TypoPanel({
  prefs,
  onPrefs,
  onReset,
}: {
  prefs: ReadingPrefs;
  onPrefs: (patch: Partial<ReadingPrefs>) => void;
  onReset: () => void;
}) {
  return (
    <div className="absolute bottom-11 right-0 z-30 w-[19rem] space-y-2.5 rounded-xl bg-chrome-deep/95 p-3.5 text-[13px] text-chrome-fg shadow-2 backdrop-blur">
      <SegRow
        label="模式"
        value={prefs.pageMode}
        options={[
          { v: "paged", label: "分页" },
          { v: "scroll", label: "滚动" },
          { v: "vertical", label: "竖排" },
        ]}
        onChange={(v) => onPrefs({ pageMode: v as PageMode })}
      />
      {/* 对页仅横排分页：竖排分片沿纵轴堆叠，双页并排不适用（见 TxtReader 文件头实测注） */}
      {prefs.pageMode === "paged" && (
        <SegRow
          label="版式"
          value={prefs.spread ? "double" : "single"}
          options={[
            { v: "single", label: "单页" },
            { v: "double", label: "对页" },
          ]}
          onChange={(v) => onPrefs({ spread: v === "double" })}
        />
      )}
      <SegRow
        label="翻页"
        value={prefs.anim}
        options={[
          { v: "slide", label: "平移" },
          { v: "cover", label: "覆盖" },
          { v: "none", label: "无" },
        ]}
        onChange={(v) => onPrefs({ anim: v as PageAnim })}
      />
      <SegRow
        label="速度"
        value={String(prefs.animSpeed)}
        options={ANIM_SPEED_PRESETS.map((p) => ({ v: String(p.value), label: p.label }))}
        onChange={(v) => onPrefs({ animSpeed: Number(v) })}
      />
      <div className="flex items-center gap-1.5">
        <span className="w-10 flex-none text-chrome-muted">字号</span>
        <ChromeBtn
          title="字号 -"
          onClick={() => onPrefs({ fontSize: clampFontSize(prefs.fontSize - 2) })}
        >
          A-
        </ChromeBtn>
        <span className="min-w-[2ch] text-center text-xs text-chrome-muted">{prefs.fontSize}</span>
        <ChromeBtn
          title="字号 +"
          onClick={() => onPrefs({ fontSize: clampFontSize(prefs.fontSize + 2) })}
        >
          A+
        </ChromeBtn>
        <span className="ml-auto flex-none text-chrome-muted">行高</span>
        <ChromeBtn
          title="行高 -"
          onClick={() => onPrefs({ lineHeight: clampLineHeight(prefs.lineHeight - 0.1) })}
        >
          −
        </ChromeBtn>
        <span className="min-w-[3ch] text-center text-xs text-chrome-muted">
          {prefs.lineHeight.toFixed(1)}
        </span>
        <ChromeBtn
          title="行高 +"
          onClick={() => onPrefs({ lineHeight: clampLineHeight(prefs.lineHeight + 0.1) })}
        >
          ＋
        </ChromeBtn>
      </div>
      <SegRow
        label="字体"
        value={prefs.serif ? "serif" : "sans"}
        options={[
          { v: "sans", label: "黑体" },
          { v: "serif", label: "宋体" },
        ]}
        onChange={(v) => onPrefs({ serif: v === "serif" })}
      />
      <SegRow
        label="自动"
        value={String(prefs.autoSec)}
        options={AUTO_SEC_PRESETS.map((s) => ({ v: String(s), label: `${s}秒` }))}
        onChange={(v) => onPrefs({ autoSec: Number(v) })}
      />
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[11px] text-chrome-muted">排版按本书独立记忆</span>
        <button
          type="button"
          onClick={onReset}
          className="cursor-pointer text-xs text-chrome-muted underline-offset-2 transition-colors hover:text-white hover:underline"
        >
          恢复全局默认
        </button>
      </div>
    </div>
  );
}

export function Reader({ fileId, onExit }: Props) {
  const [opened, setOpened] = useState<OpenedBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driftDismissed, setDriftDismissed] = useState(false);
  const [prefs, setPrefs] = useState<ReadingPrefs>(loadReadingPrefs);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [themePopOpen, setThemePopOpen] = useState(false);
  const [typoOpen, setTypoOpen] = useState(false);
  const [autoOn, setAutoOn] = useState(false);

  // 导航状态（按内容类型上提；渲染器受控渲染）
  const [chapterIdx, setChapterIdx] = useState(0);
  const [pageNum, setPageNum] = useState(0);
  const [comicIdx, setComicIdx] = useState(0);
  /** 用户主动翻页/切模式时自增：条漫模式据此区分「主动跳页」与「滚动经过」 */
  const [comicNavSeq, setComicNavSeq] = useState(0);
  /** 漫画翻页方向（1 下一页 / -1 上一页 / 0 跳页不播动画） */
  const [comicDir, setComicDir] = useState(0);
  const [comicMode, setComicMode] = useState<ComicMode>(() =>
    localStorage.getItem("comic.mode") === "scroll" ? "scroll" : "page",
  );
  const [fit, setFit] = useState<ComicFit>(() => {
    const saved = localStorage.getItem("comic.fit");
    return saved === "fit-height" || saved === "original" ? saved : "fit-width";
  });
  const [scale, setScale] = useState(1.2);

  // 小说分页/竖排导航（ADR-002：页码状态上提）
  const [sheets, setSheets] = useState(0);
  const [novelPage, setNovelPage] = useState(0);
  /** 程序化跳页序号：恢复进度/切章/TOC 跳转时递增（TxtReader 据此抑制翻页动画） */
  const [navSeq, setNavSeq] = useState(0);
  /** 分页布局量测后的一次性意图：恢复保存进度 / 回到上一章末屏 */
  const restoreRatioRef = useRef<number | null>(null);
  const pendingTailRef = useRef(false);

  const lastSave = useRef<ReadingLocation | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverChrome = useRef(false);
  const overlayOpen = useRef(false);
  overlayOpen.current = drawerOpen || themePopOpen || typoOpen;
  const activeDrawerRef = useRef<HTMLButtonElement | null>(null);

  const contents = opened?.book.contents;
  const chapters = contents && "novel" in contents ? contents.novel.chapters : null;
  const pdfDoc = contents && "document" in contents ? contents.document : null;
  const comicDoc = contents && "comic" in contents ? contents.comic : null;

  // 逐书偏好：打开书籍后切到「这本书」的设置（按书覆盖叠加全局默认）
  const workId = opened?.workId ?? null;
  useEffect(() => {
    if (!workId) return;
    setPrefs(loadReadingPrefs(workId));
    setNovelPage(0);
    setSheets(0);
    restoreRatioRef.current = null;
    pendingTailRef.current = false;
  }, [workId]);

  const novelPaged =
    Boolean(chapters) && (prefs.pageMode === "paged" || prefs.pageMode === "vertical");

  useEffect(() => {
    let cancelled = false;
    void api
      .openBook(fileId)
      .then((b) => {
        if (!cancelled) setOpened(b);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  // 打开时按已保存进度初始化导航状态
  useEffect(() => {
    if (!opened) return;
    const loc = opened.progress[0]?.location ?? null;
    const c = opened.book.contents;
    if ("novel" in c) {
      const id = loc?.type === "chapter" ? loc.chapterId : null;
      const i = c.novel.chapters.findIndex((ch) => ch.id === id);
      setChapterIdx(i >= 0 ? i : 0);
      // 分页模式下首屏布局量测完成后按此比例换算屏号（handlePageCount）
      restoreRatioRef.current = loc?.type === "chapter" ? loc.progress : null;
      setNovelPage(0);
      setSheets(0);
    } else if ("comic" in c) {
      const i = loc?.type === "comic" ? loc.imageIndex : 0;
      setComicIdx(Math.min(Math.max(0, i), Math.max(0, c.comic.pages.length - 1)));
      setComicDir(0);
      setComicNavSeq((s) => s + 1);
    } else if ("document" in c) {
      const i = loc?.type === "page" ? loc.pageIndex : 0;
      setPageNum(Math.min(Math.max(0, i), c.document.pages - 1));
    }
  }, [opened]);

  const save = useCallback(
    (loc: ReadingLocation) => {
      lastSave.current = loc;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void api.saveReadingProgress(fileId, loc).catch(() => {});
      }, 800);
    },
    [fileId],
  );

  // 卸载时立即落盘，退出前 800ms 内的进度也不丢（ui-style §3 退出自动保存）
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const loc = lastSave.current;
      if (loc) void api.saveReadingProgress(fileId, loc).catch(() => {});
    };
  }, [fileId]);

  // 漫画/PDF 的进度由本层的导航状态直接驱动；小说的章内滚动比例由渲染器上报
  useEffect(() => {
    if (comicDoc) save({ type: "comic", imageIndex: comicIdx });
  }, [comicDoc, comicIdx, save]);

  useEffect(() => {
    if (pdfDoc) save({ type: "page", pageIndex: pageNum });
  }, [pdfDoc, pageNum, save]);

  // 分页/竖排阅读进度：屏号 → 章内比例（与滚动模式同一进度模型，ADR-003）
  useEffect(() => {
    if (!novelPaged || sheets <= 0) return;
    const ch = chapters?.[chapterIdx];
    if (!ch) return;
    save({ type: "chapter", chapterId: ch.id, progress: sheetToProgress(novelPage, sheets) });
  }, [novelPaged, sheets, novelPage, chapterIdx, chapters, save]);

  const switchChapter = useCallback(
    (idx: number, opts?: { tail?: boolean }) => {
      if (!chapters) return;
      const i = Math.min(chapters.length - 1, Math.max(0, idx));
      setChapterIdx(i);
      // 布局量测后的一次性意图：tail=回到上一章末屏；否则置顶/按恢复比例
      pendingTailRef.current = Boolean(opts?.tail) && novelPaged;
      restoreRatioRef.current = null;
      setNovelPage(0);
      setSheets(0);
      setNavSeq((s) => s + 1);
      save({ type: "chapter", chapterId: chapters[i].id, progress: 0 });
    },
    [chapters, novelPaged, save],
  );

  /** 分页布局量测回调：消费恢复/末屏意图，并钳制越界屏号 */
  const handlePageCount = useCallback((n: number) => {
    setSheets(n);
    if (pendingTailRef.current) {
      pendingTailRef.current = false;
      setNovelPage(Math.max(0, n - 1));
      return;
    }
    if (restoreRatioRef.current != null) {
      const r = restoreRatioRef.current;
      restoreRatioRef.current = null;
      setNovelPage(sheetFromProgress(r, n));
      return;
    }
    setNovelPage((p) => Math.min(p, Math.max(0, n - 1)));
  }, []);

  const comicNav = useCallback(
    (delta: number) => {
      if (!comicDoc) return;
      setComicDir(delta > 0 ? 1 : -1);
      setComicIdx((p) => Math.min(comicDoc.pages.length - 1, Math.max(0, p + delta)));
      setComicNavSeq((s) => s + 1);
    },
    [comicDoc],
  );

  const navPrev = useCallback(() => {
    if (chapters) {
      if (novelPaged && novelPage > 0) {
        setNovelPage((p) => p - 1);
        return;
      }
      if (chapterIdx > 0) switchChapter(chapterIdx - 1, { tail: true });
      return;
    }
    if (pdfDoc) {
      setPageNum((p) => Math.max(0, p - 1));
      return;
    }
    if (comicDoc) comicNav(-1);
  }, [chapters, novelPaged, novelPage, chapterIdx, switchChapter, pdfDoc, comicDoc, comicNav]);

  const navNext = useCallback(() => {
    if (chapters) {
      if (novelPaged && novelPage < sheets - 1) {
        setNovelPage((p) => p + 1);
        return;
      }
      if (chapterIdx < chapters.length - 1) switchChapter(chapterIdx + 1);
      return;
    }
    if (pdfDoc) {
      setPageNum((p) => Math.min(pdfDoc.pages - 1, p + 1));
      return;
    }
    if (comicDoc) comicNav(1);
  }, [
    chapters,
    novelPaged,
    novelPage,
    sheets,
    chapterIdx,
    switchChapter,
    pdfDoc,
    comicDoc,
    comicNav,
  ]);

  // 统一键盘导航；Esc 关闭浮层。EPUB iframe 内的按键不冒泡到本层（历史限制）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.key === "Escape") {
        if (typoOpen) setTypoOpen(false);
        else if (themePopOpen) setThemePopOpen(false);
        else if (drawerOpen) setDrawerOpen(false);
        return;
      }
      if (e.key === "ArrowRight") navNext();
      if (e.key === "ArrowLeft") navPrev();
      // PgUp/PgDn 仅在翻页语义下劫持；小说滚动模式留给浏览器默认滚动
      const pagedNav = novelPaged || Boolean(pdfDoc) || Boolean(comicDoc);
      if (e.key === "PageDown" && pagedNav) {
        e.preventDefault();
        navNext();
      }
      if (e.key === "PageUp" && pagedNav) {
        e.preventDefault();
        navPrev();
      }
      if ((e.key === " " || e.code === "Space") && (pdfDoc || comicDoc)) {
        e.preventDefault();
        navNext();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [navNext, navPrev, drawerOpen, themePopOpen, typoOpen, novelPaged, pdfDoc, comicDoc]);

  // ---- 悬浮工具栏自动隐藏 ----
  const showChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!hoverChrome.current && !overlayOpen.current) setChromeVisible(false);
    }, CHROME_HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    showChrome();
    window.addEventListener("mousemove", showChrome);
    return () => {
      window.removeEventListener("mousemove", showChrome);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [showChrome]);

  // 浮层打开期间保持可见，关闭后重新计时
  useEffect(() => {
    if (drawerOpen || themePopOpen || typoOpen) showChrome();
  }, [drawerOpen, themePopOpen, typoOpen, showChrome]);

  // 打开抽屉时把当前章节/页滚到可视区
  useEffect(() => {
    if (drawerOpen) activeDrawerRef.current?.scrollIntoView({ block: "center" });
  }, [drawerOpen]);

  // 排版调整落库：阅读中调整 = 按书记忆（workId 覆盖层）；设置页编辑的才是全局默认
  const updatePrefs = useCallback(
    (patch: Partial<ReadingPrefs>) => {
      setPrefs((p) => {
        const next = { ...p, ...patch };
        saveReadingPrefs(next, workId ?? undefined);
        return next;
      });
    },
    [workId],
  );

  /** 阅读模式/对页切换：先按当前屏号捕获章内比例，量测后回到等比位置（不跳回章首） */
  const setLayoutPref = useCallback(
    (patch: Partial<ReadingPrefs>) => {
      if (novelPaged && sheets > 0 && ("pageMode" in patch || "spread" in patch)) {
        restoreRatioRef.current = sheetToProgress(novelPage, sheets);
      }
      updatePrefs(patch);
    },
    [novelPaged, sheets, novelPage, updatePrefs],
  );

  // 自动阅读：分页/PDF/漫画按 interval 翻页；小说滚动模式换算 px/s 由 TxtReader rAF 驱动
  const autoScrollPx =
    autoOn && chapters && !novelPaged ? Math.round(900 / Math.max(2, prefs.autoSec)) : 0;

  useEffect(() => {
    if (!autoOn) return;
    if (chapters && !novelPaged) return; // 滚动模式走 TxtReader 的 rAF 自动滚动
    const iv = setInterval(() => navNext(), Math.max(2, prefs.autoSec) * 1000);
    return () => clearInterval(iv);
  }, [autoOn, chapters, novelPaged, navNext, prefs.autoSec]);

  // 自动阅读到全书末页即停（滚动模式小说由 handleAutoEnd 在最后一章末尾停止）。
  // sheets>0 守卫：切章瞬间 sheets 被重置为 0，不视为「末页」
  useEffect(() => {
    if (!autoOn) return;
    const bookEnd =
      (pdfDoc && pageNum >= pdfDoc.pages - 1) ||
      (comicDoc && comicIdx >= comicDoc.pages.length - 1) ||
      Boolean(
        chapters &&
        novelPaged &&
        sheets > 0 &&
        chapterIdx >= chapters.length - 1 &&
        novelPage >= sheets - 1,
      );
    if (bookEnd) setAutoOn(false);
  }, [
    autoOn,
    pdfDoc,
    pageNum,
    comicDoc,
    comicIdx,
    chapters,
    novelPaged,
    chapterIdx,
    novelPage,
    sheets,
  ]);

  const handleAutoEnd = useCallback(() => {
    // 滚动模式读到章末：还有下一章则续读，全书末章则停
    if (chapters && chapterIdx < chapters.length - 1) switchChapter(chapterIdx + 1);
    else setAutoOn(false);
  }, [chapters, chapterIdx, switchChapter]);

  const toggleComicMode = useCallback(() => {
    setComicMode((m) => {
      const next = m === "page" ? "scroll" : "page";
      localStorage.setItem("comic.mode", next);
      return next;
    });
    setComicDir(0);
    setComicNavSeq((s) => s + 1);
  }, []);

  const cycleFit = useCallback(() => {
    setFit((f) => {
      const next = COMIC_FITS[(COMIC_FITS.indexOf(f) + 1) % COMIC_FITS.length];
      localStorage.setItem("comic.fit", next);
      return next;
    });
  }, []);

  // ---- 渲染 ----

  if (error) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-paper">
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-8 text-center leading-relaxed text-danger">
          <div>{error}</div>
          <button className="btn" onClick={onExit}>
            返回书架
          </button>
        </div>
      </div>
    );
  }

  if (!opened) {
    return (
      <div
        className="flex h-full min-w-0 items-center justify-center"
        style={{ background: prefs.theme.bg }}
      >
        <div className="w-full max-w-[40em] space-y-5 px-8" aria-hidden="true">
          <div className="h-7 w-2/5 animate-pulse rounded bg-black/8" />
          {[88, 100, 94, 72, 100, 90, 60].map((w, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-black/6"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  const latest = opened.progress[0]?.location ?? null;
  const showDrift = opened.hashDrift && !driftDismissed && opened.progress.length > 0;

  const body = (() => {
    const c = opened.book.contents;
    if ("novel" in c && opened.file.format === "txt") {
      return (
        <TxtReader
          fileId={fileId}
          chapterId={c.novel.chapters[chapterIdx]?.id ?? ""}
          initial={latest}
          prefs={prefs}
          onProgress={save}
          page={novelPage}
          spread={prefs.spread}
          onPageCount={handlePageCount}
          navSeq={navSeq}
          autoScrollPx={autoScrollPx}
          onAutoEnd={handleAutoEnd}
        />
      );
    }
    if ("novel" in c) {
      return (
        <EpubReader
          fileId={fileId}
          chapters={c.novel.chapters}
          chapterId={c.novel.chapters[chapterIdx]?.id ?? ""}
          initial={latest}
          prefs={prefs}
          onProgress={save}
          onActivity={showChrome}
        />
      );
    }
    if ("comic" in c) {
      return (
        <ComicReader
          fileId={fileId}
          pages={c.comic.pages}
          page={comicIdx}
          navSeq={comicNavSeq}
          mode={comicMode}
          fit={fit}
          prefs={prefs}
          anim={prefs.anim}
          animSpeed={prefs.animSpeed}
          dir={comicDir}
          onPageVisible={setComicIdx}
        />
      );
    }
    if ("document" in c) {
      return (
        <PdfReader
          fileId={fileId}
          toc={c.document.toc}
          page={pageNum}
          scale={scale}
          prefs={prefs}
        />
      );
    }
    return null;
  })();

  const restartFromBeginning = () => {
    setOpened({ ...opened, progress: [] });
    setDriftDismissed(true);
    restoreRatioRef.current = null;
    pendingTailRef.current = false;
    if (chapters) switchChapter(0);
    if (pdfDoc) setPageNum(0);
    if (comicDoc) {
      setComicDir(0);
      setComicIdx(0);
      setComicNavSeq((s) => s + 1);
    }
  };

  const chromeBar = (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center transition-opacity duration-300 ${
        chromeVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className="pointer-events-auto relative flex items-center gap-1 rounded-full bg-chrome-deep/95 px-2 py-1.5 text-chrome-fg shadow-2 backdrop-blur"
        onMouseEnter={() => (hoverChrome.current = true)}
        onMouseLeave={() => {
          hoverChrome.current = false;
          showChrome();
        }}
      >
        <ChromeBtn title="返回书架" onClick={onExit}>
          ←
        </ChromeBtn>
        <ChromeDivider />

        {chapters && (
          <>
            <ChromeBtn
              title="上一章"
              disabled={chapterIdx <= 0}
              onClick={() => switchChapter(chapterIdx - 1)}
            >
              上一章
            </ChromeBtn>
            <span
              className="max-w-[240px] truncate px-1.5 text-xs text-chrome-muted"
              title={chapters[chapterIdx]?.title ?? ""}
            >
              {chapterIdx + 1}/{chapters.length} {chapters[chapterIdx]?.title ?? ""}
              {novelPaged && sheets > 0 ? ` · ${Math.min(novelPage + 1, sheets)}/${sheets}` : ""}
            </span>
            <ChromeBtn
              title="下一章"
              disabled={chapterIdx >= chapters.length - 1}
              onClick={() => switchChapter(chapterIdx + 1)}
            >
              下一章
            </ChromeBtn>
            <ChromeDivider />
            <ChromeBtn
              title="字号 -"
              onClick={() => updatePrefs({ fontSize: clampFontSize(prefs.fontSize - 2) })}
            >
              A-
            </ChromeBtn>
            <ChromeBtn
              title="字号 +"
              onClick={() => updatePrefs({ fontSize: clampFontSize(prefs.fontSize + 2) })}
            >
              A+
            </ChromeBtn>
            <div className="relative">
              <ChromeBtn title="排版（本书独立记忆）" onClick={() => setTypoOpen((v) => !v)}>
                排版
              </ChromeBtn>
              {typoOpen && (
                <TypoPanel
                  prefs={prefs}
                  onPrefs={setLayoutPref}
                  onReset={() => {
                    if (!workId) return;
                    resetWorkPrefs(workId);
                    setPrefs(loadReadingPrefs(workId));
                  }}
                />
              )}
            </div>
            <ChromeDivider />
            <ChromeBtn
              title={autoOn ? "停止自动阅读" : "自动阅读"}
              onClick={() => setAutoOn((v) => !v)}
            >
              {autoOn ? "⏸ 停" : "▶ 自动"}
            </ChromeBtn>
            <ChromeBtn title="章节目录" onClick={() => setDrawerOpen(true)}>
              目录
            </ChromeBtn>
          </>
        )}

        {pdfDoc && (
          <>
            <ChromeBtn
              title="上一页"
              disabled={pageNum <= 0}
              onClick={() => setPageNum((p) => Math.max(0, p - 1))}
            >
              ←
            </ChromeBtn>
            <span className="whitespace-nowrap px-1.5 text-xs text-chrome-muted">
              {pageNum + 1}/{pdfDoc.pages}
            </span>
            <ChromeBtn
              title="下一页"
              disabled={pageNum >= pdfDoc.pages - 1}
              onClick={() => setPageNum((p) => Math.min(pdfDoc.pages - 1, p + 1))}
            >
              →
            </ChromeBtn>
            <ChromeDivider />
            <ChromeBtn title="缩小" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>
              −
            </ChromeBtn>
            <span className="px-1 text-xs text-chrome-muted">{Math.round(scale * 100)}%</span>
            <ChromeBtn title="放大" onClick={() => setScale((s) => Math.min(4, s + 0.2))}>
              ＋
            </ChromeBtn>
            {pdfDoc.toc.length > 0 && (
              <>
                <ChromeDivider />
                <ChromeBtn title="书签目录" onClick={() => setDrawerOpen(true)}>
                  目录
                </ChromeBtn>
              </>
            )}
            <ChromeDivider />
            <ChromeBtn
              title={autoOn ? "停止自动阅读" : "自动阅读"}
              onClick={() => setAutoOn((v) => !v)}
            >
              {autoOn ? "⏸ 停" : "▶ 自动"}
            </ChromeBtn>
          </>
        )}

        {comicDoc && (
          <>
            <ChromeBtn title="上一页" disabled={comicIdx <= 0} onClick={() => comicNav(-1)}>
              ←
            </ChromeBtn>
            <span className="whitespace-nowrap px-1.5 text-xs text-chrome-muted">
              {comicIdx + 1}/{comicDoc.pages.length}
            </span>
            <ChromeBtn
              title="下一页"
              disabled={comicIdx >= comicDoc.pages.length - 1}
              onClick={() => comicNav(1)}
            >
              →
            </ChromeBtn>
            <ChromeDivider />
            <ChromeBtn
              title={comicMode === "page" ? "切到条漫滚动" : "切到单页翻页"}
              onClick={toggleComicMode}
            >
              {comicMode === "page" ? "条漫" : "单页"}
            </ChromeBtn>
            <ChromeBtn title="适应模式" onClick={cycleFit}>
              {COMIC_FIT_LABEL[fit]}
            </ChromeBtn>
            <ChromeDivider />
            <ChromeBtn
              title={autoOn ? "停止自动阅读" : "自动阅读"}
              onClick={() => setAutoOn((v) => !v)}
            >
              {autoOn ? "⏸ 停" : "▶ 自动"}
            </ChromeBtn>
          </>
        )}

        <ChromeDivider />
        <div className="relative">
          <ChromeBtn
            title={`阅读主题：${prefs.theme.label}`}
            onClick={() => setThemePopOpen((v) => !v)}
          >
            <span
              className="block h-3.5 w-3.5 rounded-full border border-white/25"
              style={{ background: prefs.theme.bg }}
            />
          </ChromeBtn>
          {themePopOpen && (
            <div className="absolute bottom-11 right-0 flex gap-1.5 rounded-xl bg-chrome-deep p-2 shadow-2">
              {Object.values(READING_THEMES).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.label}
                  onClick={() => {
                    updatePrefs({ theme: t });
                    setThemePopOpen(false);
                  }}
                  className={`h-8 w-8 cursor-pointer rounded-lg border-2 transition-colors ${
                    t.id === prefs.theme.id
                      ? "border-seal"
                      : "border-transparent hover:border-white/25"
                  }`}
                  style={{ background: t.bg }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const drawer = (
    <div className={`fixed inset-0 z-50 ${drawerOpen ? "" : "pointer-events-none"}`}>
      <div
        className={`absolute inset-0 bg-black/35 transition-opacity duration-200 ${
          drawerOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={() => setDrawerOpen(false)}
      />
      <aside
        className={`absolute inset-y-0 right-0 flex w-80 max-w-[85vw] flex-col bg-paper shadow-2 transition-transform duration-200 ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">
            {opened.book.metadata.title ?? opened.file.name}
          </div>
          <button
            className="btn btn-ghost px-2.5"
            title="关闭（Esc）"
            onClick={() => setDrawerOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2.5">
          {chapters &&
            chapters.map((c, i) => (
              <button
                key={c.id}
                ref={i === chapterIdx ? activeDrawerRef : undefined}
                className={`block w-full truncate rounded-r-md border-l-2 py-2 pl-3 pr-3 text-left text-[13px] ${
                  i === chapterIdx
                    ? "border-l-seal bg-paper-raised font-medium text-accent-strong"
                    : "border-l-transparent text-muted hover:border-l-line hover:bg-paper-raised hover:text-fg"
                }`}
                onClick={() => {
                  switchChapter(i);
                  setDrawerOpen(false);
                }}
              >
                {c.title ?? c.id}
              </button>
            ))}
          {pdfDoc &&
            (pdfDoc.toc.length > 0 ? (
              pdfDoc.toc.map((t, i) => (
                <button
                  key={i}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-muted hover:bg-paper-raised hover:text-fg"
                  onClick={() => {
                    setPageNum(Math.min(pdfDoc.pages - 1, Math.max(0, t.page - 1)));
                    setDrawerOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <span className="flex-none text-xs">p{t.page}</span>
                </button>
              ))
            ) : (
              <div className="p-4 text-center text-sm text-muted">这份 PDF 没有书签目录</div>
            ))}
          {comicDoc && (
            <div className="grid grid-cols-5 gap-2 p-1">
              {comicDoc.pages.map((_, i) => (
                <button
                  key={i}
                  className={`rounded-md border py-2 text-center text-[13px] ${
                    i === comicIdx
                      ? "border-seal bg-paper-raised font-medium text-accent-strong"
                      : "border-line text-muted hover:border-muted hover:text-fg"
                  }`}
                  onClick={() => {
                    setComicIdx(i);
                    setComicNavSeq((s) => s + 1);
                    setDrawerOpen(false);
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );

  return (
    <div
      className="relative flex h-full min-w-0 flex-col"
      style={{ background: prefs.theme.bg }}
      onClick={showChrome}
    >
      {body}

      {showDrift && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-paper-raised px-4 py-2 text-[13px] shadow-2">
            <span className="text-accent-strong">⚠ 文件内容已变更，旧进度的定位可能不准确</span>
            <button className="btn px-2.5 py-1 text-xs" onClick={() => setDriftDismissed(true)}>
              仍使用旧进度
            </button>
            <button className="btn btn-primary px-2.5 py-1 text-xs" onClick={restartFromBeginning}>
              从头阅读
            </button>
          </div>
        </div>
      )}

      {chromeBar}
      {drawer}
    </div>
  );
}
