/**
 * 书架视图：封面网格 + 导入入口（文件/目录/拖拽）。
 * 封面缺失时用书名首字生成占位（背景色由书名哈希决定——ui-style §5）。
 */

import { useEffect, useState } from "react";
import { api, type WorkRow } from "../../app/api";

interface Props {
  works: WorkRow[];
  onOpen: (fileId: string) => void;
  onImport: () => void;
  onImportDir: () => void;
}

function coverColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 36% 42%)`;
}

function BookCard({ work, onOpen }: { work: WorkRow; onOpen: (id: string) => void }) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    void api.getCover(work.id).then((bytes) => {
      if (!bytes || bytes.length === 0) return;
      url = URL.createObjectURL(
        new Blob([bytes.slice() as unknown as BlobPart], { type: "image/png" }),
      );
      setCoverUrl(url);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [work.id]);

  const first = work.files[0];

  return (
    <button className="book-card" onClick={() => first && onOpen(first.id)} disabled={!first}>
      <div className="book-cover">
        {coverUrl ? (
          <img src={coverUrl} alt={work.title} />
        ) : (
          <span
            className="book-fallback"
            style={{
              background: coverColor(work.title),
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "inherit",
            }}
          >
            {work.title.charAt(0)}
          </span>
        )}
      </div>
      <div className="book-title">{work.title}</div>
      <div className="book-meta">
        {work.authors[0] ?? "未知作者"}
        {work.files.length > 1 ? ` · ${work.files.length} 个版本` : ""}
        {first ? ` · ${first.format}` : ""}
      </div>
    </button>
  );
}

export function Library({ works, onOpen, onImport, onImportDir }: Props) {
  return (
    <div className="library">
      <div className="library-toolbar">
        <button className="primary" onClick={onImport}>
          导入文件
        </button>
        <button onClick={onImportDir}>导入图片文件夹</button>
      </div>
      {works.length === 0 ? (
        <div className="empty-state">
          <div>书架还是空的</div>
          <div>把书籍文件拖到这里，或点击「导入文件」开始</div>
        </div>
      ) : (
        <div className="shelf">
          {works.map((w) => (
            <BookCard key={w.id} work={w} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
