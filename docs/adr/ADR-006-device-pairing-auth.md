# ADR-006：设备配对与 token 认证

- 状态：✅ 已实现（M3）
- 关联：需求 §9.1、Phase 1 计划 §5 M3.3

## 决策

1. 首次启动生成 6 字节配对码（hex 大写），打印到控制台并写入 `data/pairing-code.txt`；
   可用 `BOOKVAULT_PAIRING_CODE` 固定。
2. 客户端 `POST /api/v1/devices/pair`，头 `X-Pairing-Code` 常时比较配对码 →
   发放 32 字节随机 token；**服务端只存 SHA-256(token)**，绝不落明文。
3. 之后所有请求 `Authorization: Bearer <token>`；中间件查哈希且 `revoked_at IS NULL`。
4. `DELETE /devices/{id}` 撤销（不可撤销自己）；撤销即时生效。

## 理由与边界

- 局域网不是可信网络（需求 §9.1），不能「连上 Wi-Fi 即可访问」。
- 配对码是低频人工操作，容忍带外（控制台/文件）分发；P1 可加管理界面。
- token 无过期机制（撤销制而非轮换制），家庭场景够用；远程访问（P3）时重评。

## 已知限制

- HTTP 明文（局域网边界）；P3 远程访问时升级 TLS + 重新评估。
