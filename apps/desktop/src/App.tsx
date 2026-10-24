/**
 * 应用根组件：三个视图（书架 / 阅读 / 设置）与拖拽导入。
 * 依赖方向：本层只使用 app/api（分层规则的唯一 IPC 出口）。
 */

import { useCallback, useEffect, useState } from "react";
import { api, type WorkRow } from "./app/api";
import { Library } from "./features/library/Library";
import { Reader } from "./features/reader/Reader";
import { Settings } from "./features/settings/Settings";
import "./app/tokens.css";
import "./shared/ui.css";

type View = "library" | "reader" | "settings";

export default function App() {
  const [view, setView] = useState<View>("library");
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [readingFileId, setReadingFileId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setWorks(await api.listWorks());
    } catch (e) {
      setToast(`书库加载失败: ${String(e)}`);
    }
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
        setToast(`已导入 ${results.length - dup} 项${dup ? `（跳过重复 ${dup} 项）` : ""}`);
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

  return (
    <div className="app" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <header className="topbar">
        <button className={view === "library" ? "primary" : ""} onClick={() => setView("library")}>
          书架
        </button>
        <button
          className={view === "settings" ? "primary" : ""}
          onClick={() => setView("settings")}
        >
          设置
        </button>
        <span className="topbar-hint">Cmd/Ctrl+Shift+B 快速隐藏</span>
      </header>

      {view === "library" && (
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
        />
      )}

      {view === "reader" && readingFileId && (
        <Reader
          fileId={readingFileId}
          onExit={() => {
            setReadingFileId(null);
            setView("library");
            void refresh();
          }}
        />
      )}

      {view === "settings" && <Settings />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
