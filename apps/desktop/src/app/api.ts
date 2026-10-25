/**
 * 桌面端 API 层：唯一的 Tauri invoke 出口（分层规则：features 不直接碰 IPC）。
 * 浏览器开发模式下自动切换到 mock（供 vite dev / E2E 使用）。
 */

import { invoke } from "@tauri-apps/api/core";

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---------- 类型（与 Rust 侧 DTO camelCase 对齐） ----------

export interface FileRow {
  id: string;
  format: string;
  name: string;
  size: number;
  sha256: string;
  origin: string;
}

export interface WorkRow {
  id: string;
  title: string;
  authors: string[];
  hasCover: boolean;
  /** 本地分类（导入自动归类，可手动改；""=未分类；不参与 NAS 同步） */
  category: string;
  files: FileRow[];
  /** 最近阅读时间（毫秒；null=未读） */
  lastReadAt: number | null;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期 */
export function relTime(ts: number | null): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ImportedFile {
  workId: string;
  editionId: string;
  fileId: string;
  title: string;
  format: string;
  sha256: string;
  duplicate: boolean;
}

/** 单个文件的导入失败（坏文件不拖垮整批，逐项报告） */
export interface ImportFailure {
  path: string;
  error: string;
}

/** 导入结果：目录已由后端展开为书目文件后逐个导入 */
export interface ImportBatch {
  imported: ImportedFile[];
  failed: ImportFailure[];
}

export type Locator =
  { zip_entry: string } | { byte_range: { start: number; end: number } } | { file_path: string };

export interface ChapterDto {
  id: string;
  title: string | null;
  locator: Locator;
}

export interface PageDto {
  index: number;
  locator: Locator;
}

export type BookContents =
  | { novel: { chapters: ChapterDto[]; encoding: string | null } }
  | { comic: { pages: PageDto[] } }
  | { document: { pages: number; toc: { title: string; page: number }[] } };

export interface ParsedBookDto {
  kind: string;
  sha256: string;
  parser: { parser: string; version: string };
  metadata: {
    title: string | null;
    authors: string[];
    description: string | null;
    language: string | null;
    identifiers: [string, string][];
    coverRef: { id: string } | null;
  };
  contents: BookContents;
}

export interface DeviceProgress {
  deviceId: string;
  location: ReadingLocation | null;
  contentSha256: string;
  updatedAt: number;
}

export type ReadingLocation =
  | { type: "chapter"; chapterId: string; progress: number }
  | { type: "page"; pageIndex: number }
  | { type: "comic"; imageIndex: number };

export interface OpenedBook {
  /** 所属作品 id：逐书排版记忆的键（同作品多版本共享设置） */
  workId: string;
  file: FileRow;
  parsedSha256: string;
  book: ParsedBookDto;
  progress: DeviceProgress[];
  hashDrift: boolean;
}

export interface PushReport {
  works: number;
  filesUploaded: number;
  filesSkippedDir: number;
  progressRows: number;
}

export interface PullReport {
  worksUpserted: number;
  filesDownloaded: number;
  progressApplied: number;
  cursor: number;
}

// ---------- 真实实现 ----------

async function rawInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  return invoke(cmd, args);
}

async function binaryInvoke(cmd: string, args: Record<string, unknown>): Promise<Uint8Array> {
  // 返回 tauri::ipc::Response 的命令，invoke 直接解析为 ArrayBuffer（raw IPC）
  const buf = (await invoke(cmd, args)) as unknown as ArrayBuffer;
  return new Uint8Array(buf);
}

// ---------- Mock（浏览器 dev / Playwright） ----------

const MOCK_CHAPTERS: ChapterDto[] = [
  { id: "ch-0", title: "第一章 演示", locator: { byte_range: { start: 0, end: 100 } } },
  { id: "ch-1", title: "第二章 演示", locator: { byte_range: { start: 100, end: 200 } } },
];

const mockWork = (
  id: string,
  title: string,
  authors: string[],
  category: string,
  format: string,
  lastReadAt: number | null,
): WorkRow => ({
  id,
  title,
  authors,
  hasCover: false,
  category,
  lastReadAt,
  files: [
    {
      id: `${id}-f1`,
      format,
      name: `${title}.${format}`,
      size: 200,
      sha256: "0".repeat(64),
      origin: "local",
    },
  ],
});

/** mock 书库 5 本：立体书架的书脊陈列、翻页器与筛选在浏览器 dev 下有真实形态可看 */
const mockWorks: WorkRow[] = [
  mockWork(
    "mock-w1",
    "演示之书（浏览器 mock）",
    ["BookVault"],
    "",
    "txt",
    Date.now() - 42 * 60_000,
  ),
  mockWork("mock-w2", "月光航线", ["林见舟"], "科幻", "epub", Date.now() - 26 * 3_600_000),
  mockWork("mock-w3", "山海招待所", ["许芦"], "悬疑", "txt", Date.now() - 3 * 86_400_000),
  mockWork("mock-w4", "银翼研究所", ["白鹿"], "玄幻", "pdf", null),
  mockWork("mock-w5", "纸岛信箱", ["汤野"], "言情", "epub", null),
];
const mockWorkLegacy = mockWorks[0];

const mockChapterText = (id: string) => {
  // 章节序号由 id 推导（ch-0 / OEBPS/ch1.xhtml…），保证相邻章节内容必不相同
  const m = /ch-?(\d+)/.exec(id);
  const no = m ? Number(m[1]) + 1 : 1;
  const zh = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][no - 1] ?? String(no);
  const title = `第${zh}章 演示`;
  // EPUB mock（zip_entry 定位）走 HTML 语义：\n 不换行，用段落撑起可滚动篇幅
  if (id.endsWith(".xhtml")) {
    return (
      `<h2>${title}</h2>` +
      Array.from({ length: 30 }, () => "<p>山不在高，有仙则名。水不在深，有龙则灵。</p>").join("")
    );
  }
  return `${title}\n\n` + "山不在高，有仙则名。水不在深，有龙则灵。\n".repeat(10);
};

// ---------- 对外 API ----------

export const api = {
  async importPaths(paths: string[]): Promise<ImportBatch> {
    if (!hasTauri) {
      // 浏览器预览模式没有解析/存储后端：导入真实文件必须明确失败——
      // 静默假装成功会让「导入的书打开不是/没内容」（真实测试走 pnpm tauri dev）
      throw new Error("浏览器预览模式无法导入真实文件，请运行 pnpm tauri dev 测试");
    }
    return (await rawInvoke("import_paths", { paths })) as ImportBatch;
  },

  async listWorks(): Promise<WorkRow[]> {
    if (!hasTauri) return mockWorks;
    return (await rawInvoke("list_works")) as WorkRow[];
  },

  async setWorkCategory(workId: string, category: string): Promise<void> {
    if (!hasTauri) return;
    await rawInvoke("set_work_category", { workId, category });
  },

  /** 批量删除作品（不可逆，调用方必须先弹确认对话框）；返回实际删除数 */
  async deleteWorks(workIds: string[]): Promise<number> {
    if (!hasTauri) return 0;
    return (await rawInvoke("delete_works", { workIds })) as number;
  },

  /** 保存前端生成的封面（PNG dataURL 或纯 base64）；成功后需刷新书库使 hasCover 生效 */
  async saveCover(fileId: string, dataUrlOrBase64: string): Promise<void> {
    if (!hasTauri) return;
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrlOrBase64);
    const ext = m && m[1] !== "jpeg" ? (m[1] as string) : m ? "jpg" : "png";
    const payload = m ? m[2] : dataUrlOrBase64;
    await rawInvoke("save_cover", { fileId, ext, base64: payload });
  },

  /** 用户从系统对话框选一张图片设为封面（路径来源受控） */
  async importCover(fileId: string): Promise<void> {
    if (!hasTauri) return;
    const path = await pickImage();
    if (!path) return;
    await rawInvoke("import_cover", { fileId, path });
  },

  async openBook(fileId: string): Promise<OpenedBook> {
    if (!hasTauri) {
      // openBook 收到的是 fileId（<workId>-fN），按文件反查所属 mock 作品
      const work = mockWorks.find((w) => w.files[0]?.id === fileId) ?? mockWorkLegacy;
      const isEpub = work.files[0].format === "epub";
      return {
        workId: work.id,
        file: work.files[0],
        parsedSha256: "0".repeat(64),
        book: {
          kind: isEpub ? "epub" : "txt",
          sha256: "0".repeat(64),
          parser: { parser: "mock", version: "0" },
          metadata: {
            title: work.title,
            authors: work.authors,
            description: null,
            language: "zh",
            identifiers: [],
            coverRef: null,
          },
          contents: {
            novel: {
              // EPUB mock 用 zip_entry 定位（EpubReader 按 href 再 getResource）
              chapters: isEpub
                ? [
                    {
                      id: "OEBPS/ch1.xhtml",
                      title: "第一章 演示",
                      locator: { zip_entry: "OEBPS/ch1.xhtml" },
                    },
                    {
                      id: "OEBPS/ch2.xhtml",
                      title: "第二章 演示",
                      locator: { zip_entry: "OEBPS/ch2.xhtml" },
                    },
                  ]
                : MOCK_CHAPTERS,
              encoding: "UTF-8",
            },
          },
        },
        progress: [],
        hashDrift: false,
      };
    }
    return (await rawInvoke("open_book", { fileId })) as OpenedBook;
  },

  async getResource(fileId: string, refId: string): Promise<Uint8Array> {
    if (!hasTauri) {
      return new TextEncoder().encode(mockChapterText(refId));
    }
    return binaryInvoke("get_resource", { fileId, refId });
  },

  async getFileBytes(fileId: string): Promise<Uint8Array> {
    if (!hasTauri) return new TextEncoder().encode("mock-pdf");
    return binaryInvoke("get_file_bytes", { fileId });
  },

  async getCover(workId: string): Promise<Uint8Array | null> {
    if (!hasTauri) return null;
    try {
      return await binaryInvoke("get_cover", { workId });
    } catch {
      return null;
    }
  },

  async saveReadingProgress(fileId: string, location: ReadingLocation): Promise<void> {
    if (!hasTauri) return;
    await rawInvoke("save_reading_progress", { fileId, location });
  },

  async nasPair(url: string, code: string): Promise<{ url: string; deviceId: string }> {
    if (!hasTauri) return { url, deviceId: "mock-device" };
    return (await rawInvoke("nas_pair", { url, code })) as { url: string; deviceId: string };
  },

  async nasStatus(): Promise<{ url: string; deviceId: string } | null> {
    if (!hasTauri) return null;
    return (await rawInvoke("nas_status")) as { url: string; deviceId: string } | null;
  },

  async nasPush(): Promise<PushReport> {
    if (!hasTauri) {
      return { works: 0, filesUploaded: 0, filesSkippedDir: 0, progressRows: 0 };
    }
    return (await rawInvoke("nas_push")) as PushReport;
  },

  async nasPull(): Promise<PullReport> {
    if (!hasTauri) {
      return { worksUpserted: 0, filesDownloaded: 0, progressApplied: 0, cursor: 0 };
    }
    return (await rawInvoke("nas_pull")) as PullReport;
  },

  async openDecoyWindow(): Promise<void> {
    if (!hasTauri) return;
    await rawInvoke("open_decoy_window");
  },

  pickFiles(): Promise<string[]> {
    // 对话框需要 Tauri 环境；浏览器下空实现（由拖拽路径覆盖）
    if (!hasTauri) return Promise.resolve([]);
    return (async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: true, directory: false });
      if (!sel) return [];
      return Array.isArray(sel) ? sel : [sel];
    })();
  },

  pickDirectory(): Promise<string | null> {
    if (!hasTauri) return Promise.resolve(null);
    return (async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: false, directory: true });
      return typeof sel === "string" ? sel : null;
    })();
  },
};

/** 用户选一张本地图片（设封面用），返回路径 */
function pickImage(): Promise<string | null> {
  if (!hasTauri) return Promise.resolve(null);
  return (async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    return typeof sel === "string" ? sel : null;
  })();
}

/** 二进制 → data URL（EPUB 图片内联用） */
export function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    css: "text/css",
    xhtml: "application/xhtml+xml",
    html: "text/html",
  };
  return map[ext] ?? "application/octet-stream";
}
