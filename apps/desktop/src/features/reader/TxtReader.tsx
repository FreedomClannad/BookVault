/**
 * TXT 正文视图：滚动 / 分页 / 竖排三模式 + 翻页动画（ui-style §3）。
 *
 * 分页引擎（含竖排 vertical-rl 与对页）：正文在固定高度容器内按列宽做 CSS 多列，
 * 一屏一列（对页两列），翻页 = 容器平移一个 step；纯几何计算在
 * @bookvault/shared/pagination（有单测，未来移动端复用）。版心宽度按每行约
 * 36 字封顶，不随窗口拉长。
 *
 * 竖排注意（实测 Chromium/WebView2，2026-10）：vertical-rl 的文字渲染正确
 * （上→下、列自右向左），但多列分片沿**纵轴向下**堆叠——scrollHeight 随分片
 * 增长而 scrollWidth 不变，与 CSS 多列规范的「沿块轴（水平）分列」不符。
 * 因此竖排的分页轴取 Y（translateY 向上翻），屏数由 scrollHeight 量测；
 * 若未来引擎改回规范行为，需同步调整这里的量测与平移轴。竖排暂不支持对页。
 *
 * 翻页动画：slide = 基层 transform 过渡；cover = 目标页整屏滑入盖住当前页
 * （副本面板，CoverSheet）；none = 直切。程序化跳页（恢复进度/章节切换/排版
 * 变化重排）一律不播动画。
 *
 * 进度统一为章内 0..1 比例：滚动模式沿用滚动比，分页模式屏号↔比例互转
 * （shared），进度模型与存储不变（ADR-003）。沉浸式不含工具栏：章节、页码、
 * 排版全部由 Reader 层受控（ADR-002）。滚动模式对外暴露 ScrollPager 翻页原语
 * （按屏推进，见 pager.ts），Reader 层据此实现「先翻内容、到边界才跨章」。
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { COLUMN_GAP, columnCount, sheetCount, sheetGeometry, sheetOffset } from "@bookvault/shared";
import { api, type ReadingLocation } from "../../app/api";
import { highlightText } from "./highlight";
import type { ScrollPager } from "./pager";
import { FONT_SANS, FONT_SERIF, type ReadingPrefs } from "./readingPrefs";

/** 版心内边距：列文字到「纸边」的留白（分页/竖排模式） */
const TEXT_PAD = 12;
/** 版心上下留白：通过整体压缩列高实现，保证每一列一致 */
const VPAD = 28;

interface Props {
  fileId: string;
  chapterId: string;
  /** 打开时携带的保存进度；仅滚动模式用于恢复章内位置（分页模式由 Reader 换算屏号下发） */
  initial: ReadingLocation | null;
  prefs: ReadingPrefs;
  onProgress: (loc: ReadingLocation) => void;
  /** 分页/竖排：受控屏号（0 基）；滚动模式忽略 */
  page: number;
  /** 对页开关（仅横排分页生效；竖排分片沿纵轴堆叠，双页并排不适用） */
  spread: boolean;
  /** 布局量测后上报屏数（Reader 据此做页码导航与进度换算） */
  onPageCount: (sheets: number) => void;
  /** 程序化跳页序号：恢复进度/切章/TOC 跳转时递增，本次 page 变化不播动画 */
  navSeq: number;
  /** 自动滚动速度 px/s（仅滚动模式；0=关闭） */
  autoScrollPx: number;
  /** 滚动模式自动滚到章末时回调（Reader 决定续章或停止） */
  onAutoEnd?: () => void;
  /** 查找跳转意图（滚动模式）：seq 变化时滚到章内等比例位置并上报进度 */
  jump?: { ratio: number; seq: number } | null;
  /** 查找命中词：正文 mark 高亮（章内查找/跳转后的视觉反馈） */
  highlight?: string;
}

export function TxtReader({
  fileId,
  chapterId,
  initial,
  prefs,
  onProgress,
  page,
  spread,
  onPageCount,
  navSeq,
  autoScrollPx,
  onAutoEnd,
  jump,
  highlight,
  ref,
}: Props & { ref?: Ref<ScrollPager> }) {
  const init = initial?.type === "chapter" ? initial : null;
  const [text, setText] = useState("");
  const paged = prefs.pageMode !== "scroll";
  const vertical = prefs.pageMode === "vertical";

  // ---- 滚动模式 ----
  const paneRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  /** 查找跳转意图按 seq 只消费一次：切章重载正文时旧意图不再触发 */
  const jumpSeqConsumed = useRef(-1);
  /** 当前正文所属章节：切章瞬间旧正文还在 state 里，跳转意图必须等新正文就绪再消费 */
  const textChapterRef = useRef<string | null>(null);
  /**
   * 章节加载完成计数：相邻两章文本完全相同时 setText 会被 React 判定无变化而
   * 整批 bailout，依赖 text 的 effect 不会重跑——用必然变化的计数触发消费检查。
   */
  const [loadTick, setLoadTick] = useState(0);

  // 滚动模式翻页原语（Reader 层据此「先按屏推进、到边界才跨章」，见 pager.ts）；
  // 内容未就绪时吞掉翻页（返回 true），避免把加载中的章节误判为章末而跳章
  useImperativeHandle(ref, () => ({
    pageDown: () => {
      if (paged) return true;
      const pane = paneRef.current;
      if (!pane || textChapterRef.current !== chapterId) return true;
      const max = pane.scrollHeight - pane.clientHeight;
      if (pane.scrollTop >= max - 1) return false;
      pane.scrollTo({
        top: Math.min(max, pane.scrollTop + pane.clientHeight),
        behavior: "smooth",
      });
      return true;
    },
    pageUp: () => {
      if (paged) return true;
      const pane = paneRef.current;
      if (!pane || textChapterRef.current !== chapterId) return true;
      if (pane.scrollTop <= 1) return false;
      pane.scrollTo({
        top: Math.max(0, pane.scrollTop - pane.clientHeight),
        behavior: "smooth",
      });
      return true;
    },
  }));

  // ---- 分页/竖排模式 ----
  const clipRef = useRef<HTMLDivElement>(null);
  const translatorRef = useRef<HTMLDivElement>(null);
  const [clipW, setClipW] = useState(0);
  const [geom, setGeom] = useState<{ columnWidth: number; step: number }>({
    columnWidth: 0,
    step: 0,
  });
  /** 竖排分页步长（分片高 + 缝），由量测得出；横排用 geom.step */
  const [axisStep, setAxisStep] = useState(0);
  const [cover, setCover] = useState<{ dir: 1 | -1; overlayPage: number; seq: number } | null>(
    null,
  );
  const coverSeq = useRef(0);
  const onPageCountRef = useRef(onPageCount);
  onPageCountRef.current = onPageCount;
  const onAutoEndRef = useRef(onAutoEnd);
  onAutoEndRef.current = onAutoEnd;

  // 加载章节内容（按需读取，不整本载入——ADR-002）
  useEffect(() => {
    let cancelled = false;
    setText("");
    void api
      .getResource(fileId, chapterId)
      .then((bytes) => {
        if (!cancelled) {
          textChapterRef.current = chapterId;
          setText(new TextDecoder().decode(bytes));
          setLoadTick((n) => n + 1);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          textChapterRef.current = chapterId;
          setText(`（章节读取失败: ${String(e)}）`);
          setLoadTick((n) => n + 1);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, chapterId]);

  // 滚动模式：仅初次挂载且保存进度的章节与当前一致时恢复章内位置；切章回顶
  useEffect(() => {
    if (paged) return;
    const pane = paneRef.current;
    if (!pane || !text) return;
    if (!restoredRef.current && init && init.chapterId === chapterId) {
      if (pane.scrollHeight > pane.clientHeight) {
        pane.scrollTop = init.progress * (pane.scrollHeight - pane.clientHeight);
        restoredRef.current = true;
      }
      return;
    }
    pane.scrollTop = 0;
  }, [text, chapterId, init, paged]);

  // 滚动模式进度上报（节流由 Reader 层负责）
  const reportScroll = useCallback(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const ratio = pane.scrollTop / Math.max(1, pane.scrollHeight - pane.clientHeight);
    onProgress({
      type: "chapter",
      chapterId,
      progress: Math.min(1, Math.max(0, ratio)),
    });
  }, [chapterId, onProgress]);

  // 自动滚动（仅滚动模式）：rAF 匀速下滚；到底回调 onAutoEnd（Reader 续章或停止）。
  // 程序化 scrollTop 会触发 scroll 事件 → 进度经 reportScroll 正常上报。
  useEffect(() => {
    if (paged || autoScrollPx <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const pane = paneRef.current;
      if (!pane) return;
      const max = pane.scrollHeight - pane.clientHeight;
      if (pane.scrollTop >= max - 0.5) {
        onAutoEndRef.current?.();
        return;
      }
      pane.scrollTop = Math.min(max, pane.scrollTop + (autoScrollPx * (t - last)) / 1000);
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paged, autoScrollPx, chapterId]);

  // 查找/回退跳转（仅滚动模式）：正文就绪后滚到等比例位置；进度上报由 scroll 事件驱动。
  // 章节归属守卫：switchChapter 同一批更新里 chapterId 已是新章而 text 还是旧章正文，
  // 此时不得消费意图（否则跨章跳转会被旧正文吞掉、新章停回章首——滚动模式查找跳章曾踩
  // 此坑）。loadTick：相邻两章内容完全相同时 setText 判定无变化不重渲染，靠它重跑。
  useEffect(() => {
    if (paged || !jump || !text) return;
    if (textChapterRef.current !== chapterId) return;
    if (jump.seq === jumpSeqConsumed.current) return;
    jumpSeqConsumed.current = jump.seq;
    const pane = paneRef.current;
    if (!pane) return;
    pane.scrollTop = jump.ratio * Math.max(0, pane.scrollHeight - pane.clientHeight);
  }, [paged, jump, text, chapterId, loadTick]);

  // ---- 分页几何 ----
  // 视口宽度：ResizeObserver 跟随窗口/布局变化
  useEffect(() => {
    if (!paged) return;
    const clip = clipRef.current;
    if (!clip) return;
    const update = () => setClipW(clip.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(clip);
    return () => ro.disconnect();
  }, [paged]);

  // 几何（列宽/步长）：视口、字号、对页任一变化即重算；值不变时保持引用稳定
  useEffect(() => {
    if (!paged || !text || clipW <= 0) return;
    const g = sheetGeometry(clipW - TEXT_PAD * 2, prefs.fontSize, spread);
    if (g.columnWidth <= 0) return;
    setGeom((prev) => (prev.columnWidth === g.columnWidth && prev.step === g.step ? prev : g));
  }, [paged, text, clipW, prefs.fontSize, spread]);

  // 内容量测：几何落地到 DOM 后才能数列（scrollWidth 反映新列宽）；字体就绪后补测一次
  useEffect(() => {
    if (!paged || !text || geom.columnWidth <= 0) return;
    const tr = translatorRef.current;
    if (!tr) return;
    const count = () => {
      if (vertical) {
        // 竖排：分片向下堆叠（见文件头实测注），片高 = 容器 clientHeight
        const fragH = tr.clientHeight;
        const stepY = fragH + COLUMN_GAP;
        setAxisStep((prev) => (prev === stepY ? prev : stepY));
        onPageCountRef.current(Math.max(1, columnCount(tr.scrollHeight, fragH, COLUMN_GAP)));
      } else {
        const cols = columnCount(tr.scrollWidth, Math.floor(geom.columnWidth), COLUMN_GAP);
        onPageCountRef.current(sheetCount(cols, spread));
      }
    };
    count();
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) count();
    });
    return () => {
      cancelled = true;
    };
  }, [paged, text, geom, spread, vertical]);

  // ---- 翻页动画编排 ----
  // animate 在「渲染期」由上一次提交的导航状态推导（基层 transform 的过渡必须在
  // 变化那一帧就位）；上一次提交的值随后在 effect 里回写。
  const stepNow = vertical ? axisStep : geom.step;
  const geomKey = `${geom.columnWidth}|${geom.step}|${axisStep}|${vertical}`;
  const prevNavRef = useRef({ page, navSeq, geomKey });
  const programmatic =
    navSeq !== prevNavRef.current.navSeq || geomKey !== prevNavRef.current.geomKey;
  const animate = !programmatic && page !== prevNavRef.current.page && stepNow > 0;

  // 覆盖动画触发（slide/none 由基层 transition 自然呈现）：程序化跳页时撤掉进行中的覆盖层
  useEffect(() => {
    const prev = prevNavRef.current;
    const prog = navSeq !== prev.navSeq || geomKey !== prev.geomKey;
    const changed = page !== prev.page;
    if (!prog && changed && prefs.anim === "cover" && stepNow > 0) {
      const dir: 1 | -1 = page > prev.page ? 1 : -1;
      coverSeq.current += 1;
      setCover({ dir, overlayPage: dir > 0 ? page : prev.page, seq: coverSeq.current });
    } else {
      setCover((c) => (c ? null : c));
    }
  }, [page, navSeq, geomKey, prefs.anim, stepNow]);

  useEffect(() => {
    prevNavRef.current = { page, navSeq, geomKey };
  }, [page, navSeq, geomKey]);

  const sheetW = geom.step > 0 ? geom.step - COLUMN_GAP : 0;
  // 横排内容向右溢出、竖排（实测）向下堆叠：翻页都朝「内容伸展的反方向」平移
  const offset = sheetOffset(page, stepNow);
  const translate = `translate${vertical ? "Y" : "X"}(${-offset}px)`;

  const bodyStyle: CSSProperties = {
    color: prefs.theme.fg,
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    fontFamily: prefs.serif ? FONT_SERIF : FONT_SANS,
    textAlign: "justify",
    whiteSpace: "pre-wrap",
  };

  /** 多列容器基础样式；transform/transition 由调用方补（基层动画与覆盖层不同） */
  const basePageStyle: CSSProperties = {
    ...bodyStyle,
    height: `calc(100% - ${VPAD * 2}px)`,
    marginTop: VPAD,
    width: "100%",
    columnWidth: `${Math.max(1, Math.floor(geom.columnWidth))}px`,
    columnGap: `${COLUMN_GAP}px`,
    columnFill: "auto",
    writingMode: vertical ? "vertical-rl" : "horizontal-tb",
  };

  const contentNode = highlightText(text, highlight ?? "");

  if (!paged) {
    return (
      <div
        className="min-h-0 flex-1 overflow-auto"
        style={{ background: prefs.theme.bg }}
        ref={paneRef}
        onScroll={reportScroll}
      >
        {text ? (
          <div
            className="mx-auto max-w-[40em] whitespace-pre-wrap px-7 pb-[120px] pt-10 text-justify"
            style={bodyStyle}
          >
            {contentNode}
          </div>
        ) : (
          <LoadingHint muted={prefs.theme.muted} />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1" style={{ background: prefs.theme.bg }}>
      <div className="flex h-full justify-center">
        <div
          ref={clipRef}
          className="relative h-full overflow-hidden"
          style={{ width: sheetW > 0 ? sheetW + TEXT_PAD * 2 : "100%", padding: `0 ${TEXT_PAD}px` }}
        >
          {text ? (
            <div
              ref={translatorRef}
              style={{
                ...basePageStyle,
                transform: translate,
                transition:
                  animate && prefs.anim === "slide"
                    ? `transform ${prefs.animSpeed}ms cubic-bezier(0.25, 0.1, 0.25, 1)`
                    : "none",
              }}
            >
              {contentNode}
            </div>
          ) : (
            <LoadingHint muted={prefs.theme.muted} />
          )}

          {cover && text && stepNow > 0 && (
            <CoverSheet
              key={cover.seq}
              dir={cover.dir}
              page={cover.overlayPage}
              step={stepNow}
              vertical={vertical}
              durationMs={prefs.animSpeed}
              bg={prefs.theme.bg}
              basePageStyle={basePageStyle}
              onDone={() => setCover(null)}
            >
              {contentNode}
            </CoverSheet>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 覆盖翻页的滑入面板：整屏展示目标页（副本），从前进方向滑入（前进）或
 * 滑出（后退）盖住/露出基层——横排从右缘、竖排从下缘进出。双 rAF 确保初始
 * 位置先绘制再过渡。
 */
function CoverSheet({
  dir,
  page,
  step,
  vertical,
  durationMs,
  bg,
  basePageStyle,
  onDone,
  children,
}: {
  dir: 1 | -1;
  page: number;
  step: number;
  vertical: boolean;
  durationMs: number;
  bg: string;
  basePageStyle: CSSProperties;
  onDone: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const ax = vertical ? "Y" : "X";
  const startT = dir > 0 ? step : 0;
  const endT = dir > 0 ? 0 : step;
  const innerT = -page * step;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.style.transition = `transform ${durationMs}ms ease`;
        el.style.transform = `translate${ax}(${endT}px)`;
      });
    });
    const timer = setTimeout(() => onDoneRef.current(), durationMs + 160);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
  }, [durationMs, endT, ax]);

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10 overflow-hidden"
      style={{
        background: bg,
        transform: `translate${ax}(${startT}px)`,
        boxShadow: "0 0 22px rgb(0 0 0 / 0.16)",
      }}
    >
      <div
        style={{ ...basePageStyle, transform: `translate${ax}(${innerT}px)`, transition: "none" }}
      >
        {children}
      </div>
    </div>
  );
}

function LoadingHint({ muted }: { muted: string }) {
  return (
    <div className="flex h-[50vh] items-center justify-center text-sm" style={{ color: muted }}>
      正在加载章节…
    </div>
  );
}
