/**
 * 分类下拉菜单：未分类 + 固定分类词表（与 Rust 侧 library::CATEGORIES 一致）。
 * 选中即回调并收起；「当前项」高亮。列表行与批量整理栏共用。
 */

import { useState } from "react";
import { CATEGORIES } from "./categories";

interface Props {
  /** 当前分类（''=未分类）；null 表示批量场景下无单一当前值 */
  value: string | null;
  onPick: (category: string) => void;
  label: string;
  buttonClassName?: string;
  /** 菜单向上弹出（底部批量栏场景） */
  up?: boolean;
}

export function CategoryMenu({ value, onPick, label, buttonClassName = "btn", up }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        className={buttonClassName}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div
          className={`absolute left-0 z-40 ${up ? "bottom-9" : "top-9"} min-w-24 overflow-hidden rounded-lg border border-line bg-paper-raised py-1 shadow-2`}
          role="menu"
          aria-label="选择分类"
        >
          <button
            type="button"
            role="menuitem"
            className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-paper ${value === "" ? "font-medium text-accent-strong" : "text-fg"}`}
            onClick={() => {
              onPick("");
              setOpen(false);
            }}
          >
            未分类
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitem"
              className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-paper ${value === c ? "font-medium text-accent-strong" : "text-fg"}`}
              onClick={() => {
                onPick(c);
                setOpen(false);
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
