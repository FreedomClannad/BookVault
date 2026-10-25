/**
 * EPUB 正文视图（M2 方案：iframe srcdoc + 资源内联）。
 * 章节 HTML 经 get_resource 取出 → 基本清理（去 script/on* 属性）→
 * 相对路径图片按 zip 路径解析后内联为 data URL。
 * 沉浸式改造后不含工具栏与章节侧栏：章节切换由 Reader 层受控；
 * 排版（颜色/字号/行高/字体）在 iframe load 后动态注入 body style，
 * 改偏好不重载 srcDoc、不丢滚动位置。
 * 进度模型：{ type: "chapter", chapterId(=zip href), progress(章内滚动比) }
 * 滚动导航：对外暴露 ScrollPager（iframe 内按屏滚动，见 pager.ts）；iframe 会吞掉
 * 父层的指针/键盘事件，点击翻页由 Reader 层的覆盖条实现（无法用容器事件判区）。
 *
 * 已知限制（docs/formats/）：外部 CSS/字体不加载（P1 升级 foliate-js 渲染引擎时解决）；
 * iframe 内的键盘事件不冒泡到父层，章节切换需用悬浮工具栏。
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { api, guessMime, toDataUrl, type ChapterDto, type ReadingLocation } from "../../app/api";
import type { ScrollPager } from "./pager";
import { FONT_SANS, FONT_SERIF, type ReadingPrefs } from "./readingPrefs";

interface Props {
  fileId: string;
  chapters: ChapterDto[];
  chapterId: string;
  initial: ReadingLocation | null;
  prefs: ReadingPrefs;
  onProgress: (loc: ReadingLocation) => void;
  /** iframe 内的鼠标活动（iframe 会吞掉父层 mousemove，需内部转发唤出悬浮工具栏） */
  onActivity: () => void;
  /** 查找跳转意图：seq 变化时滚到章内等比例位置（EPUB 命中不做 iframe 内高亮） */
  jump?: { ratio: number; seq: number } | null;
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

/** 静态骨架：排版值一律由 applyTypo 动态注入，避免改偏好时重载文档。
 * 滚动条样式对齐全局（app.css 的 8px 细滚动条）——iframe 是独立文档不继承全局样式，
 * 默认粗滚动条会被右侧点击翻页覆盖条压住（覆盖条按 8px 宽度内缩让出滚动条）。 */
const typoCss = `
body { margin: 0 auto; padding: 32px 24px 96px; max-width: 40em; }
img { max-width: 100%; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: rgb(128 128 128 / 0.45); border-radius: 4px; }
::-webkit-scrollbar-track { background: transparent; }
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

export function EpubReader({
  fileId,
  chapters,
  chapterId,
  initial,
  prefs,
  onProgress,
  onActivity,
  jump,
  ref,
}: Props & { ref?: Ref<ScrollPager> }) {
  const init = initial?.type === "chapter" ? initial : null;
  const [doc, setDoc] = useState<string>("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const chapterRef = useRef(chapterId);
  chapterRef.current = chapterId;
  const restoredRef = useRef(false);
  /** 查找跳转意图按 seq 只消费一次：切章重载 srcDoc 时旧意图不再触发 */
  const jumpSeqConsumed = useRef(-1);
  /** 当前 iframe 文档所属章节：跳转意图必须等「新章节的文档」load 完成再消费 */
  const docChapterRef = useRef<string | null>(null);
  const jumpRef = useRef(jump);
  jumpRef.current = jump;

  // 滚动翻页原语（Reader 层据此「先按屏推进、到边界才跨章」，见 pager.ts）；
  // 文档未就绪时吞掉翻页，避免把加载中的章节误判为章末而跳章
  useImperativeHandle(ref, () => ({
    pageDown: () => {
      const win = frameRef.current?.contentWindow;
      if (!win || !doc || docChapterRef.current !== chapterRef.current) return true;
      const d2 = win.document.documentElement;
      const max = d2.scrollHeight - win.innerHeight;
      if (win.scrollY >= max - 1) return false;
      win.scrollTo({ top: Math.min(max, win.scrollY + win.innerHeight), behavior: "smooth" });
      return true;
    },
    pageUp: () => {
      const win = frameRef.current?.contentWindow;
      if (!win || !doc || docChapterRef.current !== chapterRef.current) return true;
      if (win.scrollY <= 1) return false;
      win.scrollTo({ top: Math.max(0, win.scrollY - win.innerHeight), behavior: "smooth" });
      return true;
    },
  }));

  const chapter = useMemo(() => chapters.find((c) => c.id === chapterId), [chapters, chapterId]);

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
          // 文末注入章节标记：相邻两章内容完全相同（空章节等）时 srcDoc 字符串也必须
          // 不同，否则 React 判定无变化、iframe 不重载，load/docChapterRef 全部失联
          `<!doctype html><html><head><meta charset="utf-8"><style>${typoCss}</style></head><body>${html}<!--bv-chapter:${href}--></body></html>`,
        );
      })
      .catch(() => {
        if (!cancelled) setDoc(`<!doctype html><html><body>章节读取失败</body></html>`);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, chapter]);

  // 排版落到 iframe 正文：偏好变化即时生效，不重载 srcDoc（不丢滚动位置）
  const applyTypo = useCallback(() => {
    const win = frameRef.current?.contentWindow;
    if (!win?.document.body) return;
    const s = win.document.body.style;
    s.color = prefs.theme.fg;
    s.fontSize = `${prefs.fontSize}px`;
    s.lineHeight = String(prefs.lineHeight);
    s.fontFamily = prefs.serif ? FONT_SERIF : FONT_SANS;
  }, [prefs]);

  useEffect(() => {
    applyTypo();
  }, [applyTypo, doc]);

  // 查找/回退跳转：统一走 consumeJump——
  // - 文档已就绪（章内跳转）：effect 立即消费；
  // - 刚切章：新 srcDoc 的 load 完成前滚动会被重置，onLoad 里再消费。
  // docChapterRef 守卫保证意图不会被「切换瞬间的旧文档」吞掉。
  const consumeJump = useCallback(() => {
    const j = jumpRef.current;
    if (!j || j.seq === jumpSeqConsumed.current) return;
    if (docChapterRef.current !== chapterRef.current) return;
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    jumpSeqConsumed.current = j.seq;
    const d2 = win.document.documentElement;
    win.scrollTo(0, j.ratio * Math.max(0, d2.scrollHeight - win.innerHeight));
    onProgress({
      type: "chapter",
      chapterId: chapterRef.current,
      progress: Math.min(1, Math.max(0, j.ratio)),
    });
  }, [onProgress]);

  useEffect(() => {
    consumeJump();
  }, [jump, doc, consumeJump]);

  // iframe 内滚动进度 + 恢复位置
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onLoad = () => {
      const win = frame.contentWindow;
      if (!win) return;
      docChapterRef.current = chapterRef.current;
      applyTypo();
      const handler = () => {
        const doc2 = win.document.documentElement;
        const ratio = win.scrollY / Math.max(1, doc2.scrollHeight - win.innerHeight);
        onProgress({
          type: "chapter",
          chapterId: chapterRef.current,
          progress: Math.min(1, Math.max(0, ratio)),
        });
      };
      win.addEventListener("scroll", handler, { passive: true });
      win.addEventListener("mousemove", onActivity, { passive: true });
      consumeJump();
      if (!restoredRef.current && init && init.chapterId === chapterRef.current) {
        const doc2 = win.document.documentElement;
        win.scrollTo(0, init.progress * Math.max(0, doc2.scrollHeight - win.innerHeight));
        restoredRef.current = true;
      }
    };
    frame.addEventListener("load", onLoad);
    return () => frame.removeEventListener("load", onLoad);
  }, [doc, init, onProgress, applyTypo, onActivity, consumeJump]);

  return (
    <div className="min-h-0 flex-1" style={{ background: prefs.theme.bg }}>
      {doc ? (
        <iframe
          ref={frameRef}
          className="h-full w-full border-none"
          title="epub"
          srcDoc={doc}
          sandbox="allow-same-origin"
        />
      ) : (
        <div
          className="flex h-[50vh] items-center justify-center text-sm"
          style={{ color: prefs.theme.muted }}
        >
          正在加载章节…
        </div>
      )}
    </div>
  );
}
