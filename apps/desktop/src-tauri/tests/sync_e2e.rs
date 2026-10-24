//! M4 验收闭环（Phase 1 计划 §5 M4.5；需求 §10 P0 原文场景）：
//! 设备 A 导入 → 上传 NAS → 设备 B 拉取 → B 打开阅读保存进度 → B 推送 →
//! A 拉取 → **两端进度一致**。另含断网安全性检查（NAS 不可达时本地库不受影响）。

use bookvault_desktop_lib::db;
use bookvault_desktop_lib::library::Library;
use bookvault_desktop_lib::sync;
use bookvault_server::build_router;
use bookvault_server::state::{ServerConfig, init_state};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

fn ws_sample() -> PathBuf {
    let p =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../samples/txt/utf8-chapters.txt");
    if !p.exists() {
        let out = std::process::Command::new("python3")
            .arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../scripts/gen-samples.py"))
            .output()
            .unwrap();
        assert!(out.status.success());
    }
    p
}

fn db_row(conn: &Connection, sql: &str) -> Vec<Vec<String>> {
    let mut stmt = conn.prepare(sql).unwrap();
    let n = stmt.column_count();
    stmt.query_map([], |r| {
        let mut cols = Vec::new();
        for i in 0..n {
            let v: String = match r.get_ref(i).unwrap() {
                rusqlite::types::ValueRef::Text(t) => String::from_utf8_lossy(t).to_string(),
                rusqlite::types::ValueRef::Null => "".into(),
                other => format!("{other:?}"),
            };
            cols.push(v);
        }
        Ok(cols)
    })
    .unwrap()
    .collect::<Result<Vec<_>, _>>()
    .unwrap()
}

#[tokio::test]
async fn two_device_sync_closed_loop() {
    // 0) NAS 服务端（in-process，真实 HTTP）
    let server_data = tempfile::tempdir().unwrap();
    let cfg = ServerConfig {
        bind: "127.0.0.1:0".into(),
        data_dir: server_data.keep(),
        pairing_code: Some("E2ECODE".into()),
    };
    let state = init_state(&cfg).await.unwrap();
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let nas_url = format!("http://{addr}");

    // 1) 设备 A：本地导入一本小说
    let dir_a = tempfile::tempdir().unwrap();
    let data_a = dir_a.path().join("data");
    let mut conn_a = db::open(&data_a).unwrap();
    let lib_a = Library::new(&data_a);
    let imported = lib_a.import(&mut conn_a, &ws_sample()).unwrap();
    assert!(!imported.duplicate);
    let title = imported.title.clone();

    // 2) A 配对并推送
    let cfg_a = sync::pair(&conn_a, &nas_url, "E2ECODE", "device-a")
        .await
        .unwrap();
    let report = sync::push_all(&mut conn_a, &cfg_a).await.unwrap();
    assert_eq!(report.files_uploaded, 1);

    // 3) 断网演练：错误地址推送必须失败且本地库完好（需求 §10 断网可用）
    let dead = sync::NasConfig {
        url: "http://127.0.0.1:1".into(),
        token: cfg_a.token.clone(),
        device_id: cfg_a.device_id.clone(),
    };
    assert!(sync::push_all(&mut conn_a, &dead).await.is_err());
    let works_a = db_row(&conn_a, "SELECT CAST(COUNT(*) AS TEXT) FROM works");
    assert_eq!(works_a[0][0], "1", "local library must survive NAS outage");

    // 4) 设备 B：配对、拉取
    let dir_b = tempfile::tempdir().unwrap();
    let data_b = dir_b.path().join("data");
    let mut conn_b = db::open(&data_b).unwrap();
    let cfg_b = sync::pair(&conn_b, &nas_url, "E2ECODE", "device-b")
        .await
        .unwrap();
    let pull = sync::pull_all(&mut conn_b, &cfg_b, &data_b).await.unwrap();
    assert_eq!(pull.works_upserted, 1);
    assert_eq!(pull.files_downloaded, 1);

    // 5) B 打开拉取的书并保存进度（模拟阅读到第二章 50%）
    let (file_id, path): (String, String) = {
        let row = db_row(&conn_b, "SELECT id, path FROM book_files LIMIT 1").remove(0);
        (row[0].clone(), row[1].clone())
    };
    assert!(Path::new(&path).exists(), "downloaded file must exist");
    let book = bv_formats::parse_book(Path::new(&path)).unwrap();
    assert_eq!(
        book.sha256, imported.sha256,
        "downloaded content hash must match"
    );
    let device_b = db::ensure_device_id(&conn_b).unwrap();
    let location = serde_json::json!({
        "type": "chapter", "chapterId": "ch-1", "progress": 0.5
    });
    conn_b
        .execute(
            "INSERT OR REPLACE INTO reading_progress (device_id, book_file_id, content_sha256, location, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![device_b, file_id, imported.sha256, location.to_string(), 1700000000000i64],
        )
        .unwrap();

    // 6) B 推送进度
    let report = sync::push_all(&mut conn_b, &cfg_b).await.unwrap();
    assert!(report.progress_rows >= 1, "device B progress pushed");

    // 7) A 拉取 → 收到 B 的进度行
    let pull_a = sync::pull_all(&mut conn_a, &cfg_a, &data_a).await.unwrap();
    assert!(pull_a.progress_applied >= 1, "A must receive B's progress");
    // A 库中按设备保留的 B 进度行：
    let device_a = db::ensure_device_id(&conn_a).unwrap();
    let row_b_on_a = db_row(
        &conn_a,
        &format!(
            "SELECT location FROM reading_progress WHERE device_id = '{}' ",
            cfg_b.device_id
        ),
    );
    let _ = device_a;
    assert!(
        !row_b_on_a.is_empty(),
        "A must hold B's per-device progress row"
    );
    let loc_a: serde_json::Value = serde_json::from_str(&row_b_on_a[0][0]).unwrap();
    assert_eq!(loc_a, location, "progress must be identical on both ends");

    // 8) 两端「合并视图」一致：取最新 updated_at 的行
    for conn in [&conn_a, &conn_b] {
        let latest = db_row(
            conn,
            "SELECT location FROM reading_progress ORDER BY updated_at DESC LIMIT 1",
        );
        let v: serde_json::Value = serde_json::from_str(&latest[0][0]).unwrap();
        assert_eq!(v["chapterId"], "ch-1");
        assert_eq!(v["progress"], 0.5);
    }

    let _ = title;
}
