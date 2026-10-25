/**
 * 封面 objectURL hook：按 workId 拉取封面字节并托管生命周期；
 * 立体书架面片与模块网格共用。模块网格一次渲染几十张封面，
 * 会话级缓存封面字节（同一本书的多次挂载/多份克隆只走一次 IPC），
 * objectURL 仍按实例创建、卸载即回收。
 */

import { useEffect, useState } from "react";
import { api } from "../../app/api";

const bytesCache = new Map<string, Promise<Uint8Array | null>>();

function cachedCoverBytes(workId: string): Promise<Uint8Array | null> {
  let p = bytesCache.get(workId);
  if (!p) {
    p = api.getCover(workId).catch(() => null);
    bytesCache.set(workId, p);
  }
  return p;
}

export function useCoverUrl(workId: string, hasCover: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hasCover) return;
    let current: string | null = null;
    void cachedCoverBytes(workId).then((bytes) => {
      if (!bytes || bytes.length === 0) return;
      current = URL.createObjectURL(new Blob([bytes.slice() as unknown as BlobPart]));
      setUrl(current);
    });
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, [workId, hasCover]);
  return url;
}
