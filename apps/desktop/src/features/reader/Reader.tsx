/**
 * 统一阅读器框架：open_book → 按 contents 类型分发到具体渲染器；
 * 负责进度保存/恢复（绑定内容哈希，ADR-003）与哈希漂移降级提示。
 * 渲染器只消费「目录 + 资源引用」，不知道具体格式（ADR-002 分层）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type OpenedBook, type ReadingLocation } from "../../app/api";
import { TxtReader } from "./TxtReader";
import { EpubReader } from "./EpubReader";
import { ComicReader } from "./ComicReader";
import { PdfReader } from "./PdfReader";

interface Props {
  fileId: string;
  onExit: () => void;
}

export function Reader({ fileId, onExit }: Props) {
  const [opened, setOpened] = useState<OpenedBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driftDismissed, setDriftDismissed] = useState(false);
  const lastSave = useRef<ReadingLocation | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .openBook(fileId)
      .then((b) => {
        if (!cancelled) setOpened(b);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const save = useCallback(
    (loc: ReadingLocation) => {
      lastSave.current = loc;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void api.saveReadingProgress(fileId, loc).catch(() => {});
      }, 800);
    },
    [fileId],
  );

  // 卸载时立即保存（退出自动保存——ui-style §3）
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-none items-center gap-2 border-b border-line bg-paper-raised px-5 py-2.5">
          <button className="btn btn-ghost" onClick={onExit}>
            ← 返回
          </button>
        </div>
        <div className="mx-auto flex max-w-[420px] flex-1 flex-col items-center justify-center gap-3.5 px-8 text-center leading-relaxed text-danger">
          <div>{error}</div>
          <button onClick={onExit}>返回书架</button>
        </div>
      </div>
    );
  }

  if (!opened) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-none items-center gap-2 border-b border-line bg-paper-raised px-5 py-2.5">
          <button className="btn btn-ghost" onClick={onExit}>
            ← 返回
          </button>
          <span className="mx-1 truncate font-display text-base font-semibold">正在打开…</span>
        </div>
      </div>
    );
  }

  const latest = opened.progress[0]?.location ?? null;
  const showDrift = opened.hashDrift && !driftDismissed && opened.progress.length > 0;

  const body = (() => {
    const c = opened.book.contents;
    if ("novel" in c && opened.file.format === "txt") {
      return (
        <TxtReader fileId={fileId} chapters={c.novel.chapters} initial={latest} onProgress={save} />
      );
    }
    if ("novel" in c) {
      return (
        <EpubReader
          fileId={fileId}
          chapters={c.novel.chapters}
          initial={latest}
          onProgress={save}
        />
      );
    }
    if ("comic" in c) {
      return (
        <ComicReader fileId={fileId} pages={c.comic.pages} initial={latest} onProgress={save} />
      );
    }
    if ("document" in c) {
      return (
        <PdfReader
          fileId={fileId}
          pages={c.document.pages}
          toc={c.document.toc}
          initial={latest}
          onProgress={save}
        />
      );
    }
    return null;
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-line bg-paper-raised px-5 py-2.5">
        <button className="btn btn-ghost" onClick={onExit}>
          ← 返回
        </button>
        <span className="mx-1 truncate font-display text-base font-semibold">
          {opened.book.metadata.title ?? opened.file.name}
        </span>
        <span className="ml-auto whitespace-nowrap text-xs text-muted">
          {opened.book.parser.parser} v{opened.book.parser.version}
        </span>
      </div>

      {showDrift && (
        <div className="flex flex-none items-center gap-3.5 border-b border-line bg-accent-weak px-5 py-[9px] text-[13px] text-accent-strong">
          ⚠ 文件内容已变更，旧进度的定位可能不准确
          <button className="btn" onClick={() => setDriftDismissed(true)}>
            仍使用旧进度
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              // 重置：以空进度打开（渲染器 initial 置 null 后不会跳转）
              setOpened({ ...opened, progress: [] });
              setDriftDismissed(true);
            }}
          >
            从头阅读
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">{body}</div>
    </div>
  );
}
