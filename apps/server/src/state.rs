//! 服务端状态与初始化（配置、SQLite 池、目录布局、配对码）。

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState(pub Arc<Inner>);

pub struct Inner {
    pub db: SqlitePool,
    pub data_dir: PathBuf,
    /// 首次启动生成并持久化到 data/pairing-code.txt；客户端用它换取设备 token
    pub pairing_code: String,
}

impl AppState {
    pub fn db(&self) -> &SqlitePool {
        &self.0.db
    }
    pub fn files_dir(&self) -> PathBuf {
        self.0.data_dir.join("files")
    }
    pub fn pairing_code(&self) -> &str {
        &self.0.pairing_code
    }
}

pub struct ServerConfig {
    pub bind: String,
    pub data_dir: PathBuf,
    pub pairing_code: Option<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: "0.0.0.0:8730".into(),
            data_dir: PathBuf::from("data"),
            pairing_code: None,
        }
    }
}

impl ServerConfig {
    pub fn from_env() -> Self {
        let mut cfg = Self::default();
        if let Ok(v) = std::env::var("BOOKVAULT_BIND") {
            cfg.bind = v;
        }
        if let Ok(v) = std::env::var("BOOKVAULT_DATA_DIR") {
            cfg.data_dir = PathBuf::from(v);
        }
        if let Ok(v) = std::env::var("BOOKVAULT_PAIRING_CODE") {
            cfg.pairing_code = Some(v);
        }
        cfg
    }
}

/// 初始化目录、数据库（含版本化 migration）与配对码
pub async fn init_state(cfg: &ServerConfig) -> Result<AppState, Box<dyn std::error::Error>> {
    fs::create_dir_all(cfg.data_dir.join("files"))?;
    fs::create_dir_all(cfg.data_dir.join("db"))?;

    let db_path = cfg.data_dir.join("db").join("bookvault.db");
    let opts = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(opts)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let pairing_code = match &cfg.pairing_code {
        Some(code) => code.clone(),
        None => {
            let file = cfg.data_dir.join("pairing-code.txt");
            if file.exists() {
                fs::read_to_string(&file)?.trim().to_string()
            } else {
                use rand::RngCore;
                let mut bytes = [0u8; 6];
                rand::rng().fill_bytes(&mut bytes);
                let code = hex::encode(bytes).to_uppercase();
                fs::write(&file, &code)?;
                code
            }
        }
    };
    println!("[bookvault] pairing code: {pairing_code}");

    Ok(AppState(Arc::new(Inner {
        db: pool,
        data_dir: cfg.data_dir.clone(),
        pairing_code,
    })))
}

/// 启动入口（bin 用；测试直接用 build_router + init_state）
pub fn run(cfg: ServerConfig) {
    let rt = tokio::runtime::Runtime::new().expect("create tokio runtime");
    rt.block_on(async move {
        let state = init_state(&cfg).await.expect("init server state");
        let app = crate::build_router(state);
        let listener = tokio::net::TcpListener::bind(&cfg.bind)
            .await
            .expect("bind");
        println!(
            "[bookvault] listening on http://{}",
            listener.local_addr().unwrap()
        );
        axum::serve(listener, app).await.expect("server error");
    });
}
