/**
 * 应用根组件：墨色顶栏 + 书架主区；阅读/设置为全屏接管（沉浸式）。
 * 设置从顶栏齿轮进入；书架为 3D 书柜（Library），支持分类与封面管理。
 */

import { useCallback, useEffect, useState } from "react";
import { api, type WorkRow } from "./app/api";
import { Library } from "./features/library/Library";
import { Reader } from "./features/reader/Reader";
import { Settings } from "./features/settings/Settings";
import "./app/app.css";

type View = "library" | "reader" | "settings";

function GearIcon() {
  return (
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

  // 首次进入与从阅读/设置返回书架时刷新（导入、分类、封面、拉取后的变化都走这里）
  useEffect(() => {
    if (view === "library") void refresh();
  }, [view, refresh]);

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

  const toastEl = toast && (
    <div className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-chrome-deep px-5 py-2.5 text-sm text-chrome-fg shadow-2">
      {toast}
    </div>
  );

  const exitReader = useCallback(() => {
    setReadingFileId(null);
    setView("library");
  }, []);

  // 阅读中：全屏接管，顶栏不渲染（沉浸式）
  if (view === "reader" && readingFileId !== null) {
    return (
      <div className="h-full min-w-[720px]" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        <Reader fileId={readingFileId} onExit={exitReader} />
        {toastEl}
      </div>
    );
  }

  // 设置：全屏页面，带返回按钮
  if (view === "settings") {
    return (
      <div className="h-full min-w-[720px]">
        <Settings onBack={() => setView("library")} />
        {toastEl}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-w-[720px] flex-col"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <header className="flex h-12 flex-none items-center gap-3 bg-linear-to-r from-chrome to-chrome-deep px-4 text-chrome-fg">
        <div
          className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[7px] bg-seal font-display text-base text-[#f6ece8] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.22)]"
          aria-hidden="true"
        >
          书
        </div>
        <div className="font-display text-[15px] tracking-wide text-[#e8eaee]">BookVault</div>
        <span className="hidden text-[11px] text-chrome-muted md:inline">私人藏书之所</span>

        <span className="ml-auto" />
        <div
          title={nasOn ? "NAS 已连接" : "NAS 未连接"}
          className={`flex items-center gap-1.5 text-xs ${nasOn ? "text-chrome-fg" : "text-chrome-muted"}`}
        >
          <span
            className={`h-[7px] w-[7px] rounded-full ${nasOn ? "bg-[#58a97a]" : "bg-chrome-muted"}`}
          />
          <span className="hidden sm:inline">{nasOn ? "NAS 已连接" : "NAS 未连接"}</span>
        </div>
        <span className="h-5 w-px bg-white/10" aria-hidden="true" />
        <button
          title="设置"
          aria-label="设置"
          onClick={() => setView("settings")}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-chrome-muted transition-colors hover:bg-white/10 hover:text-white"
        >
          <GearIcon />
        </button>
      </header>

      <main className="flex min-w-0 flex-1 flex-col bg-paper">
        <Library
          works={works}
          onOpen={(fileId) => {
            setReadingFileId(fileId);
            setView("reader");
          }}
          onImport={async () => importPaths(await api.pickFiles())}
          onImportDir={async () => {
            const dir = await api.pickDirectory();
            if (dir) void importPaths([dir]);
          }}
          onDataChanged={() => void refresh()}
        />
      </main>

      {toastEl}
    </div>
  );
}
