#!/usr/bin/env python3
"""桌面端 UI 冒烟测试（M2.10，Playwright）。

前置：
    pip install playwright && playwright install chromium
运行（浏览器 mock 模式，无需 Tauri/NAS）：
    cd apps/desktop && pnpm dev &        # http://localhost:1420
    python3 scripts/e2e_smoke.py

覆盖：书架渲染（mock 书籍）→ 打开阅读器 → 章节切换 → 返回书架。
真实 GUI（Tauri 窗口、快捷键、NAS）验证步骤见 docs/adr/ADR-004 与 README。
"""

import sys

from playwright.sync_api import expect, sync_playwright

URL = "http://localhost:1420"


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(URL)

        # 书架渲染（mock 书籍卡片）
        expect(page.get_by_text("演示之书（浏览器 mock）")).to_be_visible(timeout=10_000)

        # 打开阅读器
        page.get_by_text("演示之书（浏览器 mock）").click()
        expect(page.get_by_text("第一章 演示")).to_be_visible(timeout=5_000)

        # 章节切换
        page.get_by_text("第二章 演示", exact=True).first.click()
        expect(page.get_by_text("2/2")).to_be_visible()

        # 返回书架
        page.get_by_text("← 返回").click()
        expect(page.get_by_text("导入文件")).to_be_visible()

        browser.close()
        print("e2e smoke: PASS")
        return 0


if __name__ == "__main__":
    sys.exit(main())
