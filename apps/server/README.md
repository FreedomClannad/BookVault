# BookVault NAS 服务端

局域网中心书库：设备配对、书库元数据、文件存储（content-addressed）与同步变更流。
架构与安全要求见 `docs/requirements/BOOKVAULT_AI_PROJECT_BRIEF.md` §7–§9。

## 运行

### Docker Compose（推荐，需求 §3）

```bash
# 在仓库根目录
docker compose up -d
curl http://127.0.0.1:8730/api/v1/health   # {"status":"ok",...}
```

- 首次启动生成**配对码**：容器日志打印，并写入 `data/pairing-code.txt`。
- 桌面端「设置 → NAS 同步」填 `http://<NAS IP>:8730` + 配对码完成配对。
- 跨架构构建（NAS 为 ARM 等）：`docker buildx build --platform linux/arm64 ...`（目标架构见 Phase 1 计划 §12 待确认项）。

### 裸机运行

```bash
cargo run --release -p bookvault-server
# 环境变量：BOOKVAULT_BIND（默认 0.0.0.0:8730）、BOOKVAULT_DATA_DIR（默认 ./data）、
#           BOOKVAULT_PAIRING_CODE（可选固定配对码）
```

## API 概览（`/api/v1`）

| 方法与路径                                           | 说明                                | 认证   |
| ---------------------------------------------------- | ----------------------------------- | ------ |
| `GET /health`                                        | 健康检查                            | 无     |
| `POST /devices/pair`（头 `X-Pairing-Code`）          | 配对换 token                        | 配对码 |
| `GET /devices` / `DELETE /devices/{id}`              | 设备列表 / 撤销                     | Bearer |
| `GET/POST /library/items`、`GET /library/items/{id}` | 书库（三层：作品/版本/文件）        | Bearer |
| `GET /library/items/{id}/contents?fileId=`           | 服务端解析目录（复用 bv-formats）   | Bearer |
| `POST /library/files/{id}/content?sha256=&size=...`  | 流式上传（哈希+大小校验，上限 2GB） | Bearer |
| `GET /library/files/{id}/content`（支持 `Range`）    | 下载 / 断点续传                     | Bearer |
| `POST /progress`                                     | 按设备上行阅读进度                  | Bearer |
| `GET /sync/changes?cursor=` / `POST /sync/ack`       | 增量变更流 / 确认                   | Bearer |

## 目录布局

```
data/
├── db/bookvault.db     # SQLite（WAL）+ sqlx 版本化 migrations（自动执行）
├── files/ab/<sha256>   # content-addressed 文件实体（ADR-007）
└── pairing-code.txt    # 配对码（首次生成）
```

## 备份与恢复（需求 §9.4，M3.9）

**备份**（数据库与文件实体都在 `data/`，一致性窗口说明如下）：

```bash
# 停写窗口备份（最简单、保证一致）：
docker compose stop
tar czf bookvault-backup-$(date +%F).tgz data/
docker compose start

# 热备份（可接受极小不一致窗口时）：SQLite 侧用 WAL 快照
sqlite3 data/db/bookvault.db "VACUUM INTO '/tmp/snapshot.db'"   # 需宿主机 sqlite3
tar czf bookvault-files-$(date +%F).tgz data/files
```

**恢复**：解包 `data/`（或快照 db + files 包）到原位后 `docker compose up -d`；
服务端启动时自动校验并执行未跑过的 migrations，schema 版本记录在库内。

**升级**：拉取新代码后 `docker compose up -d --build`；migration 仅前向，不回滚
（回滚前先恢复备份）。

## 安全要点（已实现 / 边界）

- 设备 token 只存 SHA-256（ADR-006）；撤销后立即失效。
- 局域网明文 HTTP（第一阶段边界，需求 §9.1：局域网也不是天然可信，远程访问/TLS 属 P3）。
- 上传流式落盘 + 大小/哈希双校验；下载支持 Range。
- SSRF 防护校验函数已实现并测试（`ssrf.rs`），URL 导入功能 P1 接入时启用。
- 私密内容同步策略（需求 §7.3）在 P2 私密书架落地时实施。
