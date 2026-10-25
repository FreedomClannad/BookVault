/**
 * 无封面书的兜底生成（TXT 画生成式封面 / PDF 取第 1 页缩略图），成功后落盘并回调刷新。
 * 书柜 3D 书与立体书架共用；三个保护：
 * - inFlight：跨实例防重复（同一本可能同时渲染在网格与搜索结果里）；
 * - attempted：每会话每书至多尝试一次——成功回调触发的重渲染不得再重触发自己
 *   （曾因此形成 封面生成→刷新→重渲染→再生成 无限循环，mock 模式打满主线程直至卡死）；
 * - 封面就位/失败时清 attempted，允许将来的会话或下次渲染再次兜底。
 */

import * as pdfjs from "pdfjs-dist";
import { api, type WorkRow } from "../../app/api";
import { generateCover } from "./coverGen";

const inFlight = new Set<string>();
const attempted = new Set<string>();

async function pdfFirstPageDataUrl(fileId: string): Promise<string> {
  const bytes = await api.getFileBytes(fileId);
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1.2, 360 / base.width) });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    void task.destroy();
  }
}

/** 无封面且格式可生成（TXT/PDF）时异步兜底；重复调用安全 */
export function ensureCover(work: WorkRow, onCoverSaved: () => void): void {
  const file = work.files[0];
  if (work.hasCover || !file || inFlight.has(work.id) || attempted.has(work.id)) return;
  if (file.format !== "txt" && file.format !== "pdf") return;
  inFlight.add(work.id);
  attempted.add(work.id);
  void (async () => {
    try {
      const dataUrl =
        file.format === "txt"
          ? generateCover(work.title, work.authors[0] ?? "", work.id)
          : await pdfFirstPageDataUrl(file.id);
      if (!dataUrl) return;
      await api.saveCover(file.id, dataUrl);
      onCoverSaved();
    } catch {
      // 兜底失败保留占位外观，不打扰用户；清标记允许下次渲染重试一次
      attempted.delete(work.id);
    } finally {
      inFlight.delete(work.id);
    }
  })();
}

/** 封面已就位（hasCover 翻转）后调用：清尝试标记，允许将来封面丢失时再次兜底 */
export function markCoverPresent(workId: string): void {
  attempted.delete(workId);
}
