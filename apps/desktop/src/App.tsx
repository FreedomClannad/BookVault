/**
 * 应用根组件：墨色侧栏壳 + 书架/阅读/设置三视图，窗口级拖拽导入。
 */

import { useCallback, useEffect, useState } from "react";
import { api, type WorkRow } from "./app/api";
import { Library } from "./features/library/Library";
import { Reader } from "./features/reader/Reader";
import { Settings } from "./features/settings/Settings";
import "./app/app.css";

type View = "library" | "reader" | "settings";

function ShelfIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none" aria-hidden="true">
      <path
        d="M4 4h7v16H4zM13 4h7v16h-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M3 20.5h18" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export default function App() {
  const [view, setView] = useState<View>("library");
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [readingFileId, setReadingFileId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nasOn, setNasOn] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setWorks(await api.listWorks());
    } catch (e) {
      setToast(`书库加载失败: ${String(e)}`);
    }
    void api.nasStatus().then((s) => setNasOn(Boolean(s)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const importPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      try {
        const results = await api.importPaths(paths);
        const dup = results.filter((r) => r.duplicate).length;
        setToast(`已导入 ${results.length - dup} 项${dup ? `，跳过重复 ${dup} 项` : ""}`);
        await refresh();
      } catch (e) {
        setToast(`导入失败: ${String(e)}`);
      }
    },
    [refresh],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => (f as File & { path?: string }).path)
        .filter(Boolean) as string[];
      void importPaths(paths);
    },
    [importPaths],
  );

  const reading = view === "reader" && readingFileId;

  return (
    <div
      className="flex h-full min-w-[720px]"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <aside className="flex w-52 flex-none flex-col bg-linear-to-b from-chrome to-chrome-deep px-3.5 pb-4 pt-5 text-chrome-fg">
        <div className="flex items-center gap-3 border-b border-white/10 px-1.5 pb-[18px]">
          <div
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[7px] bg-seal font-display text-xl text-[#f6ece8] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.22)]"
            aria-hidden="true"
          >
            书
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-[17px] tracking-wide text-[#e8eaee]">
              BookVault
            </div>
            <div className="mt-px text-[11px] text-chrome-muted">私人藏书之所</div>
          </div>
        </div>

        <nav className="mt-3.5 flex flex-col gap-0.5">
          <button
            className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-white/[0.06] hover:text-[#eef0f3] ${
              view === "library" || reading
                ? "bg-white/[0.06] text-white shadow-[inset_2px_0_0_var(--color-seal)]"
                : "text-chrome-fg"
            }`}
            onClick={() => setView("library")}
          >
            <ShelfIcon />
            书架
          </button>
          <button
            className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-white/[0.06] hover:text-[#eef0f3] ${
              view === "settings"
                ? "bg-white/[0.06] text-white shadow-[inset_2px_0_0_var(--color-seal)]"
                : "text-chrome-fg"
            }`}
            onClick={() => setView("settings")}
          >
            <GearIcon />
            设置
          </button>
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-white/10 px-1.5 pt-3">
          <div
            className={`flex items-center gap-1.5 text-xs ${nasOn ? "text-chrome-fg" : "text-chrome-muted"}`}
          >
            <span
              className={`h-[7px] w-[7px] rounded-full ${nasOn ? "bg-[#58a97a]" : "bg-chrome-muted"}`}
            />
            {nasOn ? "NAS 已连接" : "NAS 未连接"}
          </div>
          <div className="text-[11px] leading-relaxed text-chrome-muted">
            Cmd/Ctrl+Shift+B 快速隐藏
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-paper">
        {(view === "library" || reading) && (
          <Library
            works={works}
            hidden={Boolean(reading)}
            onOpen={(fileId) => {
              setReadingFileId(fileId);
              setView("reader");
            }}
            onImport={async () => importPaths(await api.pickFiles())}
            onImportDir={async () => {
              const dir = await api.pickDirectory();
              if (dir) void importPaths([dir]);
            }}
          />
        )}

        {reading && (
          <Reader
            fileId={readingFileId}
            onExit={() => {
              setReadingFileId(null);
              setView("library");
              void refresh();
            }}
          />
        )}

        {view === "settings" && <Settings onBack={refresh} />}
      </main>

      {toast && (
        <div className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-chrome-deep px-5 py-2.5 text-sm text-chrome-fg shadow-2">
          {toast}
        </div>
      )}
    </div>
  );
}
