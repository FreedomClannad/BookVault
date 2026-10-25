/**
 * 应用根组件：墨色顶栏 + 书架主区；阅读/设置为全屏接管（沉浸式）。
 * 设置入口在书架工具栏（齿轮按钮）；顶栏只留品牌与 NAS 状态。
 */

import { useCallback, useEffect, useState } from "react";
import { api, type WorkRow } from "./app/api";
import { Library } from "./features/library/Library";
import { Reader } from "./features/reader/Reader";
import { Settings } from "./features/settings/Settings";
import "./app/app.css";

type View = "library" | "reader" | "settings";

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
        const { imported, failed } = await api.importPaths(paths);
        const dup = imported.filter((r) => r.duplicate).length;
        let msg = `已导入 ${imported.length - dup} 项${dup ? `，跳过重复 ${dup} 项` : ""}`;
        if (failed.length > 0) {
          // 失败详情同时写入了 import_tasks 表；toast 给出第一条便于对症
          const first =
            failed[0].error.length > 60 ? `${failed[0].error.slice(0, 60)}…` : failed[0].error;
          msg += `，失败 ${failed.length} 项（${first}）`;
        }
        setToast(msg);
        await refresh();
      } catch (e) {
        setToast(`导入失败: ${String(e)}`);
      }
    },
    [refresh],
  );

  // 拖拽导入走 Tauri 原生拖放事件：Tauri v2 默认接管 webview 拖放
  // （dragDropEnabled），HTML5 的 dataTransfer.files 在桌面端收不到文件路径
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | null = null;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((ev) => {
          if (ev.payload.type === "drop") void importPaths(ev.payload.paths);
        }),
      )
      .then((un) => {
        unlisten = un;
      });
    return () => {
      unlisten?.();
    };
  }, [importPaths]);

  const toastEl = toast && (
    <div className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-chrome-deep px-5 py-2.5 text-sm text-chrome-fg shadow-2">
      {toast}
    </div>
  );

  const exitReader = useCallback(() => {
    setReadingFileId(null);
    setView("library");
  }, []);

  // 阅读中：全屏接管，顶栏不渲染（沉浸式）；拖拽导入由全局 Tauri 事件覆盖
  if (view === "reader" && readingFileId !== null) {
    return (
      <div className="h-full min-w-[720px]" onDragOver={(e) => e.preventDefault()}>
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
    <div className="flex h-full min-w-[720px] flex-col" onDragOver={(e) => e.preventDefault()}>
      {/* 顶栏与工具栏已合并为 Library 内的单一 sticky 顶栏 */}
      <main className="flex min-w-0 flex-1 flex-col bg-paper">
        <Library
          works={works}
          nasOn={nasOn}
          onOpen={(fileId) => {
            setReadingFileId(fileId);
            setView("reader");
          }}
          onImport={async () => importPaths(await api.pickFiles())}
          onImportDir={async () => {
            const dir = await api.pickDirectory();
            if (dir) void importPaths([dir]);
          }}
          onOpenSettings={() => setView("settings")}
          onDataChanged={() => void refresh()}
        />
      </main>

      {toastEl}
    </div>
  );
}
