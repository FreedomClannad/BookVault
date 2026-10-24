/**
 * TXT 阅读器：章节侧栏 + 正文（按需读取章节文本）+ 滚动进度。
 * 进度模型：{ type: "chapter", chapterId, progress(章内滚动比) }
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ChapterDto, type ReadingLocation } from "../../app/api";

interface Props {
  fileId: string;
  chapters: ChapterDto[];
  initial: ReadingLocation | null;
  onProgress: (loc: ReadingLocation) => void;
}

export function TxtReader({ fileId, chapters, initial, onProgress }: Props) {
  const init = initial?.type === "chapter" ? initial : null;
  const [currentId, setCurrentId] = useState(() => init?.chapterId ?? chapters[0]?.id ?? "");
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(() =>
    Number(localStorage.getItem("reader.fontSize") ?? 18),
  );
  const paneRef = useRef<HTMLDivElement>(null);
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const restoredRef = useRef(false);

  // 加载章节内容（按需读取，不整本载入——ADR-002）
  useEffect(() => {
    let cancelled = false;
    void api
      .getResource(fileId, currentId)
      .then((bytes) => {
        if (!cancelled) setText(new TextDecoder().decode(bytes));
      })
      .catch((e) => {
        if (!cancelled) setText(`（章节读取失败: ${String(e)}）`);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, currentId]);

  // 进度上报（节流由 Reader 层负责）
  const reportScroll = useCallback(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const ratio = pane.scrollTop / Math.max(1, pane.scrollHeight - pane.clientHeight);
    onProgress({
      type: "chapter",
      chapterId: currentIdRef.current,
      progress: Math.min(1, Math.max(0, ratio)),
    });
  }, [onProgress]);

  // 恢复章内滚动位置（仅首次）
  useEffect(() => {
    if (restoredRef.current || !init || paneRef.current?.scrollHeight === 0) return;
    const pane = paneRef.current;
    if (pane && pane.scrollHeight > pane.clientHeight) {
      pane.scrollTop = init.progress * (pane.scrollHeight - pane.clientHeight);
      restoredRef.current = true;
    }
  }, [text, init]);

  const switchChapter = useCallback(
    (id: string) => {
      setCurrentId(id);
      restoredRef.current = false;
      onProgress({ type: "chapter", chapterId: id, progress: 0 });
      paneRef.current?.scrollTo({ top: 0 });
    },
    [onProgress],
  );

  // 字号持久化（M2.12 设置存储的阅读器部分）
  const changeFont = (size: number) => {
    setFontSize(size);
    localStorage.setItem("reader.fontSize", String(size));
  };

  const idx = chapters.findIndex((c) => c.id === currentId);

  return (
    <>
      <div
        className="flex flex-none items-center gap-2 border-b border-line bg-paper-raised px-5 py-2.5"
        style={{ flex: "0 0 auto" }}
      >
        <button
          className="btn"
          disabled={idx <= 0}
          onClick={() => idx > 0 && switchChapter(chapters[idx - 1].id)}
        >
          ← 上一章
        </button>
        <button
          disabled={idx < 0 || idx >= chapters.length - 1}
          onClick={() => idx < chapters.length - 1 && switchChapter(chapters[idx + 1].id)}
        >
          下一章 →
        </button>
        <button className="btn" onClick={() => changeFont(Math.max(14, fontSize - 2))}>
          A-
        </button>
        <button className="btn" onClick={() => changeFont(Math.min(28, fontSize + 2))}>
          A+
        </button>
        <span className="ml-auto whitespace-nowrap text-xs text-muted">
          {idx + 1}/{chapters.length} {chapters[idx]?.title ?? ""}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[236px] flex-none overflow-auto border-r border-line bg-paper p-2.5">
          {chapters.map((c) => (
            <button
              key={c.id}
              className={`block w-full truncate rounded-r-md border-l-2 border-l-transparent py-2 pl-3 pr-3 text-left text-[13px] text-muted hover:border-l-line hover:bg-paper-raised hover:text-fg ${c.id === currentId ? "border-l-seal bg-paper-raised font-medium text-accent-strong" : ""}`}
              onClick={() => switchChapter(c.id)}
            >
              {c.title ?? c.id}
            </button>
          ))}
        </div>
        <div
          className="flex-1 overflow-auto bg-reading text-reading-fg"
          ref={paneRef}
          onScroll={reportScroll}
        >
          <div
            className="mx-auto max-w-[40em] whitespace-pre-wrap px-7 pb-[120px] pt-10 text-justify first-letter:font-display first-letter:text-[1.9em] first-letter:leading-none first-letter:text-accent-strong"
            style={{ ["--reader-font-size" as string]: `${fontSize}px` }}
          >
            {text}
          </div>
        </div>
      </div>
    </>
  );
}
