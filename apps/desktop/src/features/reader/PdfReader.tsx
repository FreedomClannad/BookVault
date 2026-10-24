/**
 * PDF 阅读器：pdf.js 前端渲染（ADR-002），页码进度模型 { type: "page", pageIndex }。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, type ReadingLocation } from "../../app/api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  fileId: string;
  pages: number;
  toc: { title: string; page: number }[];
  initial: ReadingLocation | null;
  onProgress: (loc: ReadingLocation) => void;
}

export function PdfReader({ fileId, pages, toc, initial, onProgress }: Props) {
  const initPage = initial?.type === "page" ? initial.pageIndex : 0;
  const [pageNum, setPageNum] = useState(() => Math.min(initPage, Math.max(0, pages - 1)));
  const [scale, setScale] = useState(1.2);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const taskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getFileBytes(fileId)
      .then(async (bytes) => {
        const task = pdfjs.getDocument({ data: bytes.slice() });
        taskRef.current = task;
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        docRef.current = doc;
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      void taskRef.current?.destroy();
    };
  }, [fileId]);

  // 渲染当前页
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let cancelled = false;
    void doc
      .getPage(pageNum + 1)
      .then((page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        void page.render({ canvas, canvasContext: ctx, viewport }).promise;
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [pageNum, scale]);

  useEffect(() => {
    onProgress({ type: "page", pageIndex: pageNum });
  }, [pageNum, onProgress]);

  const go = useCallback(
    (delta: number) => setPageNum((p) => Math.min(pages - 1, Math.max(0, p + delta))),
    [pages],
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [go]);

  if (error) {
    return (
      <div className="mx-auto flex max-w-[420px] flex-1 flex-col items-center justify-center gap-3.5 px-8 text-center leading-relaxed text-danger">
        <div>PDF 渲染失败: {error}</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-line bg-paper-raised px-5 py-2.5">
        <button className="btn" onClick={() => go(-1)}>
          ←
        </button>
        <span className="ml-auto whitespace-nowrap text-xs text-muted">
          {pageNum + 1}/{pages}
        </span>
        <button className="btn" onClick={() => go(1)}>
          →
        </button>
        <button className="btn" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>
          -
        </button>
        <span className="ml-auto whitespace-nowrap text-xs text-muted">
          {Math.round(scale * 100)}%
        </span>
        <button className="btn" onClick={() => setScale((s) => Math.min(4, s + 0.2))}>
          +
        </button>
        {toc.length > 0 && (
          <select
            onChange={(e) => setPageNum(Number(e.target.value) - 1)}
            value={pageNum + 1}
            className="input"
          >
            {toc.map((t, i) => (
              <option key={i} value={t.page}>
                {t.title}（p{t.page}）
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-1 justify-center overflow-auto bg-reading">
        <canvas ref={canvasRef} />
      </div>
    </>
  );
}
