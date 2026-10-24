# ADR-007：Content-addressed 文件存储

- 状态：✅ 已实现（M3）
- 关联：需求 §7.1/§7.2、Phase 1 计划 §5 M3.5

## 决策

- 文件实体存 `data/files/<sha256 前 2 位>/<sha256>`（无扩展名），同哈希天然去重。
- 上传协议：`POST /library/files/{id}/content?sha256=&size=&format=&editionId=&name=`，
  **流式**写临时文件（不整体进内存，上限 2GB）→ 大小 + SHA-256 双校验 → 原子 rename 入库。
- 下载支持单段 `Range`（断点续传基础）。
- 元数据（路径、大小、格式、上传者）在 SQLite `files` 表；**所有 upsert 路径都会同步
  更新 `storage_path`**（曾发现初版 ON CONFLICT 漏更新该列导致 404，已修复并加集成测试覆盖）。

## 理由

- 哈希即身份：去重、校验、进度绑定（ADR-003）共用同一套 sha256。
- rename 原子性保证「校验通过才可见」，失败清理临时文件。

## 已知限制

- 上传上限 2GB 为常量（P1 配置化）；多段 Range 未实现（P1）。
