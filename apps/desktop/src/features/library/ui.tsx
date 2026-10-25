/**
 * 书架工具栏的统一小组件：弹出层（Popover）与选项芯片（ChipGroup）。
 * 替代浏览器原生 <select>（原生下拉无法定制度、与主题不搭），
 * 也供「导入」菜单复用。弹层在外点点击 / Esc 时关闭。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

interface PopoverProps {
  label: string;
  icon?: ReactNode;
  /** 角标数字（如生效筛选数）；0 不显示 */
  badge?: number;
  /** 激活态（按钮高亮） */
  active?: boolean;
  /** 主按钮样式（导入等主动作） */
  primary?: boolean;
  panelClassName?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}

const POPOVER_BTN = "btn gap-1.5 px-2.5 py-[7px] text-[13px]";

export function Popover({
  label,
  icon,
  badge,
  active,
  primary,
  panelClassName = "w-72",
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={`${POPOVER_BTN} ${primary ? "btn-primary" : ""} ${active && !primary ? "border-accent text-accent" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
        {badge ? (
          <span
            className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none ${
              primary ? "bg-white/25 text-white" : "bg-accent text-[#f4f6f8]"
            }`}
          >
            {badge}
          </span>
        ) : null}
      </button>
      {open && (
        <div
          className={`absolute right-0 top-10 z-40 rounded-xl border border-line bg-paper-raised p-3 shadow-2 ${panelClassName}`}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

/** 一组单选芯片：选中项高亮，点选即回调 */
export function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: { v: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={o.v === value}
          className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors ${
            o.v === value
              ? "border-accent bg-accent-weak font-medium text-accent-strong"
              : "border-line text-muted hover:border-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 弹层里的一个分节（小标题 + 内容） */
export function PopoverSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted">{label}</div>
      {children}
    </div>
  );
}

/** 弹层里的菜单项（整行可点，如导入的两个入口） */
export function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-[13px] text-fg transition-colors hover:bg-paper"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 删除确认模态（批量整理与单本删除共用）：写明删除范围与不动的部分 */
export function DeleteConfirmDialog({
  title,
  deleting,
  onCancel,
  onConfirm,
}: {
  title: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="确认删除"
        className="w-full max-w-sm rounded-xl bg-paper-raised p-5 shadow-2"
      >
        <div className="mb-2 font-display text-[16px] font-semibold text-fg">{title}</div>
        <p className="mb-1 text-[13px] leading-relaxed text-muted">
          将删除书库记录与本地受管副本（含封面），阅读进度一并清除，此操作不可恢复。
        </p>
        <p className="mb-4 text-[13px] leading-relaxed text-muted">
          导入时的原始文件不会被删除；已上传到 NAS 的内容不受影响。
        </p>
        <div className="flex justify-end gap-2.5">
          <button className="btn" onClick={onCancel} disabled={deleting}>
            取消
          </button>
          <button className="btn btn-danger" disabled={deleting} onClick={onConfirm}>
            {deleting ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
