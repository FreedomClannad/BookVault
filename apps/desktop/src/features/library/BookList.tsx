/**
 * 书籍模块网格（包 B-1「列表」形态）：封面朝前的平铺模块，像书籍正常陈列。
 * 模块 = 封面（真实封面，缺失用哈希色 + 书名占位）+ 书名/作者行 +
 * 悬停操作（改分类 / 换封面 / 删除）。批量整理时整卡点击变为勾选（角标），
 * 悬停操作隐藏。auto-fill 网格随窗口宽度自适应列数。
 */

import { useState } from "react";
import { api, relTime, type WorkRow } from "../../app/api";
import { CATEGORIES, coverHashColor, FORMAT_LABELS } from "./categories";
import { useCoverUrl } from "./useCoverUrl";

interface CardProps {
  work: WorkRow;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onCoverSaved: () => void;
  onCategoryChange: (category: string) => void;
  onDelete: () => void;
  onToast: (msg: string) => void;
}

function BookCard({
  work,
  selecting,
  selected,
  onToggleSelect,
  onOpen,
  onCoverSaved,
  onCategoryChange,
  onDelete,
  onToast,
}: CardProps) {
  const coverUrl = useCoverUrl(work.id, work.hasCover);
  const [menuOpen, setMenuOpen] = useState(false);
  const formats = Array.from(new Set(work.files.map((f) => f.format)));

  const changeCover = async () => {
    const file = work.files[0];
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
    <div className="group relative" role="listitem">
      {/* 封面模块 */}
      <button
        type="button"
        className={`relative block w-full cursor-pointer overflow-hidden rounded-[6px] border transition-shadow ${
          selected ? "border-seal shadow-[0_0_0_2px_var(--color-seal)]" : "border-line shadow-1"
        }`}
        style={{ aspectRatio: "118 / 166" }}
        onClick={selecting ? onToggleSelect : onOpen}
        title={selecting ? `选中 ${work.title}` : `阅读 ${work.title}`}
        aria-pressed={selecting ? selected : undefined}
        aria-label={selecting ? `选中 ${work.title}` : `阅读 ${work.title}`}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center p-2.5 text-center"
            style={{ background: coverHashColor(work.id) }}
          >
            <span className="font-display text-[15px] leading-relaxed text-white/92">
              {work.title.slice(0, 14)}
            </span>
          </span>
        )}
        {/* 格式角标 */}
        <span className="absolute bottom-1.5 left-1.5 flex gap-1">
          {formats.slice(0, 2).map((f) => (
            <span
              key={f}
              className="rounded bg-black/45 px-1 py-0.5 text-[9px] leading-none text-white/90"
            >
              {FORMAT_LABELS[f] ?? f.toUpperCase()}
            </span>
          ))}
        </span>
        {/* 批量勾选角标 */}
        {selecting && (
          <span
            className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] text-[11px] leading-none ${
              selected
                ? "border-seal bg-seal text-white"
                : "border-white/85 bg-black/30 text-transparent"
            }`}
            aria-hidden="true"
          >
            ✓
          </span>
        )}
        {/* 悬停操作：改分类 / 换封面 / 删除（整理模式下隐藏） */}
        {!selecting && (
          <span className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex">
            <span
              role="button"
              tabIndex={-1}
              className="cursor-pointer rounded bg-black/55 px-1.5 py-1 text-[10px] leading-none text-white/90 hover:bg-black/75"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              aria-expanded={menuOpen}
              title="改分类"
            >
              分类
            </span>
            <span
              role="button"
              tabIndex={-1}
              className="cursor-pointer rounded bg-black/55 px-1.5 py-1 text-[10px] leading-none text-white/90 hover:bg-black/75"
              onClick={(e) => {
                e.stopPropagation();
                void changeCover();
              }}
              title="设为封面"
            >
              封面
            </span>
            <span
              role="button"
              tabIndex={-1}
              className="cursor-pointer rounded bg-black/55 px-1.5 py-1 text-[10px] leading-none text-[#ffb3b3] hover:bg-black/75"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="删除本书"
            >
              删除
            </span>
          </span>
        )}
      </button>

      {/* 分类菜单 */}
      {menuOpen && (
        <div className="absolute right-2 top-9 z-30 min-w-24 overflow-hidden rounded-lg border border-line bg-paper-raised py-1 shadow-2">
          <button
            type="button"
            className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-paper ${work.category === "" ? "font-medium text-accent-strong" : "text-fg"}`}
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
              className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-paper ${work.category === c ? "font-medium text-accent-strong" : "text-fg"}`}
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

      {/* 书名 + 作者/进度 */}
      <div className="mt-2 px-0.5">
        <div className="truncate text-[13px] font-medium text-fg" title={work.title}>
          {work.title}
        </div>
        <div className="truncate text-[11px] text-muted">
          {work.authors.length ? work.authors[0] : "佚名"}
          <span className="mx-1">·</span>
          {work.lastReadAt ? relTime(work.lastReadAt) : "未读"}
        </div>
      </div>
    </div>
  );
}

interface Props {
  works: WorkRow[];
  selecting: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (workId: string) => void;
  onOpen: (fileId: string) => void;
  onCoverSaved: () => void;
  onCategoryChange: (work: WorkRow, category: string) => void;
  onDelete: (work: WorkRow) => void;
  onToast: (msg: string) => void;
}

export function BookList({
  works,
  selecting,
  selectedIds,
  onToggleSelect,
  onOpen,
  onCoverSaved,
  onCategoryChange,
  onDelete,
  onToast,
}: Props) {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-5 gap-y-7 px-9 pb-12"
      role="list"
      aria-label="书籍列表"
    >
      {works.map((w) => (
        <BookCard
          key={w.id}
          work={w}
          selecting={selecting}
          selected={selectedIds.has(w.id)}
          onToggleSelect={() => onToggleSelect(w.id)}
          onOpen={() => w.files[0] && onOpen(w.files[0].id)}
          onCoverSaved={onCoverSaved}
          onCategoryChange={(c) => onCategoryChange(w, c)}
          onDelete={() => onDelete(w)}
          onToast={onToast}
        />
      ))}
    </div>
  );
}
