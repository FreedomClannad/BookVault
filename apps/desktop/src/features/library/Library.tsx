/**
 * 书架视图：书柜分区（在读柜 + 分类柜）+ 3D 书横列（Book3D）。
 * 搜索时退化为平铺网格便于扫读；每本书可改分类 / 设封面（悬停操作）。
 */

import { useEffect, useMemo, useState } from "react";
import { api, type WorkRow } from "../../app/api";
import { Book3D } from "./Book3D";
import { CATEGORIES } from "./categories";

interface Props {
  works: WorkRow[];
  onOpen: (fileId: string) => void;
  onImport: () => void;
  onImportDir: () => void;
  /** 分类/封面落库后由 App 刷新书库（hasCover、分组都要重读） */
  onDataChanged: () => void;
}

/** 书柜分组：在读（最近读过的前 12 本，仅作快捷入口，可在分类柜重复出现）→ 固定顺序分类 → 未分类 */
function groupShelves(works: WorkRow[], query: string) {
  const q = query.trim().toLowerCase();
  const match = (w: WorkRow) =>
    !q || w.title.toLowerCase().includes(q) || w.authors.some((a) => a.toLowerCase().includes(q));

  const searching = q.length > 0;
  const readShelf = searching
    ? []
    : works
        .filter((w) => w.lastReadAt)
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
        .slice(0, 12);

  const shelves: { name: string; items: WorkRow[] }[] = [];
  if (readShelf.length > 0) shelves.push({ name: "在读", items: readShelf });

  const remaining = works.filter((w) => match(w) && !readShelf.includes(w));
  const uncategorized: WorkRow[] = [];
  for (const cat of CATEGORIES) {
    const items = remaining.filter((w) => w.category === cat);
    if (items.length > 0) shelves.push({ name: cat, items });
  }
  for (const w of remaining) {
    if (w.category === "" || !CATEGORIES.includes(w.category)) uncategorized.push(w);
  }
  if (uncategorized.length > 0) shelves.push({ name: "未分类", items: uncategorized });
  return { searching, shelves };
}

export function Library({ works, onOpen, onImport, onImportDir, onDataChanged }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const sortedWorks = useMemo(() => {
    const arr = [...works];
    if (sort === "title") arr.sort((a, b) => a.title.localeCompare(b.title, "zh"));
    return arr;
  }, [works, sort]);

  const { searching, shelves } = useMemo(
    () => groupShelves(sortedWorks, query),
    [sortedWorks, query],
  );
  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return sortedWorks.filter(
      (w) =>
        w.title.toLowerCase().includes(q) || w.authors.some((a) => a.toLowerCase().includes(q)),
    );
  }, [sortedWorks, query]);

  const setCategory = async (work: WorkRow, category: string) => {
    try {
      await api.setWorkCategory(work.id, category);
      onDataChanged();
    } catch (e) {
      setToast(`改分类失败: ${String(e)}`);
    }
  };

  const coverSaved = (msg: string) => {
    setToast(msg);
    onDataChanged();
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex items-baseline gap-3.5 px-9 pb-4 pt-6">
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
            aria-label="排序"
          >
            <option value="recent">柜内按最近阅读</option>
            <option value="title">柜内按书名</option>
          </select>
          <button className="btn" onClick={onImportDir}>
            导入文件夹
          </button>
          <button className="btn btn-primary" onClick={onImport}>
            导入书籍
          </button>
        </div>
      </div>

      {searching ? (
        searchHits.length === 0 ? (
          <EmptyState query={query} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-6 gap-y-8 px-9 pb-12">
            {searchHits.map((w) => (
              <Book3D
                key={w.id}
                work={w}
                onOpen={() => w.files[0] && onOpen(w.files[0].id)}
                onCoverSaved={() => coverSaved("封面已生成")}
                onCategoryChange={(c) => void setCategory(w, c)}
                onToast={setToast}
              />
            ))}
          </div>
        )
      ) : shelves.length === 0 ? (
        <EmptyState query={query} />
      ) : (
        shelves.map((shelf) => (
          <section key={shelf.name} className="mb-3">
            <div className="flex items-baseline gap-2.5 px-9">
              <h3 className="m-0 font-display text-[15px] font-semibold">{shelf.name}</h3>
              <span className="text-xs text-muted">{shelf.items.length} 本</span>
            </div>
            <div className="bookshelf" role="list" aria-label={`${shelf.name}书柜`}>
              {shelf.items.map((w) => (
                <div key={w.id} role="listitem">
                  <Book3D
                    work={w}
                    onOpen={() => w.files[0] && onOpen(w.files[0].id)}
                    onCoverSaved={() => coverSaved("封面已生成")}
                    onCategoryChange={(c) => void setCategory(w, c)}
                    onToast={setToast}
                  />
                </div>
              ))}
            </div>
            <div className="shelf-board" aria-hidden="true" />
          </section>
        ))
      )}

      {toast && (
        <div className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-chrome-deep px-5 py-2.5 text-sm text-chrome-fg shadow-2">
          {toast}
        </div>
      )}
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
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
  );
}
