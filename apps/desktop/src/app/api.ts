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
  files: FileRow[];
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

const mockWork: WorkRow = {
  id: "mock-w1",
  title: "演示之书（浏览器 mock）",
  authors: ["BookVault"],
  hasCover: false,
  files: [
    {
      id: "mock-f1",
      format: "txt",
      name: "demo.txt",
      size: 200,
      sha256: "0".repeat(64),
      origin: "local",
    },
  ],
};

const mockChapterText = (id: string) =>
  `${id === "ch-0" ? "第一章 演示" : "第二章 演示"}\n\n` +
  "山不在高，有仙则名。水不在深，有龙则灵。\n".repeat(10);

// ---------- 对外 API ----------

export const api = {
  async importPaths(paths: string[]): Promise<ImportedFile[]> {
    if (!hasTauri) {
      return paths.map((p) => ({
        workId: "mock-w1",
        editionId: "mock-e1",
        fileId: "mock-f1",
        title: p,
        format: "txt",
        sha256: "0".repeat(64),
        duplicate: false,
      }));
    }
    return (await rawInvoke("import_paths", { paths })) as ImportedFile[];
  },

  async listWorks(): Promise<WorkRow[]> {
    if (!hasTauri) return [mockWork];
    return (await rawInvoke("list_works")) as WorkRow[];
  },

  async openBook(fileId: string): Promise<OpenedBook> {
    if (!hasTauri) {
      return {
        file: mockWork.files[0],
        parsedSha256: "0".repeat(64),
        book: {
          kind: "txt",
          sha256: "0".repeat(64),
          parser: { parser: "mock", version: "0" },
          metadata: {
            title: "演示之书",
            authors: ["BookVault"],
            description: null,
            language: "zh",
            identifiers: [],
            coverRef: null,
          },
          contents: { novel: { chapters: MOCK_CHAPTERS, encoding: "UTF-8" } },
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
