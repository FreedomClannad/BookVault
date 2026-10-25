/**
 * 设置：全屏页面，左侧分组导航（阅读偏好/同步/隐私/关于）。
 * 阅读偏好与阅读器共用 readingPrefs 持久化（改完即存，下次阅读生效）；
 * 隐私区说明快速隐藏行为并提供伪装界面预览。
 */

import { useEffect, useState } from "react";
import { api, type PullReport, type PushReport } from "../../app/api";
import {
  clampFontSize,
  clampLineHeight,
  FONT_SANS,
  FONT_SERIF,
  loadReadingPrefs,
  saveReadingPrefs,
  type ReadingPrefs,
} from "../reader/readingPrefs";
import { READING_THEMES } from "../reader/readingTheme";

type SectionId = "reading" | "sync" | "privacy" | "about";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "reading", label: "阅读偏好" },
  { id: "sync", label: "同步" },
  { id: "privacy", label: "隐私" },
  { id: "about", label: "关于" },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 flex min-h-9 items-center gap-4">
      <span className="w-16 flex-none text-sm text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2.5">{children}</div>
    </div>
  );
}

function ReadingPanel() {
  const [prefs, setPrefs] = useState<ReadingPrefs>(loadReadingPrefs);
  const update = (patch: Partial<ReadingPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      saveReadingPrefs(next);
      return next;
    });

  return (
    <div className="max-w-[560px]">
      <Row label="字号">
        <button
          className="btn px-3"
          title="缩小字号"
          onClick={() => update({ fontSize: clampFontSize(prefs.fontSize - 2) })}
        >
          A-
        </button>
        <span className="w-12 text-center text-sm">{prefs.fontSize}px</span>
        <button
          className="btn px-3"
          title="放大字号"
          onClick={() => update({ fontSize: clampFontSize(prefs.fontSize + 2) })}
        >
          A+
        </button>
      </Row>
      <Row label="行高">
        <input
          type="range"
          min={1.4}
          max={2}
          step={0.1}
          value={prefs.lineHeight}
          onChange={(e) => update({ lineHeight: clampLineHeight(Number(e.target.value)) })}
          className="w-44 accent-[var(--color-accent)]"
          aria-label="行高"
        />
        <span className="w-9 text-center text-sm">{prefs.lineHeight.toFixed(1)}</span>
      </Row>
      <Row label="字体">
        {(
          [
            { serif: false, label: "黑体" },
            { serif: true, label: "宋体" },
          ] as const
        ).map((o) => (
          <button
            key={o.label}
            className={`btn px-4 ${prefs.serif === o.serif ? "btn-primary" : ""}`}
            onClick={() => update({ serif: o.serif })}
          >
            {o.label}
          </button>
        ))}
      </Row>
      <Row label="阅读主题">
        {Object.values(READING_THEMES).map((t) => (
          <button
            key={t.id}
            title={t.label}
            onClick={() => update({ theme: t })}
            className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 p-1.5 transition-colors ${
              t.id === prefs.theme.id ? "border-seal" : "border-line hover:border-muted"
            }`}
          >
            <span
              className="block h-9 w-9 rounded border border-line"
              style={{ background: t.bg }}
            />
            <span className="text-[11px] text-muted">{t.label}</span>
          </button>
        ))}
      </Row>

      <div
        className="mt-7 rounded-lg border border-line p-5"
        style={{ background: prefs.theme.bg }}
        aria-hidden="true"
      >
        <div
          className="text-justify"
          style={{
            color: prefs.theme.fg,
            fontSize: `${prefs.fontSize}px`,
            lineHeight: prefs.lineHeight,
            fontFamily: prefs.serif ? FONT_SERIF : FONT_SANS,
          }}
        >
          山不在高，有仙则名。水不在深，有龙则灵。斯是陋室，惟吾德馨。苔痕上阶绿，草色入帘青。谈笑有鸿儒，往来无白丁。
        </div>
      </div>
      <p className="mt-3 text-[13px] text-muted">
        阅读时也可用悬浮工具栏的 A-/A+ 调字号、主题色块切主题，与这里互通。
      </p>
    </div>
  );
}

function SyncPanel() {
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
    <div className="max-w-[560px]">
      <div
        className={`mb-3.5 flex items-center gap-2 text-[13px] ${status ? "text-fg" : "text-muted"}`}
      >
        <span className={`h-2 w-2 rounded-full ${status ? "bg-[#58a97a]" : "bg-muted"}`} />
        {status
          ? `已连接 ${status.url}`
          : "未连接。NAS 首次启动会在控制台与 data/pairing-code.txt 打印配对码"}
      </div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
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
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <button className="btn" disabled={busy || !status} onClick={push}>
          推送本地书库
        </button>
        <button className="btn" disabled={busy || !status} onClick={pull}>
          从 NAS 拉取
        </button>
      </div>
      {msg && <p className="mb-2 text-[13px] leading-relaxed text-muted">{msg}</p>}
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
    </div>
  );
}

function PrivacyPanel() {
  return (
    <div className="max-w-[560px]">
      <p className="text-[13px] leading-relaxed text-muted">
        全局快捷键{" "}
        <kbd className="rounded border border-line bg-paper-raised px-1.5 py-0.5 text-xs">
          Ctrl/Cmd + Shift + B
        </kbd>
        ：一键隐藏主窗口（含任务栏），同时弹出与书库毫无关系的静态「工作笔记」伪装界面；
        再按一次关闭伪装、恢复主窗口。快捷键在本应用未聚焦时同样生效（macOS 首次使用需在 系统设置 →
        隐私与安全性中授权）。
      </p>
      <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
        快速隐藏只是视觉隐藏，不是文件加密；阅读时窗口标题始终为
        BookVault，不会出现书名。私密书架与可配置的模拟工作界面将在后续阶段交付。
      </p>
      <div className="mt-4">
        <button className="btn" onClick={() => void api.openDecoyWindow()}>
          预览伪装界面
        </button>
      </div>
    </div>
  );
}

function AboutPanel() {
  return (
    <div className="max-w-[560px] text-[13px] leading-relaxed text-muted">
      <p>BookVault 桌面端 —— 个人小说与漫画阅读器。</p>
      <p className="mt-2.5">
        导入时书籍会复制到书库目录，原始文件保持不动；阅读进度与文件内容哈希绑定，文件被替换时会提示而不是错位。
      </p>
      <p className="mt-2.5">本地优先，局域网自托管 NAS 同步，离线可用。</p>
    </div>
  );
}

interface Props {
  onBack: () => void;
}

export function Settings({ onBack }: Props) {
  const [section, setSection] = useState<SectionId>("reading");
  const active = SECTIONS.find((s) => s.id === section);

  return (
    <div className="flex h-full min-w-0 flex-col bg-paper">
      <div className="flex flex-none items-center gap-2 border-b border-line bg-paper-raised px-5 py-2.5">
        <button className="btn btn-ghost" onClick={onBack}>
          ← 返回书架
        </button>
        <span className="font-display text-base font-semibold">设置</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="w-40 flex-none border-r border-line p-3">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`mb-0.5 block w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm transition-colors ${
                section === s.id
                  ? "bg-accent-weak font-medium text-accent-strong"
                  : "text-muted hover:bg-paper-raised hover:text-fg"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto px-8 py-6">
          <h3 className="mb-6 font-display text-lg font-semibold">{active?.label}</h3>
          {section === "reading" && <ReadingPanel />}
          {section === "sync" && <SyncPanel />}
          {section === "privacy" && <PrivacyPanel />}
          {section === "about" && <AboutPanel />}
        </div>
      </div>
    </div>
  );
}
