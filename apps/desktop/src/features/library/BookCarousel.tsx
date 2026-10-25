/**
 * 立体书架（包 B-1，对齐 Wenku8_Flutter「发现」页 archive_wave 的陈列算法——
 * 仅提取其公开仓库中的布局数学与交互行为、以本项目自有代码重新实现，未复制其
 * GPL 代码）：斜二测投影书架（depthX=.66, depthY=-.30），每本书为
 * 书脊面 + 封面面 + 顶缘页纸三个面片（CSS matrix 与原作仿射矩阵一一对应）；
 * 选中书按 cos² 提取波沿深度轴滑出并抬升；轨道两端下沉（railY）；
 * 循环书池 + 棘轮吸附（420ms Cubic(.2,1.06,.35,1)）。
 *
 * 架构与原作一致：「滚动位置是唯一时钟」——React 只渲染静态结构，focus 为浮点，
 * rAF/拖拽逐帧命令式写 transform（连续插值），仅整数档位跨越时才更新信息行。
 * 遮挡物理靠 DOM 顺序：所有书都画双面，右邻自然盖住左书伸来的封面，居中书滑出
 * 时封面才从书列里露出；点击热区即三个面片本身（变换后的平行四边形）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { relTime, type WorkRow } from "../../app/api";
import { ensureCover, markCoverPresent } from "./coverFallback";
import { useCoverUrl } from "./useCoverUrl";
import { isTypingTarget } from "../reader/keyboard";

// ---------- 几何（archive_shelf_geometry 同款常数） ----------

const DEPTH_X = 0.66;
const DEPTH_Y = -0.3;
const ROW_STEP = 2.5;
const RADIUS = 1.48;
const ENTER_MS = 420;
const CUBIC: [number, number, number, number] = [0.2, 1.06, 0.35, 1];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Cubic 贝塞尔求值（牛顿迭代） */
function cubicEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const [x1, y1, x2, y2] = CUBIC;
  const cx = (u: number) => 3 * u * (1 - u) ** 2 * x1 + 3 * u ** 2 * (1 - u) * x2 + u ** 3;
  const cy = (u: number) => 3 * u * (1 - u) ** 2 * y1 + 3 * u ** 2 * (1 - u) * y2 + u ** 3;
  const dx = (u: number) =>
    3 * (1 - u) ** 2 * x1 + 6 * u * (1 - u) * (x2 - x1) + 3 * u ** 2 * (1 - x2);
  let u = t;
  for (let i = 0; i < 6; i++) u -= (cx(u) - t) / dx(u);
  return cy(u);
}

interface ShelfGeometry {
  spine: number;
  pitch: number;
  cover: number;
  height: number;
  footprint: number;
  pull: number;
  baseY: number;
  rowHeight: number;
  edgeSlots: number;
  startX: number;
}

function geometryFor(width: number): ShelfGeometry {
  // 桌面端全宽铺开：书本体尺寸随容器宽度放大（上限比原作手机尺寸大一档），
  // 行距随书脊走，可见档位由 edgeSlots 自然增多。
  const w = Math.max(320, width);
  const cover = clamp(w * 0.32, 112, 160);
  const spine = clamp(cover * 0.14, 14, 22);
  const pitch = spine + 11;
  const height = (cover - 20) * (166 / 118) + 54;
  const footprint = spine + cover * DEPTH_X;
  const pull = cover * 0.84;
  const baseY = -cover * DEPTH_Y + height * 0.6 + 12;
  const rowHeight = baseY + height + 60;
  const edgeSlots = Math.ceil((w / 2 + footprint + pull * DEPTH_X) / pitch) + 2;
  const startX = w / 2 - footprint / 2 + pull * DEPTH_X;
  return { spine, pitch, cover, height, footprint, pull, baseY, rowHeight, edgeSlots, startX };
}

/** 轨道下沉：离中心越远越低（railY） */
function railY(dist: number): number {
  const d = clamp(dist, -7, 7);
  return d * ROW_STEP + d * d * 0.45;
}

/** 提取波权重：中心 1，±RADIUS 外 0（cos² 钟形） */
function waveWeight(dist: number): number {
  const d = Math.abs(dist);
  if (d >= RADIUS) return 0;
  const c = Math.cos((d / RADIUS) * (Math.PI / 2));
  return c * c;
}

/** 居中书沿深度轴滑出的面片原点（origin）：先滑出、再按 smoothstep 抬升 */
function extractedOrigin(weight: number, geo: ShelfGeometry): { ox: number; oy: number } {
  const pull = geo.pull * weight * (1.24 - 0.24 * weight);
  const lift = weight * weight * (3 - 2 * weight);
  return {
    ox: -pull * DEPTH_X,
    oy: geo.baseY - pull * DEPTH_Y - geo.height * 0.6 * lift,
  };
}

// ---------- 书脊竖排标题：CJK 逐字直立，拉丁词整体旋转（archive_spine_title 行为） ----------

function spineRuns(title: string): string[] {
  const runs: string[] = [];
  let latin = "";
  const flush = () => {
    if (latin.trim()) runs.push(latin.trim());
    latin = "";
  };
  for (const ch of title) {
    if (/^[\x20-\x7e]$/.test(ch)) latin += ch;
    else {
      flush();
      runs.push(ch);
    }
  }
  flush();
  return runs;
}

function SpineTitle({ title }: { title: string }) {
  const runs = spineRuns(title);
  const shown = runs.slice(0, 7);
  return (
    <span className="flex max-h-full flex-col items-center overflow-hidden leading-[1.08]">
      {shown.map((run, i) =>
        /^[\x20-\x7e]+$/.test(run) ? (
          <span key={i} className="shrink-0" style={{ writingMode: "vertical-rl" }}>
            {run.length > 24 ? `${run.slice(0, 23)}…` : run}
          </span>
        ) : (
          <span key={i} className="shrink-0">
            {run}
          </span>
        ),
      )}
      {runs.length > 7 && <span className="shrink-0">…</span>}
    </span>
  );
}

// ---------- 组件 ----------

interface Props {
  works: WorkRow[];
  onOpen: (fileId: string) => void;
  onCoverSaved: () => void;
  onDelete: (work: WorkRow) => void;
}

export function BookCarousel({ works, onOpen, onCoverSaved, onDelete }: Props) {
  const count = works.length;
  const sceneRef = useRef<HTMLDivElement>(null);
  const wrapRefs = useRef<(HTMLDivElement | null)[]>([]);
  const shadowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const coverRefs = useRef<(HTMLDivElement | null)[]>([]);
  const topRefs = useRef<(HTMLDivElement | null)[]>([]);
  const spineRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(0);
  const geoRef = useRef<ShelfGeometry | null>(null);
  const focusRef = useRef(0);
  const reducedRef = useRef(false);
  const animRef = useRef<{ raf: number } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startFocus: number;
    moved: number;
    samples: { t: number; x: number }[];
  } | null>(null);
  const suppressClickRef = useRef(false);

  const centerWork = works[active];

  // 中心书封面兜底（与网格模式共享防循环逻辑）
  useEffect(() => {
    if (!centerWork) return;
    if (centerWork.hasCover) {
      markCoverPresent(centerWork.id);
      return;
    }
    ensureCover(centerWork, onCoverSaved);
  }, [centerWork, onCoverSaved]);

  // 量测：书架封顶 520px，是实体书柜而非通栏横幅
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => (width > 0 ? geometryFor(width) : null), [width]);

  const applyFocus = useCallback(
    (f: number) => {
      const g = geoRef.current;
      if (!g || count < 1) return;
      const focusSlot = g.edgeSlots + mod(f, count);
      for (let s = 0; s < wrapRefs.current.length; s++) {
        const wrap = wrapRefs.current[s];
        if (!wrap) continue;
        const shadow = shadowRefs.current[s];
        const dist = s - focusSlot;
        if (Math.abs(dist) > g.edgeSlots + 1) {
          wrap.style.visibility = "hidden";
          if (shadow) shadow.style.visibility = "hidden";
          continue;
        }
        wrap.style.visibility = "visible";
        if (shadow) shadow.style.visibility = "visible";
        const x = g.startX + dist * g.pitch;
        const rail = railY(dist);
        const weight = count < 2 ? 1 : waveWeight(dist);
        const { ox, oy } = extractedOrigin(weight, g);
        wrap.style.transform = `translate(${x.toFixed(2)}px, ${rail.toFixed(2)}px)`;
        if (coverRefs.current[s]) {
          coverRefs.current[s]!.style.transform =
            `matrix(${DEPTH_X}, ${DEPTH_Y}, 0, 1, ${(ox + g.spine).toFixed(2)}, ${(oy + g.spine * 0.1).toFixed(2)})`;
        }
        if (topRefs.current[s]) {
          topRefs.current[s]!.style.transform =
            `matrix(1, 0.1, ${DEPTH_X}, ${DEPTH_Y}, ${ox.toFixed(2)}, ${oy.toFixed(2)})`;
        }
        if (spineRefs.current[s]) {
          spineRefs.current[s]!.style.transform =
            `matrix(1, 0.1, 0, 1, ${ox.toFixed(2)}, ${oy.toFixed(2)})`;
        }
        if (shadow) {
          shadow.style.transform = `translate(${(x - 10).toFixed(2)}px, ${(rail + g.baseY + g.height + g.cover * DEPTH_Y).toFixed(2)}px)`;
        }
      }
      // 整数档位跨越才更新信息行（ValueListenableBuilder 同款节流）
      const act = count < 2 ? 0 : mod(Math.round(f), count);
      setActive((prev) => (prev === act ? prev : act));
    },
    [count],
  );

  useEffect(() => {
    geoRef.current = geo;
    if (geo) applyFocus(focusRef.current);
  }, [geo, applyFocus]);

  useEffect(() => {
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // 书列变化：居中到最近在读的书
  useEffect(() => {
    if (count === 0) return;
    let best = 0;
    let bestTs = -1;
    works.forEach((w, i) => {
      const ts = w.lastReadAt ?? -1;
      if (ts > bestTs) {
        bestTs = ts;
        best = i;
      }
    });
    focusRef.current = best;
    setActive(best);
    if (geoRef.current) applyFocus(best);
  }, [works, count, applyFocus]);

  const stopAnim = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current.raf);
      animRef.current = null;
    }
  }, []);

  const animateTo = useCallback(
    (lane: number) => {
      if (count < 2) return;
      stopAnim();
      const from = focusRef.current;
      if (reducedRef.current || Math.abs(lane - from) < 1e-6) {
        focusRef.current = mod(lane, count);
        applyFocus(focusRef.current);
        return;
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = clamp((now - t0) / ENTER_MS, 0, 1);
        const f = from + (lane - from) * cubicEase(t);
        focusRef.current = f;
        applyFocus(f);
        if (t < 1 && animRef.current) {
          animRef.current.raf = requestAnimationFrame(tick);
        } else {
          focusRef.current = mod(lane, count);
          applyFocus(focusRef.current);
          animRef.current = null;
        }
      };
      animRef.current = { raf: requestAnimationFrame(tick) };
    },
    [count, stopAnim, applyFocus],
  );

  const step = useCallback(
    (delta: number) => {
      animateTo(Math.round(focusRef.current) + delta);
    },
    [animateTo],
  );

  /** 居中到某本书（取模最短方向，循环书架） */
  const centreBook = useCallback(
    (bookIdx: number) => {
      const n = count;
      if (n < 2) return;
      const cur = mod(focusRef.current, n);
      let delta = mod(bookIdx - cur + n / 2, n) - n / 2;
      if (n % 2 === 0 && delta === -n / 2) delta = n / 2;
      animateTo(Math.round(focusRef.current) + Math.round(delta));
    },
    [count, animateTo],
  );

  // 键盘：←/→ 换选，回车打开（输入控件聚焦时不劫持）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "Enter") {
        const w = works[active];
        if (w?.files[0]) onOpen(w.files[0].id);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [step, works, active, onOpen]);

  // 滚轮换选（非被动监听以阻止页面滚动；冷却防触控板惯性扫完）
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    let last = 0;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      if (now - last < 260 || Math.abs(e.deltaY) < 12) return;
      last = now;
      step(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [step]);

  // 拖拽：跟手 + 松手按速度吸附整数档（ArchiveScrollSimulation 的简化——
  // 去掉滑行段，保留速度感知目的地与同一条 Landing 曲线）。
  // move/up 挂 window（不用 pointer capture，否则 click 会被重定向吞掉）
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (count < 2 || e.button !== 0) return;
      stopAnim();
      dragRef.current = {
        startX: e.clientX,
        startFocus: focusRef.current,
        moved: 0,
        samples: [{ t: performance.now(), x: e.clientX }],
      };
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const g = geoRef.current;
      if (!d || !g) return;
      const dx = e.clientX - d.startX;
      d.moved = Math.max(d.moved, Math.abs(dx));
      d.samples.push({ t: performance.now(), x: e.clientX });
      if (d.samples.length > 8) d.samples.shift();
      focusRef.current = d.startFocus - dx / g.pitch;
      applyFocus(focusRef.current);
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      // click 事件在 pointerup 之后派发：拖拽过则吞掉这次 click
      if (d.moved > 6) suppressClickRef.current = true;
      const samples = d.samples;
      const last = samples[samples.length - 1]!;
      const first = samples.find((s) => last.t - s.t < 120) ?? samples[0]!;
      const dt = Math.max(1, last.t - first.t);
      const v = ((last.x - first.x) / dt) * 1000; // px/s
      const pitch = geoRef.current?.pitch ?? 29;
      const dest =
        Math.abs(v) >= 50
          ? Math.round(focusRef.current + v / pitch / 4.4)
          : Math.round(focusRef.current);
      animateTo(dest);
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [count, stopAnim, animateTo, applyFocus]);

  const onFaceClick = (slot: number) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const g = geoRef.current;
    if (!g || count < 1) return;
    const bookIdx = mod(slot - g.edgeSlots, count);
    const dist = slot - (g.edgeSlots + mod(focusRef.current, count));
    if (Math.abs(dist) < 0.03 && !animRef.current) {
      const w = works[bookIdx];
      if (w?.files[0]) onOpen(w.files[0].id);
    } else {
      centreBook(bookIdx);
    }
  };

  if (count === 0) return null;
  const edge = geo?.edgeSlots ?? 17;
  const poolCount = count < 2 ? 1 : count + edge * 2;
  const codeCls =
    "font-mono text-[9px] leading-none tracking-[0.08em] text-[var(--shelf-fg-muted)]";
  // 大书库只给中心附近的档位挂封面图（远档封面恒被右邻遮挡，永不可见）
  const coverWindow = (s: number) => poolCount <= 48 || Math.abs(s - (edge + active)) <= 5;

  return (
    <div className="flex flex-col px-9 pb-12">
      <div className="w-full">
        <div
          ref={sceneRef}
          className="relative w-full select-none overflow-hidden"
          style={{ height: (geo?.rowHeight ?? 520) + 8, touchAction: "pan-y" }}
          role="group"
          aria-label="立体书架"
        >
          {/* 地面投影层（先画，垫在所有书之下） */}
          {geo &&
            Array.from({ length: poolCount }, (_, s) => {
              const dxC = geo.cover * DEPTH_X;
              const dyC = geo.cover * DEPTH_Y;
              const sp = geo.spine;
              return (
                <div
                  key={`sh-${s}`}
                  ref={(el) => {
                    shadowRefs.current[s] = el;
                  }}
                  className="absolute left-0 top-0 will-change-transform"
                  style={{
                    width: sp + dxC + 10,
                    height: 10 - dyC,
                    visibility: "hidden",
                    clipPath: `polygon(10px ${-dyC}px, ${10 + sp}px ${-dyC + 1.4}px, ${10 + sp + dxC}px 1.4px, ${10 + dxC}px 0px, ${dxC}px 10px, 0px 10px)`,
                    background:
                      "linear-gradient(to bottom left, rgb(var(--shelf-ink) / 0.12), rgb(var(--shelf-ink) / 0))",
                  }}
                />
              );
            })}

          {/* 书体层：每本 = 封面面 → 顶缘 → 书脊面（DOM 顺序即遮挡顺序）；
              热区 = 三个面片自身（点击热区精确到书体，不圈住空隙） */}
          {Array.from({ length: poolCount }, (_, s) => {
            const bookIdx = mod(s - edge, count);
            const book = works[bookIdx];
            const number = bookIdx + 1;
            const coverW = geo?.cover ?? 128;
            const bodyH = geo?.height ?? 206;
            const clickProps = {
              onClick: () => onFaceClick(s),
              "data-slot": s,
            } as const;
            return (
              <div
                key={s}
                ref={(el) => {
                  wrapRefs.current[s] = el;
                }}
                role="button"
                tabIndex={-1}
                aria-label={`第 ${number} 本：${book.title}${bookIdx === active ? "（当前居中，回车打开）" : "，点击居中"}`}
                className="absolute left-0 top-0 h-full w-full will-change-transform"
                style={{ pointerEvents: "none", visibility: "hidden" }}
              >
                {/* 封面面：沿深度方向斜切的平行四边形 */}
                <div
                  ref={(el) => {
                    coverRefs.current[s] = el;
                  }}
                  className="absolute left-0 top-0 origin-top-left p-[10px] pb-2 pt-[9px]"
                  style={{
                    width: coverW,
                    height: bodyH,
                    background: "var(--shelf-cover)",
                    boxShadow: "0 0 0 0.4px rgb(var(--shelf-stroke) / 0.24)",
                    pointerEvents: "auto",
                    cursor: "pointer",
                  }}
                  {...clickProps}
                >
                  <div className="flex h-full flex-col">
                    <span className={codeCls}>NO.{String(number).padStart(3, "0")}</span>
                    <div className="mt-[7px] min-h-0 flex-1 overflow-hidden">
                      {coverWindow(s) ? (
                        <CoverArt book={book} />
                      ) : (
                        <div style={{ background: "var(--shelf-cover)" }} />
                      )}
                    </div>
                    <span className={`mt-1 ${codeCls}`}>BV-{String(number).padStart(5, "0")}</span>
                  </div>
                </div>
                {/* 顶缘页纸 */}
                <div
                  ref={(el) => {
                    topRefs.current[s] = el;
                  }}
                  className="absolute left-0 top-0 origin-top-left"
                  style={{
                    width: geo?.spine ?? 18,
                    height: coverW,
                    background:
                      "linear-gradient(to bottom left, var(--shelf-top-a), var(--shelf-top-b))",
                    boxShadow: "inset 0 0 0 0.4px rgb(var(--shelf-stroke) / 0.24)",
                    pointerEvents: "auto",
                    cursor: "pointer",
                  }}
                  {...clickProps}
                />
                {/* 书脊面 */}
                <div
                  ref={(el) => {
                    spineRefs.current[s] = el;
                  }}
                  className="absolute left-0 top-0 flex origin-top-left flex-col items-center py-[9px]"
                  style={{
                    width: geo?.spine ?? 18,
                    height: bodyH,
                    background: "var(--shelf-spine)",
                    pointerEvents: "auto",
                    cursor: "pointer",
                  }}
                  {...clickProps}
                >
                  <span className={codeCls}>{String(number).padStart(2, "0")}</span>
                  <span className="mt-2.5 min-h-0 flex-1 text-[9px] font-semibold text-[var(--shelf-fg)]">
                    <SpineTitle title={book.title} />
                  </span>
                  <span
                    className="mt-1.5 h-[5px] w-[5px] flex-none rounded-full border border-[var(--shelf-fg-muted)]"
                    aria-hidden="true"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* 当前书信息 + 翻页器（居中在书架正下方；信息行整行可点打开） */}
        <div className="mx-auto mt-2 w-full max-w-xl">
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-3 py-2 text-left"
            onClick={() => centerWork?.files[0] && onOpen(centerWork.files[0].id)}
            title={`打开 ${centerWork?.title ?? ""}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-bold leading-[1.35] text-fg">
                {centerWork?.title}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted">
                {centerWork?.authors.length ? centerWork.authors.join(" / ") : "佚名"}
                <span className="mx-1.5">·</span>
                {centerWork?.category || "未分类"}
                {centerWork?.lastReadAt ? (
                  <>
                    <span className="mx-1.5">·</span>最近阅读 {relTime(centerWork.lastReadAt)}
                  </>
                ) : (
                  <>
                    <span className="mx-1.5">·</span>未读
                  </>
                )}
              </span>
            </span>
            <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none text-muted" aria-hidden="true">
              <path
                d="M7 17L17 7M9 7h8v8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              className="cursor-pointer rounded px-2 py-1.5 text-[11px] text-[#c96a6a] transition-colors hover:bg-paper-raised hover:text-[#ff9d9d]"
              title={`删除「${centerWork?.title ?? ""}」`}
              onClick={() => centerWork && onDelete(centerWork)}
            >
              删除
            </button>
            {count > 1 && (
              <>
                <button
                  type="button"
                  className="cursor-pointer rounded p-1.5 text-muted transition-colors hover:bg-paper-raised hover:text-fg"
                  aria-label="上一本"
                  onClick={() => step(-1)}
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                    <path
                      d="M14.5 6l-6 6 6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <span className={`${codeCls} text-[11px]`}>
                  {String(active + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
                </span>
                <button
                  type="button"
                  className="cursor-pointer rounded p-1.5 text-muted transition-colors hover:bg-paper-raised hover:text-fg"
                  aria-label="下一本"
                  onClick={() => step(1)}
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                    <path
                      d="M9.5 6l6 6-6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 封面面中央的图像/占位：每本书都渲染，被右侧书自然遮挡 */
function CoverArt({ book }: { book: WorkRow }) {
  const url = useCoverUrl(book.id, book.hasCover);
  if (book.hasCover && url) {
    return <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />;
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 border border-line/60 p-2 text-center">
      <span className="font-display text-[15px] leading-relaxed text-fg/90">
        {book.title.slice(0, 12)}
      </span>
      {book.authors[0] && (
        <span className="text-[10px] text-muted">{book.authors[0].slice(0, 8)}</span>
      )}
    </div>
  );
}
