//! M3 集成测试：配对 → 入库 → 流式上传 → 下载（含 Range）→ 目录解析 → 进度同步 →
//! 游标增量 → 未授权拒绝。用 tower oneshot 直连 router（无网络依赖）。

use axum::body::Body;
use axum::http::{Request, StatusCode};
use bookvault_server::build_router;
use bookvault_server::state::{init_state, ServerConfig};
use http_body_util::BodyExt;
use serde_json::json;
use std::path::PathBuf;

async fn setup() -> (axum::Router, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let cfg = ServerConfig {
        bind: "127.0.0.1:0".into(),
        data_dir: dir.keep(),
        pairing_code: Some("TESTCODE".into()),
    };
    let state = init_state(&cfg).await.unwrap();
    (build_router(state), cfg.data_dir)
}

async fn call(router: &axum::Router, req: Request<Body>) -> (StatusCode, Vec<u8>) {
    let resp = tower::ServiceExt::oneshot(router.clone(), req)
        .await
        .unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, bytes.to_vec())
}

fn pair_req() -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/v1/devices/pair")
        .header("content-type", "application/json")
        .header("x-pairing-code", "TESTCODE")
        .body(Body::from(r#"{"name":"test-device"}"#))
        .unwrap()
}

#[tokio::test]
async fn full_library_flow() {
    let (router, _data) = setup().await;

    // 未授权拒绝
    let (st, _) = call(
        &router,
        Request::builder()
            .uri("/api/v1/library/items")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);

    // 错误配对码拒绝
    let bad = Request::builder()
        .method("POST")
        .uri("/api/v1/devices/pair")
        .header("content-type", "application/json")
        .header("x-pairing-code", "WRONG")
        .body(Body::from(r#"{"name":"x"}"#))
        .unwrap();
    let (st, _) = call(&router, bad).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);

    // 配对
    let (st, body) = call(&router, pair_req()).await;
    assert_eq!(st, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let paired: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = paired["token"].as_str().unwrap().to_string();
    let device_id = paired["deviceId"].as_str().unwrap().to_string();

    // upsert 作品/版本/文件元数据
    let item = json!({
        "work": {"id": "w1", "title": "样例小说", "authors": ["作者甲"], "language": "zh", "identifiers": {}},
        "edition": {"id": "e1", "workId": "w1", "label": "默认版本", "source": null, "language": null},
        "file": {"id": "f1", "editionId": "e1", "sha256": "0".repeat(64), "size": 10, "format": "txt", "name": "sample.txt"}
    });
    let (st, body) = call(
        &router,
        authed("POST", "/api/v1/library/items", &token, &item),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::NO_CONTENT,
        "{}",
        String::from_utf8_lossy(&body)
    );

    // 书库列表
    let (st, body) = call(
        &router,
        authed("GET", "/api/v1/library/items", &token, &json!(null)),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let items: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(items[0]["work"]["title"], "样例小说");
    assert_eq!(items[0]["editions"][0]["id"], "e1");
    assert_eq!(items[0]["files"][0]["id"], "f1");

    // 上传真实内容（构造一个迷你 TXT）
    let content = "第一章 测试\n\n书山有路勤为径。\n";
    let sha = {
        use sha2::Digest;
        let d = sha2::Sha256::digest(content.as_bytes());
        hex::encode(d)
    };
    let up_uri = format!(
        "/api/v1/library/files/f1/content?sha256={sha}&size={}&format=txt&editionId=e1&name=sample.txt",
        content.len()
    );
    let req = Request::builder()
        .method("POST")
        .uri(&up_uri)
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(content))
        .unwrap();
    let (st, body) = call(&router, req).await;
    assert_eq!(st, StatusCode::OK, "{}", String::from_utf8_lossy(&body));

    // 哈希不符拒绝
    let bad_uri = format!(
        "/api/v1/library/files/f2/content?sha256={}&size={}&format=txt&editionId=e1&name=b.txt",
        "a".repeat(64),
        content.len()
    );
    let req = Request::builder()
        .method("POST")
        .uri(&bad_uri)
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(content))
        .unwrap();
    let (st, _) = call(&router, req).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // 下载整文件：哈希一致
    let req = Request::builder()
        .uri("/api/v1/library/files/f1/content")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let (st, body) = call(&router, req).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body, content.as_bytes());

    // Range 请求（断点续传基础）
    let req = Request::builder()
        .uri("/api/v1/library/files/f1/content")
        .header("authorization", format!("Bearer {token}"))
        .header("range", "bytes=4-9")
        .body(Body::empty())
        .unwrap();
    let (st, body) = call(&router, req).await;
    assert_eq!(st, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, &content.as_bytes()[4..=9]);

    // 服务端解析目录（复用 bv-formats）
    let req = Request::builder()
        .uri("/api/v1/library/items/w1/contents?fileId=f1")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let (st, body) = call(&router, req).await;
    assert_eq!(st, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let contents: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(contents["kind"], "txt");
    assert_eq!(
        contents["contents"]["novel"]["chapters"][0]["title"],
        "第一章 测试"
    );

    // 进度上传 + 变更流 + 游标
    let progress = json!({
        "fileId": "f1", "contentSha256": sha,
        "location": {"type": "chapter", "chapterId": "ch-0", "progress": 0.5},
        "updatedAt": 1700000000000i64
    });
    let (st, body) = call(
        &router,
        authed("POST", "/api/v1/progress", &token, &progress),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::NO_CONTENT,
        "{}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/v1/sync/changes?cursor=0")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let (st, body) = call(&router, req).await;
    assert_eq!(st, StatusCode::OK);
    let changes: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let list = changes["changes"].as_array().unwrap();
    assert!(!list.is_empty(), "change_log must record upserts");
    let entities: Vec<&str> = list.iter().map(|c| c["entity"].as_str().unwrap()).collect();
    assert!(entities.contains(&"work"));
    assert!(entities.contains(&"file"));
    assert!(entities.contains(&"progress"));
    let next = changes["nextCursor"].as_i64().unwrap();

    // 游标推进：cursor=next 后无新增
    let req = Request::builder()
        .uri(format!("/api/v1/sync/changes?cursor={next}"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let (st, body) = call(&router, req).await;
    assert_eq!(st, StatusCode::OK);
    let changes: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(changes["changes"].as_array().unwrap().len(), 0);

    // ack
    let (st, _) = call(
        &router,
        authed(
            "POST",
            "/api/v1/sync/ack",
            &token,
            &json!({"lastSeq": next}),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);

    // 设备列表与撤销
    let (st, body) = call(
        &router,
        authed("GET", "/api/v1/devices", &token, &json!(null)),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let devices: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(devices[0]["id"], device_id);

    let _ = device_id;
}

fn authed(method: &str, uri: &str, token: &str, body: &serde_json::Value) -> Request<Body> {
    let b = if body.is_null() {
        Body::empty()
    } else {
        Body::from(body.to_string())
    };
    Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(b)
        .unwrap()
}
