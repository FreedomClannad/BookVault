//! BookVault 桌面端 Rust 壳（M0）。
//!
//! M0.6 spike：验证 Tauri 2 的两项桌面隐私底层能力（P2「快速隐藏/模拟工作界面」的前提）：
//! 1. 全局快捷键 `CmdOrCtrl+Shift+B` 隐藏/恢复主窗口；
//! 2. 多窗口：`open_decoy_window` 命令创建/显示第二个「伪装」窗口；
//! 3. 结论与人工验证步骤见 `docs/adr/ADR-004-tauri-shortcut-spike.md`。

use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 快速隐藏仅是视觉隐私（隐藏窗口），不是加密；对应需求 §2.1 的定位
fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(true) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// spike：打开（或聚焦已存在的）伪装窗口。真实的中性工作界面为 P2 交付物
#[tauri::command]
fn open_decoy_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("decoy") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "decoy", tauri::WebviewUrl::App("index.html".into()))
        .title("Terminal")
        .inner_size(720.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["CmdOrCtrl+Shift+B"])
                .expect("failed to register global shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![greet, open_decoy_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
