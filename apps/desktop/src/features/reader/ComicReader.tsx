/**
 * 漫画正文视图：单页翻页 + 条漫滚动双模式，预加载当前页 ±2（ui-style §4）。
 * 沉浸式改造后不含工具栏：当前页 / 模式 / 适应方式由 Reader 层受控；
 * 进度 = 条漫模式下可见过半的页（经 onPageVisible 上提后由 Reader 落库）。
 * 单页翻页带方向性进场动画（平移类；「覆盖」对单页大图观感与平移一致，同款处理），
 * 动画关/跳页时不播。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PageDto } from "../../app/api";
import type { PageAnim, ReadingPrefs } from "./readingPrefs";

export type ComicFit = "fit-width" | "fit-height" | "original";

interface Props {
  fileId: string;
  pages: PageDto[];
  /** 受控当前页 */
  page: number;
  /** Reader 层主动跳页/切模式时自增；条漫据此滚动到目标页 */
  navSeq: number;
  mode: "page" | "scroll";
  fit: ComicFit;
  prefs: ReadingPrefs;
  /** 翻页动画设置（与小说共用 readingPrefs.anim） */
  anim: PageAnim;
  animSpeed: number;
  /** 翻页方向：1 下一页 / -1 上一页 / 0 跳页不播动画 */
  dir: number;
  /** 条漫模式下「可见过半」的页变化时上报 */
  onPageVisible: (index: number) => void;
}

function locatorKey(p: PageDto): string {
  if ("zip_entry" in p.locator) return p.locator.zip_entry;
  if ("file_path" in p.locator) return p.locator.file_path;
  return String(p.index);
}

interface LazyPageProps {
  index: number;
  url: string | undefined;
  load: (i: number) => void;
  onVisible: (i: number) => void;
  root: HTMLElement | null;
  theme: ReadingPrefs["theme"];
}

/** 条漫单页：进入视口（±800px 预取）才加载；可见过半（无预取边距）才上报进度 */
function LazyPage({ index, url, load, onVisible, root, theme }: LazyPageProps) {
  const ref = useRef<HTMLElement | null>(null);

  // 加载 observer：命中预取边距即触发，加载完成后不再观察
  useEffect(() => {
    if (!root || url) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            load(index);
            io.disconnect();
          }
        }
      },
      { root, rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root, url, index, load]);

  // 进度 observer：页面真实可见过半才算读到（常驻，加载前后都生效）
  useEffect(() => {
    if (!root) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) onVisible(index);
        }
      },
      { root, threshold: [0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root, index, onVisible]);

  if (url) {
    return (
      <img
        ref={ref as React.RefObject<HTMLImageElement>}
        src={url}
        alt={`第 ${index + 1} 页`}
        className="mx-auto block max-w-full"
      />
    );
  }
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className="flex min-h-[40vh] w-full items-center justify-center text-sm"
      style={{ color: theme.muted }}
    >
      第 {index + 1} 页
    </div>
  );
}

export function ComicReader({
  fileId,
  pages,
  page,
  navSeq,
  mode,
  fit,
  prefs,
  anim,
  animSpeed,
  dir,
  onPageVisible,
}: Props) {
  const [urls, setUrls] = useState<Map<number, string>>(new Map());
  const [ioRoot, setIoRoot] = useState<HTMLElement | null>(null);
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const pageEls = useRef<Map<number, HTMLElement>>(new Map());
  const rootRef = useRef<HTMLElement | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const load = useCallback(
    async (i: number) => {
      if (i < 0 || i >= pages.length) return;
      const pg = pages[i];
      if (!pg) return;
      try {
        const bytes = await api.getResource(fileId, locatorKey(pg));
        const url = URL.createObjectURL(new Blob([bytes.slice() as unknown as BlobPart]));
        setUrls((m) => {
          if (m.has(i)) {
            URL.revokeObjectURL(url);
            return m;
          }
          const next = new Map(m);
          next.set(i, url);
          return next;
        });
      } catch {
        // 加载失败显示占位（不阻塞其他页）
      }
    },
    [fileId, pages],
  );

  // 单页模式预加载 ±2；卸载时释放全部 object URL
  useEffect(() => {
    for (const d of [0, 1, 2, -1, -2]) void load(page + d);
  }, [page, load]);

  useEffect(() => {
    const all = urlsRef.current;
    return () => {
      for (const u of all.values()) URL.revokeObjectURL(u);
    };
  }, []);

  // 主动跳页/切模式后，条漫模式滚动到目标页；
  // 依赖只放 navSeq：滚动引起的可见页变化不得反向滚动（死循环）
  useEffect(() => {
    if (modeRef.current !== "scroll") return;
    const root = rootRef.current;
    const el = pageEls.current.get(pageRef.current);
    if (root && el) root.scrollTop = el.offsetTop;
  }, [navSeq]);

  // ref 回调同时驱动 LazyPage 的 root（需要 state 触发其 effect 重挂）
  const setRoot = useCallback((el: HTMLElement | null) => {
    rootRef.current = el;
    setIoRoot(el);
  }, []);

  if (mode === "page") {
    // 方向性进场动画：key 换页重挂触发；关动画/跳页（dir=0）不播
    const animCls =
      anim === "none" || dir === 0 ? undefined : dir > 0 ? "pv-page-in-right" : "pv-page-in-left";
    return (
      <div
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-auto ${
          fit === "fit-width"
            ? "[&_img]:w-full [&_img]:h-auto"
            : fit === "fit-height"
              ? "[&_img]:h-full [&_img]:w-auto"
              : ""
        }`}
        style={{ background: prefs.theme.bg }}
      >
        {urls.get(page) ? (
          <div
            key={page}
            className={animCls}
            style={animCls ? { animationDuration: `${animSpeed}ms` } : undefined}
          >
            <img src={urls.get(page)} alt={`第 ${page + 1} 页`} className="max-w-full shadow-1" />
          </div>
        ) : (
          <span className="text-[13px]" style={{ color: prefs.theme.muted }}>
            加载中…
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative min-h-0 flex-1 overflow-auto"
      style={{ background: prefs.theme.bg }}
      ref={setRoot}
    >
      <div className={fit === "fit-width" ? "mx-auto w-full" : "mx-auto w-fit max-w-full"}>
        {pages.map((_, i) => (
          <div
            key={i}
            ref={(el) => {
              if (el) pageEls.current.set(i, el);
              else pageEls.current.delete(i);
            }}
          >
            <LazyPage
              index={i}
              url={urls.get(i)}
              load={load}
              onVisible={onPageVisible}
              root={ioRoot}
              theme={prefs.theme}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
