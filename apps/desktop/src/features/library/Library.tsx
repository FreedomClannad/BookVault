/**
 * 书架视图（包 B）：立体书架 / 封面模块网格双形态（选择记忆到 localStorage）。
 * 工具栏单行收敛：搜索、筛选+排序弹层（统一自绘组件，替代原生 select）、
 * 视图切换、整理、导入菜单、设置入口。
 * 立体模式为 Wenku8「发现」页同款陈列（BookCarousel），作用于当前筛选/搜索
 * 结果集；批量整理时统一切模块网格多选。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type WorkRow } from "../../app/api";
import { BatchBar } from "./BatchBar";
import { BookCarousel } from "./BookCarousel";
import { BookList } from "./BookList";
import { CATEGORIES, FORMAT_LABELS } from "./categories";
import { ChipGroup, MenuItem, Popover, PopoverSection } from "./ui";

interface Props {
  works: WorkRow[];
  /** NAS 连接状态（顶栏右侧指示灯） */
  nasOn: boolean;
  onOpen: (fileId: string) => void;
  onImport: () => void;
  onImportDir: () => void;
  /** 打开设置页 */
  onOpenSettings: () => void;
  /** 分类/封面/删除落库后由 App 刷新书库（hasCover、分组都要重读） */
  onDataChanged: () => void;
}

type ViewMode = "shelf" | "list";
type StatusFilter = "all" | "reading" | "unread";

interface Filters {
  /** null=全部；''=未分类 */
  category: string | null;
  status: StatusFilter;
  format: string | null;
}

const NO_FILTERS: Filters = { category: null, status: "all", format: null };

function loadViewMode(): ViewMode {
  return localStorage.getItem("library.viewMode") === "list" ? "list" : "shelf";
}

/** 三维筛选叠加（AND）；对立体书架、列表与搜索一视同仁，先筛后陈列 */
function applyFilters(works: WorkRow[], f: Filters): WorkRow[] {
  return works.filter((w) => {
    if (f.category !== null && w.category !== f.category) return false;
    if (f.status === "reading" && !w.lastReadAt) return false;
    if (f.status === "unread" && w.lastReadAt) return false;
    if (f.format !== null && !w.files.some((file) => file.format === f.format)) return false;
    return true;
  });
}

export function Library({
  works,
  nasOn,
  onOpen,
  onImport,
  onImportDir,
  onOpenSettings,
  onDataChanged,
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [toast, setToast] = useState<string | null>(null);

  // 批量整理
  const [batchOn, setBatchOn] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const exitBatch = useCallback(() => {
    setBatchOn(false);
    setSelected(new Set());
    setConfirmingDelete(false);
  }, []);

  // Esc：先关删除确认模态，再退整理模式（ui-style §6 所有操作可键盘完成）
  useEffect(() => {
    if (!batchOn) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmingDelete) setConfirmingDelete(false);
      else exitBatch();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [batchOn, confirmingDelete, exitBatch]);

  const switchViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("library.viewMode", mode);
  };

  const sortedWorks = useMemo(() => {
    const arr = [...works];
    if (sort === "title") arr.sort((a, b) => a.title.localeCompare(b.title, "zh"));
    return arr;
  }, [works, sort]);

  const filteredWorks = useMemo(() => applyFilters(sortedWorks, filters), [sortedWorks, filters]);
  const hasActiveFilters =
    filters.category !== null || filters.status !== "all" || filters.format !== null;

  const searching = query.trim().length > 0;
  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return filteredWorks.filter(
      (w) =>
        w.title.toLowerCase().includes(q) || w.authors.some((a) => a.toLowerCase().includes(q)),
    );
  }, [filteredWorks, query]);

  /** 当前可见书列：搜索时为命中集，否则为筛选后的全部（三种形态共用） */
  const pool = searching ? searchHits : filteredWorks;

  /** 书库中实际存在的格式（筛选下拉只给有意义的选项） */
  const presentFormats = useMemo(
    () => Array.from(new Set(works.flatMap((w) => w.files.map((f) => f.format)))).sort(),
    [works],
  );

  // 整理候选集：与当前可见集合一致（搜索时为命中集，否则为筛选后的全部）
  const batchPool = searching ? searchHits : filteredWorks;

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

  const toggleSelect = (workId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(workId)) next.delete(workId);
      else next.add(workId);
      return next;
    });
  };

  const applyBatchCategory = async (category: string) => {
    if (selected.size === 0) return;
    const ids = [...selected];
    let failed = 0;
    for (const id of ids) {
      try {
        await api.setWorkCategory(id, category);
      } catch {
        failed += 1;
      }
    }
    onDataChanged();
    setSelected(new Set());
    setToast(
      failed > 0
        ? `已改 ${ids.length - failed} 本分类，${failed} 本失败`
        : `已把 ${ids.length} 本移到「${category || "未分类"}」`,
    );
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    const ids = [...selected];
    setDeleting(true);
    try {
      const removed = await api.deleteWorks(ids);
      onDataChanged();
      setSelected(new Set());
      setBatchOn(false);
      setToast(`已删除 ${removed} 本书`);
    } catch (e) {
      setToast(`删除失败: ${String(e)}`);
    } finally {
      setDeleting(false);
    }
  };

  const listNode = (selecting: boolean) => (
    <BookList
      works={pool}
      selecting={selecting}
      selectedIds={selected}
      onToggleSelect={toggleSelect}
      onOpen={onOpen}
      onCoverSaved={() => coverSaved("封面已生成")}
      onCategoryChange={(w, c) => void setCategory(w, c)}
      onToast={setToast}
    />
  );

  const filterCount =
    (filters.category !== null ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.format !== null ? 1 : 0);

  const setCategoryFilter = (v: string) =>
    setFilters((f) => ({
      ...f,
      category: v === "__all" ? null : v === "__none" ? "" : v,
    }));

  const GearIcon = () => (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );

  const FilterIcon = () => (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 6h16M7 12h10M10 18h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 单一顶栏（合并原顶栏与工具栏）：品牌 + 藏书数 + 全部操作 + NAS 状态。
          sticky：内容滚动时操作常驻。 */}
      <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-2.5">
        <div
          className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[6px] bg-seal font-display text-sm text-[#f6ece8] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]"
          aria-hidden="true"
        >
          书
        </div>
        <span className="font-display text-[15px] font-semibold text-fg">BookVault</span>
        <span className="text-xs text-muted">
          {hasActiveFilters
            ? `${filteredWorks.length} / ${works.length} 种藏书`
            : `${works.length} 种藏书`}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="input w-44"
            placeholder="搜索书名或作者"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <Popover label="筛选" icon={<FilterIcon />} badge={filterCount} active={filterCount > 0}>
            <PopoverSection label="分类">
              <ChipGroup
                options={[
                  { v: "__all", label: "全部" },
                  { v: "__none", label: "未分类" },
                  ...CATEGORIES.map((c) => ({ v: c, label: c })),
                ]}
                value={
                  filters.category === null
                    ? "__all"
                    : filters.category === ""
                      ? "__none"
                      : filters.category
                }
                onChange={setCategoryFilter}
              />
            </PopoverSection>
            <PopoverSection label="阅读状态">
              <ChipGroup
                options={[
                  { v: "all", label: "全部" },
                  { v: "reading", label: "在读" },
                  { v: "unread", label: "未读" },
                ]}
                value={filters.status}
                onChange={(v) => setFilters((f) => ({ ...f, status: v as StatusFilter }))}
              />
            </PopoverSection>
            <PopoverSection label="格式">
              <ChipGroup
                options={[
                  { v: "__all", label: "全部" },
                  ...presentFormats.map((fmt) => ({
                    v: fmt,
                    label: FORMAT_LABELS[fmt] ?? fmt.toUpperCase(),
                  })),
                ]}
                value={filters.format ?? "__all"}
                onChange={(v) => setFilters((f) => ({ ...f, format: v === "__all" ? null : v }))}
              />
            </PopoverSection>
            <PopoverSection label="排序">
              <ChipGroup
                options={[
                  { v: "recent", label: "最近阅读" },
                  { v: "title", label: "书名" },
                ]}
                value={sort}
                onChange={(v) => setSort(v as "recent" | "title")}
              />
            </PopoverSection>
          </Popover>

          <div
            className="flex overflow-hidden rounded-md border border-line"
            role="group"
            aria-label="视图模式"
          >
            {(["shelf", "list"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`px-2.5 py-[7px] text-[13px] transition-colors ${viewMode === m ? "bg-fg text-paper" : "text-muted hover:bg-paper-raised"}`}
                aria-pressed={viewMode === m}
                onClick={() => switchViewMode(m)}
              >
                {m === "shelf" ? "立体" : "列表"}
              </button>
            ))}
          </div>

          <button
            className={`btn px-2.5 py-[7px] text-[13px] ${batchOn ? "btn-primary" : ""}`}
            onClick={() => (batchOn ? exitBatch() : setBatchOn(true))}
            disabled={works.length === 0}
          >
            {batchOn ? "完成整理" : "整理"}
          </button>

          <Popover label="导入" primary panelClassName="w-48">
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    onImport();
                  }}
                >
                  导入书籍文件…
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    onImportDir();
                  }}
                >
                  导入文件夹…
                </MenuItem>
              </>
            )}
          </Popover>

          <button
            className="btn px-2.5 py-[7px] text-[13px]"
            title="设置"
            aria-label="设置"
            onClick={onOpenSettings}
          >
            <GearIcon />
            设置
          </button>

          <span className="h-5 w-px flex-none bg-line" aria-hidden="true" />
          <div
            title={nasOn ? "NAS 已连接" : "NAS 未连接"}
            className={`flex items-center gap-1.5 text-xs ${nasOn ? "text-fg" : "text-muted"}`}
          >
            <span
              className={`h-[7px] w-[7px] rounded-full ${nasOn ? "bg-[#58a97a]" : "bg-line"}`}
            />
            <span className="hidden lg:inline">{nasOn ? "NAS 已连接" : "NAS 未连接"}</span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {works.length === 0 ? (
          <EmptyState query="" />
        ) : pool.length === 0 ? (
          filteredWorks.length === 0 ? (
            <EmptyState query={query} onClearFilters={() => setFilters(NO_FILTERS)} filtered />
          ) : (
            <EmptyState
              query={query}
              onClearFilters={hasActiveFilters ? () => setFilters(NO_FILTERS) : undefined}
            />
          )
        ) : batchOn ? (
          // 整理模式统一用模块网格多选（两种视图形态一致）
          listNode(true)
        ) : viewMode === "list" ? (
          listNode(false)
        ) : (
          <BookCarousel
            works={pool}
            onOpen={onOpen}
            onCoverSaved={() => coverSaved("封面已生成")}
          />
        )}

        {batchOn && (
          <BatchBar
            poolSize={batchPool.length}
            selectedSize={selected.size}
            onSelectAll={() => setSelected(new Set(batchPool.map((w) => w.id)))}
            onClearSelection={() => setSelected(new Set())}
            onApplyCategory={(c) => void applyBatchCategory(c)}
            onDelete={() => void deleteSelected()}
            onDone={exitBatch}
            deleting={deleting}
            confirming={confirmingDelete}
            onConfirmingChange={setConfirmingDelete}
          />
        )}

        {toast && (
          <div className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-chrome-deep px-5 py-2.5 text-sm text-chrome-fg shadow-2">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  query,
  filtered,
  onClearFilters,
}: {
  query: string;
  /** 筛选/搜索无命中（书库非空） */
  filtered?: boolean;
  onClearFilters?: () => void;
}) {
  return (
    <div className="flex h-full min-h-80 flex-col items-center justify-center gap-2.5 text-muted">
      <div className="mb-2 flex h-[84px] w-[84px] items-center justify-center rounded-[18px] border-[1.5px] border-line font-display text-[42px]">
        书
      </div>
      <div className="font-display text-[17px] text-fg">
        {filtered || query ? "没有匹配的书" : "书架还是空的"}
      </div>
      <div className="text-[13px]">
        {filtered || query ? "换个关键词或筛选条件试试" : "把书籍文件拖进窗口，或点「导入书籍」"}
      </div>
      {(filtered || query) && onClearFilters && (
        <button className="btn mt-1.5" onClick={onClearFilters}>
          清除筛选
        </button>
      )}
    </div>
  );
}
