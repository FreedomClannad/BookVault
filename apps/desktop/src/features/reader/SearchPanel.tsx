/**
 * 查找面板（包 B-4）：右侧抽屉，整书/本章全文检索。
 * TXT 直接按章取纯文本；EPUB 拉章节 HTML 去 script/style 与标签后检索
 * （匹配/截取的纯函数在 @bookvault/shared/search，有单测）。
 * 命中列表点击 → onJump(章序号, 章内字符比例)，定位换算由 Reader 层做
 * （分页模式换算屏号，滚动模式滚到等比例位置）——与进度同一套比例语义。
 *
 * 已知限制：EPUB 命中不做 iframe 内高亮（仅滚动定位）；PDF 检索后置。
 */

import { useEffect, useRef, useState } from "react";
import { findHits, stripHtml, type SearchHit } from "@bookvault/shared";
import { api, type ChapterDto } from "../../app/api";

const MAX_HITS_PER_CHAPTER = 20;
const MAX_HITS_TOTAL = 300;

interface HitRow {
  chapterIdx: number;
  chapterTitle: string;
  hit: SearchHit;
}

interface Props {
  fileId: string;
  format: string;
  chapters: ChapterDto[];
  currentChapterIdx: number;
  query: string;
  onQueryChange: (q: string) => void;
  onJump: (chapterIdx: number, ratio: number) => void;
  onClose: () => void;
}

/** 章资源定位：TXT 用章 id（区间）；EPUB 用 zip 路径（与 EpubReader 一致） */
function chapterResource(ch: ChapterDto): string {
  return "zip_entry" in ch.locator ? ch.locator.zip_entry : ch.id;
}

async function chapterText(fileId: string, format: string, ch: ChapterDto): Promise<string> {
  const bytes = await api.getResource(fileId, chapterResource(ch));
  const raw = new TextDecoder().decode(bytes);
  return format === "epub" ? stripHtml(raw) : raw;
}

export function SearchPanel({
  fileId,
  format,
  chapters,
  currentChapterIdx,
  query,
  onQueryChange,
  onJump,
  onClose,
}: Props) {
  const [scope, setScope] = useState<"book" | "chapter">("book");
  const [hits, setHits] = useState<HitRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [scanned, setScanned] = useState(0);
  const reqRef = useRef(0);

  const runSearch = async () => {
    const q = query.trim();
    const myReq = ++reqRef.current;
    if (!q) {
      setHits(null);
      return;
    }
    const target =
      scope === "chapter" ? [{ idx: currentChapterIdx, ch: chapters[currentChapterIdx] }] : null;
    const list = target ?? chapters.map((ch, idx) => ({ idx, ch })).filter((x) => x.ch != null);
    setSearching(true);
    setScanned(0);
    const out: HitRow[] = [];
    let done = 0;
    for (const { idx, ch } of list) {
      if (reqRef.current !== myReq) return; // 新搜索/关闭面板：放弃本次
      try {
        const text = await chapterText(fileId, format, ch);
        if (reqRef.current !== myReq) return;
        for (const hit of findHits(text, q, { maxHits: MAX_HITS_PER_CHAPTER })) {
          out.push({ chapterIdx: idx, chapterTitle: ch.title ?? `第 ${idx + 1} 章`, hit });
        }
      } catch {
        // 单章读取失败（资源缺失等）：跳过，其余章继续
      }
      done += 1;
      setScanned(done);
      if (out.length >= MAX_HITS_TOTAL) break;
    }
    if (reqRef.current !== myReq) return;
    setHits(out);
    setSearching(false);
  };

  // 卸载时让在途检索作废
  useEffect(() => () => void ++reqRef.current, []);

  const total = scope === "chapter" ? 1 : chapters.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1 font-display text-[15px] font-semibold">查找</div>
        <button className="btn btn-ghost px-2.5" title="关闭（Esc）" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="flex-none space-y-2.5 border-b border-line px-4 py-3">
        <div className="flex gap-2">
          <input
            type="search"
            className="input min-w-0 flex-1"
            placeholder="输入关键词，回车检索"
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
              if (e.key === "Escape") onClose();
            }}
          />
          <button
            className="btn"
            onClick={() => void runSearch()}
            disabled={searching || !query.trim()}
          >
            {searching ? "检索中" : "查找"}
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          {(["book", "chapter"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`cursor-pointer rounded-md px-2 py-1 transition-colors ${
                scope === s
                  ? "bg-accent-weak font-medium text-accent-strong"
                  : "hover:bg-paper-raised"
              }`}
              onClick={() => setScope(s)}
            >
              {s === "book" ? "整书" : "本章"}
            </button>
          ))}
          {searching && (
            <span className="ml-auto">
              {scanned}/{total} 章…
            </span>
          )}
          {!searching && hits !== null && (
            <span className="ml-auto">
              {hits.length >= MAX_HITS_TOTAL ? `${hits.length}+ 处命中` : `${hits.length} 处命中`}
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        {hits === null ? (
          <div className="px-2 py-6 text-center text-[13px] text-muted">
            支持整书跨章检索；命中后点击可跳转定位
          </div>
        ) : hits.length === 0 ? (
          <div className="px-2 py-6 text-center text-[13px] text-muted">
            {searching ? "" : "没有找到匹配内容"}
          </div>
        ) : (
          hits.map((row, i) => (
            <button
              key={i}
              className="block w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-paper-raised"
              onClick={() => onJump(row.chapterIdx, row.hit.ratio)}
              title={`跳转到：${row.chapterTitle}`}
            >
              <span className="mb-0.5 flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted">
                  {row.chapterTitle}
                </span>
                {row.chapterIdx === currentChapterIdx && (
                  <span className="flex-none text-[11px] text-seal">本章</span>
                )}
              </span>
              <span className="block truncate text-[13px] leading-relaxed">
                …{row.hit.before}
                <b className="font-semibold text-accent-strong">{row.hit.hit}</b>
                {row.hit.after}…
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
