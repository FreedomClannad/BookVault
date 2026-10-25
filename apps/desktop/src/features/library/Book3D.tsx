/**
 * 3D 书（书柜单本）：封面/书脊/页缘三面 CSS preserve-3d，悬停抽出；
 * 无封面时自动兜底——TXT 生成素雅封面、PDF 渲染第 1 页缩略图，成功后落盘刷新。
 * 悬停操作：改分类 / 换封面（本地图，经对话框受控导入）。
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as pdfjs from "pdfjs-dist";
import { api, type WorkRow } from "../../app/api";
import { CATEGORIES, coverHashColor } from "./categories";
import { generateCover } from "./coverGen";

/** 跨实例防重复生成/保存（书柜与搜索结果可能同时渲染同一本） */
const coverInFlight = new Set<string>();

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

function useCoverUrl(workId: string, hasCover: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hasCover) return;
    let current: string | null = null;
    void api.getCover(workId).then((bytes) => {
      if (!bytes || bytes.length === 0) return;
      current = URL.createObjectURL(new Blob([bytes.slice() as unknown as BlobPart]));
      setUrl(current);
    });
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, [workId, hasCover]);
  return url;
}

interface Props {
  work: WorkRow;
  onOpen: () => void;
  onCoverSaved: () => void;
  onCategoryChange: (category: string) => void;
  onToast: (msg: string) => void;
}

export function Book3D({ work, onOpen, onCoverSaved, onCategoryChange, onToast }: Props) {
  const coverUrl = useCoverUrl(work.id, work.hasCover);
  const [menuOpen, setMenuOpen] = useState(false);
  const busy = useRef(false);
  const file = work.files[0];

  // 无封面兜底：TXT 生成 / PDF 首页缩略图，落盘后刷新书库（hasCover 翻转后走真实封面）
  useEffect(() => {
    if (work.hasCover || !file || busy.current || coverInFlight.has(work.id)) return;
    if (file.format !== "txt" && file.format !== "pdf") return;
    busy.current = true;
    coverInFlight.add(work.id);
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
        // 兜底失败保留占位外观，不打扰用户
      } finally {
        coverInFlight.delete(work.id);
        busy.current = false;
      }
    })();
  }, [work, file, onCoverSaved]);

  const spine = coverHashColor(work.id);
  const title = work.title;

  const changeCover = async () => {
    if (!file) return;
    try {
      await api.importCover(file.id);
      onCoverSaved();
      onToast("封面已更新");
    } catch (e) {
      onToast(`设置封面失败: ${String(e)}`);
    }
  };

  return (
    <div className="book3d-scene">
      <button
        type="button"
        className="book3d"
        style={{ "--spine": spine, "--thick": "26px" } as CSSProperties}
        onClick={onOpen}
        title={`${title} — 点击阅读`}
        aria-label={`阅读 ${title}`}
      >
        <span className="book3d-face book3d-back" aria-hidden="true" />
        <span className="book3d-face book3d-pages" aria-hidden="true" />
        <span className="book3d-face book3d-spine" aria-hidden="true">
          <span>{title.slice(0, 10)}</span>
        </span>
        <span className="book3d-face book3d-front">
          {coverUrl ? (
            <img src={coverUrl} alt="" draggable={false} />
          ) : (
            <span className="book3d-fallback">
              <i>{title.slice(0, 6)}</i>
            </span>
          )}
        </span>
      </button>

      <div className="book3d-caption" title={title}>
        {title}
      </div>

      <div className="book3d-actions">
        <button
          type="button"
          className="cursor-interaction"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          title="改分类"
        >
          分类
        </button>
        <button
          type="button"
          className="cursor-interaction"
          onClick={() => void changeCover()}
          title="设为封面"
        >
          封面
        </button>
      </div>

      {menuOpen && (
        <div className="book3d-menu" role="menu" aria-label={`选择 ${title} 的分类`}>
          <button
            type="button"
            role="menuitem"
            className={work.category === "" ? "active" : ""}
            onClick={() => {
              onCategoryChange("");
              setMenuOpen(false);
            }}
          >
            未分类
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitem"
              className={work.category === c ? "active" : ""}
              onClick={() => {
                onCategoryChange(c);
                setMenuOpen(false);
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
