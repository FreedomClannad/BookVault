# BookVault NAS 服务端镜像（多阶段构建）
# 目标架构待确认（计划 §12）：本机构建默认跟随宿主；跨架构用
#   docker buildx build --platform linux/amd64,linux/arm64 ...
FROM rust:1-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY apps/server ./apps/server
# 桌面端成员不参与服务端构建（其源码不在镜像上下文中）
RUN sed -i '/desktop/d' Cargo.toml

RUN cargo build --release -p bookvault-server --bin bookvault-server

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/bookvault-server /usr/local/bin/bookvault-server

VOLUME /data
ENV BOOKVAULT_DATA_DIR=/data
ENV BOOKVAULT_BIND=0.0.0.0:8730
EXPOSE 8730

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8730/api/v1/health || exit 1

CMD ["bookvault-server"]
