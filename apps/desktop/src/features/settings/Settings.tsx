/**
 * 设置视图：NAS 配对 / 推送 / 拉取（M4）+ 隐私能力说明。
 */

import { useEffect, useState } from "react";
import { api, type PullReport, type PushReport } from "../../app/api";

export function Settings() {
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
      setMsg(`配对成功，设备 ID: ${s.deviceId}`);
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
    <div className="settings">
      <h3>NAS 同步</h3>
      {status ? (
        <p className="settings-note">
          已连接 {status.url}（设备 {status.deviceId.slice(0, 8)}…）
        </p>
      ) : (
        <p className="settings-note">
          未配置。NAS 侧首次启动会在控制台/数据目录的 pairing-code.txt 打印配对码。
        </p>
      )}
      <div className="settings-row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://nas:8730" />
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="配对码" />
        <button className="primary" disabled={busy} onClick={pair}>
          配对
        </button>
      </div>
      <div className="settings-row">
        <button disabled={busy || !status} onClick={push}>
          推送本地书库到 NAS
        </button>
        <button disabled={busy || !status} onClick={pull}>
          从 NAS 拉取
        </button>
      </div>
      {msg && <p className="settings-note">{msg}</p>}
      {pushReport && (
        <div className="sync-report">
          推送完成：作品 {pushReport.works} · 文件 {pushReport.filesUploaded} · 进度{" "}
          {pushReport.progressRows}
          {pushReport.filesSkippedDir > 0 &&
            ` ·（目录型 ${pushReport.filesSkippedDir} 项暂不支持上传）`}
        </div>
      )}
      {pullReport && (
        <div className="sync-report">
          拉取完成：作品 {pullReport.worksUpserted} · 下载 {pullReport.filesDownloaded} · 应用进度{" "}
          {pullReport.progressApplied}（游标 {pullReport.cursor}）
        </div>
      )}

      <h3>隐私能力（P2 预览）</h3>
      <p className="settings-note">
        快速隐藏（Cmd/Ctrl+Shift+B，全局快捷键隐藏/恢复窗口）与伪装窗口已具备底层能力；
        私密书架与模拟工作界面在 P2 交付。快速隐藏只是视觉隐藏，不是文件加密。
      </p>
      <div className="settings-row">
        <button onClick={() => void api.openDecoyWindow()}>打开伪装窗口（spike）</button>
      </div>

      <h3>关于</h3>
      <p className="settings-note">
        BookVault 桌面端 · 局域网优先 · 原始文件保留（导入时复制到书库目录，原件不动）。
        阶段与验收标准见 docs/plans/phase-1-implementation-plan.md。
      </p>
    </div>
  );
}
