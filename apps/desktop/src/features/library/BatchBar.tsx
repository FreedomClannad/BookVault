/**
 * 批量整理栏（包 B-3）：底部浮动，作用于当前筛选/搜索结果集。
 * 改分类即时应用；删除是敏感操作，先弹确认模态（硬规则 §3）——
 * 模态里写明删除范围（书库记录 + 受管副本）与不动的部分（原始文件）。
 * 模态的开关状态由父层持有：Esc 语义（先关模态、再退整理）统一在那里处理。
 */

import { CategoryMenu } from "./CategoryMenu";

interface Props {
  /** 整理模式下的候选集（已应用筛选/搜索），「全选」作用于它 */
  poolSize: number;
  selectedSize: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onApplyCategory: (category: string) => void;
  onDelete: () => void;
  onDone: () => void;
  deleting: boolean;
  confirming: boolean;
  onConfirmingChange: (v: boolean) => void;
}

export function BatchBar({
  poolSize,
  selectedSize,
  onSelectAll,
  onClearSelection,
  onApplyCategory,
  onDelete,
  onDone,
  deleting,
  confirming,
  onConfirmingChange,
}: Props) {
  return (
    <>
      <div className="fixed bottom-7 left-1/2 z-40 -translate-x-1/2 rounded-full bg-chrome-deep/95 px-4 py-2 text-chrome-fg shadow-2 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px]">
            已选 <b>{selectedSize}</b> 本{selectedSize < poolSize ? ` / ${poolSize}` : ""}
          </span>
          <button
            type="button"
            className="flex h-8 cursor-pointer items-center rounded-full px-2.5 text-[13px] text-chrome-fg/85 transition-colors hover:bg-white/10 hover:text-white"
            onClick={selectedSize === poolSize ? onClearSelection : onSelectAll}
          >
            {selectedSize === poolSize ? "取消全选" : "全选"}
          </button>
          <span className="h-5 w-px bg-white/15" aria-hidden="true" />
          <CategoryMenu
            value={null}
            label="改分类"
            buttonClassName="flex h-8 cursor-pointer items-center rounded-full px-2.5 text-[13px] text-chrome-fg/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-35"
            onPick={onApplyCategory}
            up
          />
          <button
            type="button"
            className="flex h-8 cursor-pointer items-center rounded-full px-2.5 text-[13px] text-[#ff9d9d] transition-colors hover:bg-white/10 hover:text-[#ffb8b8] disabled:cursor-default disabled:opacity-35"
            disabled={selectedSize === 0 || deleting}
            onClick={() => onConfirmingChange(true)}
          >
            删除
          </button>
          <span className="h-5 w-px bg-white/15" aria-hidden="true" />
          <button
            type="button"
            className="flex h-8 cursor-pointer items-center rounded-full px-2.5 text-[13px] text-chrome-fg/85 transition-colors hover:bg-white/10 hover:text-white"
            onClick={onDone}
          >
            完成
          </button>
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="确认删除"
            className="w-full max-w-sm rounded-xl bg-paper-raised p-5 shadow-2"
          >
            <div className="mb-2 font-display text-[16px] font-semibold text-fg">
              删除 {selectedSize} 本书？
            </div>
            <p className="mb-1 text-[13px] leading-relaxed text-muted">
              将删除书库记录与本地受管副本（含封面），阅读进度一并清除，此操作不可恢复。
            </p>
            <p className="mb-4 text-[13px] leading-relaxed text-muted">
              导入时的原始文件不会被删除；已上传到 NAS 的内容不受影响。
            </p>
            <div className="flex justify-end gap-2.5">
              <button className="btn" onClick={() => onConfirmingChange(false)} disabled={deleting}>
                取消
              </button>
              <button
                className="btn btn-danger"
                disabled={deleting}
                onClick={() => {
                  onConfirmingChange(false);
                  onDelete();
                }}
              >
                {deleting ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
