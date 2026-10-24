/**
 * EPUB 阅读器（M2 方案：iframe srcdoc + 资源内联）。
 * 章节 HTML 经 get_resource 取出 → 基本清理（去 script/on* 属性）→
 * 相对路径图片按 zip 路径解析后内联为 data URL → 注入排版 CSS。
 * 进度模型：{ type: "chapter", chapterId(=zip href), progress(章内滚动比) }
 *
 * 已知限制（docs/formats/）：外部 CSS/字体不加载（P1 升级 foliate-js 渲染引擎时解决）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, guessMime, toDataUrl, type ChapterDto, type ReadingLocation } from "../../app/api";

interface Props {
  fileId: string;
  chapters: ChapterDto[];
  initial: ReadingLocation | null;
  onProgress: (loc: ReadingLocation) => void;
}

function zipDir(href: string): string {
  const i = href.lastIndexOf("/");
  return i < 0 ? "" : href.slice(0, i);
}

function resolveZipPath(baseDir: string, rel: string): string {
  const clean = rel.split("#")[0];
  const parts = (baseDir ? `${baseDir}/${clean}` : clean).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

const TYPO_CSS = `
body { margin: 0; padding: 32px 24px 96px; max-width: 42em; margin: 0 auto;
  font-size: 18px; line-height: 1.7; color: var(--reading-fg); background: transparent;
  font-family: -apple-system, "PingFang SC", "Songti SC", "Noto Sans CJK SC", sans-serif; }
img { max-width: 100%; }
`;

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

async function inlineImages(html: string, chapterHref: string, fileId: string): Promise<string> {
  const dir = zipDir(chapterHref);
  const imgs = Array.from(html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/gi));
  let out = html;
  for (const m of imgs) {
    const src = m[1];
    if (src.startsWith("data:")) continue;
    const zipPath = resolveZipPath(dir, src);
    try {
      const bytes = await api.getResource(fileId, zipPath);
      const dataUrl = toDataUrl(bytes, guessMime(zipPath));
      out = out.replace(src, dataUrl);
    } catch {
      // 图片缺失：保留原样（可能显示占位）
    }
  }
  return out;
}

export function EpubReader({ fileId, chapters, initial, onProgress }: Props) {
  const init = initial?.type === "chapter" ? initial : null;
  const [currentId, setCurrentId] = useState(() => init?.chapterId ?? chapters[0]?.id ?? "");
  const [doc, setDoc] = useState<string>("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const currentRef = useRef(currentId);
  currentRef.current = currentId;
  const restoredRef = useRef(false);

  const chapter = useMemo(() => chapters.find((c) => c.id === currentId), [chapters, currentId]);

  useEffect(() => {
    if (!chapter) return;
    let cancelled = false;
    const href = "zip_entry" in chapter.locator ? chapter.locator.zip_entry : chapter.id;
    void api
      .getResource(fileId, href)
      .then(async (bytes) => {
        let html = new TextDecoder().decode(bytes);
        html = sanitizeHtml(html);
        html = await inlineImages(html, href, fileId);
        if (cancelled) return;
        setDoc(
          `<!doctype html><html><head><meta charset="utf-8"><style>${TYPO_CSS}</style></head><body>${html}</body></html>`,
        );
      })
      .catch(() => {
        if (!cancelled) setDoc(`<!doctype html><html><body>章节读取失败</body></html>`);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, chapter]);

  // iframe 内滚动进度
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onLoad = () => {
      const win = frame.contentWindow;
      if (!win) return;
      const handler = () => {
        const doc2 = win.document.documentElement;
        const ratio = win.scrollY / Math.max(1, doc2.scrollHeight - win.innerHeight);
        onProgress({
          type: "chapter",
          chapterId: currentRef.current,
          progress: Math.min(1, Math.max(0, ratio)),
        });
      };
      win.addEventListener("scroll", handler, { passive: true });
      // 恢复位置
      if (!restoredRef.current && init && init.chapterId === currentId) {
        const doc2 = win.document.documentElement;
        win.scrollTo(0, init.progress * Math.max(0, doc2.scrollHeight - win.innerHeight));
        restoredRef.current = true;
      }
    };
    frame.addEventListener("load", onLoad);
    return () => frame.removeEventListener("load", onLoad);
  }, [doc, init, currentId, onProgress]);

  const switchChapter = useCallback(
    (id: string) => {
      setCurrentId(id);
      restoredRef.current = false;
      onProgress({ type: "chapter", chapterId: id, progress: 0 });
    },
    [onProgress],
  );

  const idx = chapters.findIndex((c) => c.id === currentId);

  return (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-line bg-paper-raised px-5 py-2.5">
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
        <span className="ml-auto whitespace-nowrap text-xs text-muted">
          {idx + 1}/{chapters.length} {chapter?.title ?? ""}
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
        <div className="flex-1 overflow-auto bg-reading text-reading-fg">
          <iframe
            ref={frameRef}
            className="h-full w-full border-none bg-reading"
            title="epub"
            srcDoc={doc}
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </>
  );
}
