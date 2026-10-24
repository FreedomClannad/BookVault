/**
 * 漫画阅读器：单页翻页 + 条漫滚动双模式，预加载 ±2 页（ui-style §4）。
 * 进度模型：{ type: "comic", imageIndex }
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PageDto, type ReadingLocation } from "../../app/api";

interface Props {
  fileId: string;
  pages: PageDto[];
  initial: ReadingLocation | null;
  onProgress: (loc: ReadingLocation) => void;
}

type FitMode = "fit-width" | "fit-height" | "original";

function locatorKey(p: PageDto): string {
  if ("zip_entry" in p.locator) return p.locator.zip_entry;
  if ("file_path" in p.locator) return p.locator.file_path;
  return String(p.index);
}

export function ComicReader({ fileId, pages, initial, onProgress }: Props) {
  const initIdx = initial?.type === "comic" ? initial.imageIndex : 0;
  const [idx, setIdx] = useState(() => Math.min(initIdx, Math.max(0, pages.length - 1)));
  const [mode, setMode] = useState<"page" | "scroll">("page");
  const [fit, setFit] = useState<FitMode>("fit-width");
  const [urls, setUrls] = useState<Map<number, string>>(new Map());
  const fitRef = useRef(localStorage.getItem("comic.fit") as FitMode | null);
  if (fitRef.current && fitRef.current !== fit) {
    setFit(fitRef.current);
  }

  const load = useCallback(
    async (i: number) => {
      if (i < 0 || i >= pages.length) return;
      const page = pages[i];
      if (!page) return;
      try {
        const bytes = await api.getResource(fileId, locatorKey(page));
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

  // 预加载 ±2
  useEffect(() => {
    for (const d of [0, 1, 2, -1, -2]) void load(idx + d);
  }, [idx, load]);

  useEffect(() => {
    onProgress({ type: "comic", imageIndex: idx });
  }, [idx, onProgress]);

  const changeFit = (f: FitMode) => {
    setFit(f);
    localStorage.setItem("comic.fit", f);
  };

  const go = useCallback(
    (delta: number) => {
      setIdx((i) => Math.min(pages.length - 1, Math.max(0, i + delta)));
    },
    [pages.length],
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [go]);

  const current = pages[idx];

  return (
    <>
      <div className="reader-toolbar">
        <button onClick={() => go(-1)}>←</button>
        <button onClick={() => go(1)}>→</button>
        <span className="book-meta">
          {idx + 1}/{pages.length}
        </span>
        <button onClick={() => setMode(mode === "page" ? "scroll" : "page")}>
          {mode === "page" ? "切到条漫滚动" : "切到单页翻页"}
        </button>
        <button onClick={() => changeFit("fit-width")}>适宽</button>
        <button onClick={() => changeFit("fit-height")}>适高</button>
        <button onClick={() => changeFit("original")}>原始</button>
      </div>
      <div className={`comic-stage ${fit}`}>
        {mode === "page" ? (
          urls.get(idx) ? (
            <img src={urls.get(idx)} alt={`第 ${idx + 1} 页`} />
          ) : (
            <span className="comic-loading">加载中… {current ? locatorKey(current) : ""}</span>
          )
        ) : (
          <div>
            {pages.map((_, i) =>
              urls.get(i) ? <img key={i} src={urls.get(i)} alt={`第 ${i + 1} 页`} /> : null,
            )}
          </div>
        )}
      </div>
    </>
  );
}
