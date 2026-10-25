/**
 * PDF 正文视图：pdf.js 前端渲染（ADR-002）。
 * 沉浸式改造后不含工具栏：当前页与缩放由 Reader 层受控，进度由 Reader 落库。
 */

import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "../../app/api";
import type { ReadingPrefs } from "./readingPrefs";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  fileId: string;
  toc: { title: string; page: number }[];
  /** 受控当前页（0 起） */
  page: number;
  scale: number;
  prefs: ReadingPrefs;
}

export function PdfReader({ fileId, toc, page, scale, prefs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const taskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 文档异步加载完成后触发首次渲染（渲染 effect 依赖它）
  const [docReady, setDocReady] = useState(0);

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
        setDocReady((n) => n + 1);
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      void taskRef.current?.destroy();
    };
  }, [fileId]);

  // 渲染当前页（快速翻页时取消上一次未完成的渲染，避免旧页覆盖新页）
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let cancelled = false;
    void doc
      .getPage(page + 1)
      .then((pg) => {
        if (cancelled) return;
        const viewport = pg.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        renderTaskRef.current?.cancel();
        const renderTask = pg.render({ canvas, canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;
        return renderTask.promise;
      })
      .catch((e) => {
        // 渲染被新任务取消属正常流程，不当作错误
        if (!cancelled && !String(e).toLowerCase().includes("cancel")) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [page, scale, docReady]);

  const currentToc =
    toc.length > 0 ? [...toc].reverse().find((t) => t.page <= page + 1) : undefined;

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="max-w-[420px] px-8 text-center leading-relaxed text-danger">
          PDF 渲染失败: {error}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 justify-center overflow-auto"
      style={{ background: prefs.theme.bg }}
    >
      <canvas ref={canvasRef} aria-label={currentToc ? currentToc.title : undefined} />
    </div>
  );
}
