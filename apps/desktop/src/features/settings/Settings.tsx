/**
 * 设置视图：NAS 配对 / 推送 / 拉取（M4）+ 隐私能力说明 + 关于。
 */

import { useEffect, useState } from "react";
import { api, type PullReport, type PushReport } from "../../app/api";

interface Props {
  onBack: () => void;
}

export function Settings({ onBack }: Props) {
  const [status, setStatus] = useState<{ url: string; deviceId: string } | null>(null);
  const [url, setUrl] = useState("http://127.0.0.1:8730");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushReport, setPushReport] = useState<PushReport | null>(null);
  const [pullReport, setPullReport] = useState<PullReport | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void api.nasStatus().then((s) => {
      setStatus(s);
      if (s) setUrl(s.url);
    });
  }, []);

  const pair = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const s = await api.nasPair(url, code.trim());
      setStatus(s);
      setMsg(`配对成功，设备 ${s.deviceId.slice(0, 8)} 已登记`);
      onBack();
    } catch (e) {
      setMsg(`配对失败: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const push = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setPushReport(await api.nasPush());
    } catch (e) {
      setMsg(`推送失败: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const pull = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setPullReport(await api.nasPull());
    } catch (e) {
      setMsg(`拉取失败: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[680px] flex-1 overflow-auto px-9 pb-15 pt-7">
      <h3 className="mt-1 mb-1 border-b border-line pb-2 font-display text-lg font-semibold">
        NAS 同步
      </h3>
      <div
        className={`mt-3 flex items-center gap-2 text-[13px] ${status ? "text-fg" : "text-muted"}`}
      >
        <span className={`h-2 w-2 rounded-full ${status ? "bg-[#58a97a]" : "bg-muted"}`} />
        {status
          ? `已连接 ${status.url}`
          : "未连接。NAS 首次启动会在控制台与 data/pairing-code.txt 打印配对码"}
      </div>
      <div className="my-3.5 flex flex-wrap items-center gap-2.5">
        <input
          className="input min-w-[180px] max-w-[320px] flex-1"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://nas-ip:8730"
        />
        <input
          className="input w-32"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="配对码"
        />
        <button className="btn btn-primary" disabled={busy} onClick={pair}>
          配对
        </button>
      </div>
      <div className="my-3.5 flex flex-wrap items-center gap-2.5">
        <button className="btn" disabled={busy || !status} onClick={push}>
          推送本地书库
        </button>
        <button className="btn" disabled={busy || !status} onClick={pull}>
          从 NAS 拉取
        </button>
      </div>
      {msg && <p className="my-2 text-[13px] leading-relaxed text-muted">{msg}</p>}
      {pushReport && (
        <div className="whitespace-pre-wrap rounded-md border border-line bg-paper-raised p-3.5 text-[13px] leading-relaxed">
          推送完成：作品 {pushReport.works}，上传文件 {pushReport.filesUploaded}，上行进度{" "}
          {pushReport.progressRows}
          {pushReport.filesSkippedDir > 0 &&
            `（图片文件夹 ${pushReport.filesSkippedDir} 项暂不支持上传）`}
        </div>
      )}
      {pullReport && (
        <div className="mt-2.5 whitespace-pre-wrap rounded-md border border-line bg-paper-raised p-3.5 text-[13px] leading-relaxed">
          拉取完成：作品 {pullReport.worksUpserted}，下载文件 {pullReport.filesDownloaded}，应用进度{" "}
          {pullReport.progressApplied}
        </div>
      )}
      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        断网不影响本地阅读：同步失败会保留待推内容，连接恢复后重试即可。
      </p>

      <h3 className="mt-8 mb-1 border-b border-line pb-2 font-display text-lg font-semibold">
        隐私
      </h3>
      <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
        快速隐藏（Cmd/Ctrl+Shift+B，全局快捷键隐藏并恢复窗口）与伪装窗口的底层能力已就绪；
        私密书架与模拟工作界面在后续阶段交付。快速隐藏只是视觉隐藏，不是文件加密。
      </p>
      <div className="my-3.5 flex flex-wrap items-center gap-2.5">
        <button className="btn" onClick={() => void api.openDecoyWindow()}>
          试试伪装窗口
        </button>
      </div>

      <h3 className="mt-8 mb-1 border-b border-line pb-2 font-display text-lg font-semibold">
        关于
      </h3>
      <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
        BookVault 桌面端。导入时书籍会复制到书库目录，原始文件保持不动；
        阅读进度与文件内容哈希绑定，文件被替换时会提示而不是错位。
      </p>
    </div>
  );
}
