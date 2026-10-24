/**
 * 书架视图：继续阅读条 + 搜索/排序工具条 + 封面网格。
 * 封面缺失时用书名首字生成占位（背景色由书名哈希决定——ui-style §5）；
 * 「在读」用印章朱点标记。
 */

import { useEffect, useMemo, useState } from "react";
import { api, relTime, type WorkRow } from "../../app/api";

interface Props {
  works: WorkRow[];
  hidden: boolean;
  onOpen: (fileId: string) => void;
  onImport: () => void;
  onImportDir: () => void;
}

function coverColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 34% 40%)`;
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

function BookItem({ work, onOpen }: { work: WorkRow; onOpen: (id: string) => void }) {
  const coverUrl = useCoverUrl(work.id, work.hasCover);
  const first = work.files[0];
  const formats = Array.from(new Set(work.files.map((f) => f.format))).slice(0, 2);

  return (
    <button
      className="flex flex-col gap-[9px] p-0 text-left"
      onClick={() => first && onOpen(first.id)}
      disabled={!first}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-l-[3px] rounded-r-[5px] bg-paper-raised shadow-1 transition-[transform,box-shadow] duration-150 before:absolute before:inset-y-0 before:left-0 before:z-1 before:w-[9px] before:rounded-l-[3px] before:bg-linear-to-r before:from-black/20 before:to-black/5 before:content-[''] hover:-translate-y-[3px] hover:shadow-2">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="block h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center font-display text-[44px] text-white/90"
            style={{ background: coverColor(work.title) }}
          >
            {work.title.charAt(0)}
          </div>
        )}
      </div>
      <div className="line-clamp-2 font-display text-[14.5px] font-semibold leading-[1.45]">
        {work.title}
      </div>
      <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted">
        {work.lastReadAt && (
          <span className="h-[7px] w-[7px] flex-none rounded-full bg-seal" title="在读" />
        )}
        {work.authors[0] ?? "未知作者"}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted">
        {formats.map((f) => (
          <span key={f} className="rounded-[3px] border border-line px-1.5 py-px">
            {f}
          </span>
        ))}
        {work.files.length > 1 && <span>{work.files.length} 个版本</span>}
      </div>
    </button>
  );
}

export function Library({ works, hidden, onOpen, onImport, onImportDir }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "title">("recent");

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? works.filter(
          (w) =>
            w.title.toLowerCase().includes(q) || w.authors.some((a) => a.toLowerCase().includes(q)),
        )
      : works;
    return [...filtered].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title, "zh");
      const ta = a.lastReadAt ?? 0;
      const tb = b.lastReadAt ?? 0;
      return tb - ta;
    });
  }, [works, query, sort]);

  const continuing = useMemo(
    () =>
      works
        .filter((w) => w.lastReadAt)
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0],
    [works],
  );
  const continuingCover = useCoverUrl(continuing?.id ?? "", continuing?.hasCover ?? false);

  if (hidden) return null;

  return (
    <div className="flex-1 overflow-auto px-9 pb-12 pt-7">
      <div className="mb-[18px] flex items-baseline gap-3.5">
        <h2 className="m-0 font-display text-2xl font-semibold">书架</h2>
        <span className="text-[13px] text-muted">{works.length} 种藏书</span>
        <div className="ml-auto flex items-center gap-2.5">
          <input
            type="search"
            className="input w-52"
            placeholder="搜索书名或作者"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="input"
            value={sort}
            onChange={(e) => setSort(e.target.value as "recent" | "title")}
          >
            <option value="recent">最近阅读</option>
            <option value="title">书名</option>
          </select>
          <button className="btn" onClick={onImportDir}>
            导入文件夹
          </button>
          <button className="btn btn-primary" onClick={onImport}>
            导入书籍
          </button>
        </div>
      </div>

      {continuing && continuing.files[0] && (
        <div className="mb-[26px] flex items-center gap-4 rounded-lg border border-line bg-paper-raised py-3 pl-3 pr-[18px] shadow-1">
          {continuingCover ? (
            <img
              src={continuingCover}
              alt=""
              className="h-[70px] w-[52px] flex-none rounded-[3px] object-cover shadow-1"
            />
          ) : (
            <div
              className="flex h-[70px] w-[52px] flex-none items-center justify-center rounded-[3px] font-display text-2xl text-white"
              style={{ background: coverColor(continuing.title) }}
            >
              {continuing.title.charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-xs text-muted">继续阅读</div>
            <div className="truncate font-display text-[17px] font-semibold">
              {continuing.title}
            </div>
            <div className="mt-1 text-xs text-muted">{relTime(continuing.lastReadAt)}读过</div>
          </div>
          <button className="btn btn-primary" onClick={() => onOpen(continuing.files[0].id)}>
            继续
          </button>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="flex h-full min-h-80 flex-col items-center justify-center gap-2.5 text-muted">
          <div className="mb-2 flex h-[84px] w-[84px] items-center justify-center rounded-[18px] border-[1.5px] border-line font-display text-[42px]">
            书
          </div>
          <div className="font-display text-[17px] text-fg">
            {query ? "没有匹配的书" : "书架还是空的"}
          </div>
          <div className="text-[13px]">
            {query ? "换个关键词试试" : "把书籍文件拖进窗口，或点「导入书籍」"}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-6 gap-y-[30px]">
          {sorted.map((w) => (
            <BookItem key={w.id} work={w} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
