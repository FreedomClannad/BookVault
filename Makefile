# BookVault 一键检查入口（M0.5）
# 使用：make check / make fmt / make lint / make test / make audit

.PHONY: check fmt fmt-check lint test build audit help

help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

check: fmt-check lint test ## 一键：格式检查 + lint + 全部测试（Rust + TS）
	@echo "✅ all checks passed"

fmt: ## 格式化（cargo fmt + prettier）
	cargo fmt --all
	pnpm format

fmt-check: ## 格式检查（不修改文件）
	cargo fmt --all --check
	pnpm format:check

lint: ## clippy deny warnings + eslint
	cargo clippy --workspace --all-targets -- -D warnings
	pnpm lint

test: ## cargo test + pnpm test
	cargo test --workspace
	pnpm test

build: ## 构建前端（tsc + vite）
	pnpm -r build

audit: ## 依赖审计（工具未安装时跳过并提示）
	@command -v cargo-deny >/dev/null && cargo deny check || echo "skip: cargo-deny 未安装（brew install cargo-deny 后重试）"
	pnpm audit --prod
