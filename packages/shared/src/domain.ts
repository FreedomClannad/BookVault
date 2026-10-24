/**
 * BookVault 领域模型（Phase 1 计划 §4.1）。
 *
 * 本包是领域类型的唯一定义处：桌面端、移动端、服务端 DTO（crates/bv-protocol）
 * 均以此对齐；禁止在本包引入 DOM、Node API 或任何运行时依赖。
 */

export type BookKind = "novel" | "comic" | "document";

/** P0 支持的文件格式（值与 DDL CHECK、bv-protocol BookFormat 序列化一致） */
export type BookFormat = "epub" | "txt" | "pdf" | "cbz" | "image_dir";

/** 资源引用：封面 / 章节资源 / 漫画页面，由格式适配层产出 */
export interface ResourceRef {
  id: string;
  mime?: string;
}

/** 作品（三层模型第一层：Work 1—N Edition 1—N BookFile） */
export interface Work {
  id: string;
  title: string;
  authors: string[];
  description?: string;
  language?: string;
  /** 封面资源（提取后的缓存），缺失时 UI 用书名首字占位 */
  coverRef?: ResourceRef;
  identifiers: Record<string, string>;
}

/** 内容版本（如「出版 EPUB 版」vs「网络 TXT 版」） */
export interface Edition {
  id: string;
  workId: string;
  label: string;
  source?: string;
  language?: string;
}

export type BookFileOrigin = "local" | "nas";

export interface BookFile {
  id: string;
  editionId: string;
  format: BookFormat;
  origin: BookFileOrigin;
  path: string;
  size: number;
  sha256: string;
  parser: string;
  parserVersion: string;
}

/** 阅读位置三态（需求 §5.3）：小说=章节+进度，PDF=页码，漫画=图片索引 */
export type ReadingLocation =
  | { type: "chapter"; chapterId: string; progress: number; anchor?: string }
  | { type: "page"; pageIndex: number }
  | { type: "comic"; chapterId?: string; imageIndex: number };

export interface ReadingProgress {
  deviceId: string;
  bookFileId: string;
  /** 进度绑定文件版本：必须等于关联 BookFile 的 sha256，失配时 UI 降级处理 */
  contentSha256: string;
  location: ReadingLocation;
  updatedAt: number;
}

export type DeviceStatus = "paired" | "revoked";

export interface Device {
  id: string;
  name: string;
  pairedAt: number;
  status: DeviceStatus;
}

export type ImportTaskStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface ImportTask {
  id: string;
  sourceType: string;
  status: ImportTaskStatus;
  error?: string;
  createdAt: number;
}
