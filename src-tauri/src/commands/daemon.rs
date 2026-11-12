//! 板 daemon 进程管理 command
//!
//! 职责：
//! - 板不存在时创建骨架（board.json + 目录布局），随后 spawn 持板 daemon 进程
//! - 轮询板目录 `.daemon.json` 直到 daemon 就绪（端口已写入）
//! - 返回 { name, port }，供 GUI 经协作通道连接

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

/// spawn_board_daemon 的返回
#[derive(Serialize)]
pub struct SpawnDaemonResult {
    pub name: String,
    pub port: u16,
}

/// daemon 进程入口（相对本 crate 源码目录的 start-daemon.js）
const START_DAEMON_JS: &str = "../src/cli/start-daemon.js";

/// 轮询板目录 .daemon.json 直到出现端口字段
fn wait_for_daemon(board_path: &Path, timeout: Duration) -> Option<u16> {
    let daemon_file = board_path.join(".daemon.json");
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Ok(text) = fs::read_to_string(&daemon_file) {
            if let Ok(desc) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(port) = desc.get("port").and_then(|p| p.as_u64()) {
                    if port > 0 && port <= u64::from(u16::MAX) {
                        return Some(port as u16);
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(200));
    }
    None
}

/// 默认区块边长（世界单位），与 kernel 侧 DEFAULT_CHUNK_SIZE 保持一致
const DEFAULT_CHUNK_SIZE: f64 = 1024.0;

/// 归一化区块边长（非正数或缺失时回退默认值）
fn normalize_chunk_size(size: Option<f64>) -> f64 {
    match size {
        Some(value) if value.is_finite() && value > 0.0 => value,
        _ => DEFAULT_CHUNK_SIZE,
    }
}

/// 板不存在时创建骨架（board.json + 目录布局）
/// width / height 是区块边长（决定盘上区块划分），不是板尺寸：世界无限
fn ensure_board_skeleton(board_path: &Path, width: Option<f64>, height: Option<f64>) {
    let meta_file = board_path.join("board.json");
    if meta_file.exists() {
        return;
    }
    let _ = fs::create_dir_all(board_path.join("objects"));
    let _ = fs::create_dir_all(board_path.join("trash"));
    let _ = fs::create_dir_all(board_path.join("hit"));
    let _ = fs::create_dir_all(board_path.join("chunks"));
    let meta = serde_json::json!({
        "formatVersion": 1,
        "lastTime": 0,
        "nextSegmentSeq": 1,
        // 区块边长始终写入：重开时按盘上值决定区块划分
        "boardConfig": {
            "width": normalize_chunk_size(width),
            "height": normalize_chunk_size(height),
        },
    });
    let _ = fs::write(&meta_file, serde_json::to_string_pretty(&meta).unwrap_or_default());
}

/// 探测本机端口上是否有活 daemon（TCP 短连接）
fn port_alive(port: u16) -> bool {
    use std::net::TcpStream;
    let addr = format!("127.0.0.1:{port}");
    let Ok(addr) = addr.parse() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// 拉起板 daemon 进程并等待就绪（幂等：已有活 daemon 直接返回现有实例）
#[tauri::command]
pub async fn spawn_board_daemon(
    path: String,
    name: String,
    source: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<SpawnDaemonResult, String> {
    // 同步命令会在主线程执行（15s 就绪轮询会卡死 UI 与 IPC 泵送），
    // 改为阻塞线程池执行，主线程保持响应
    let path = crate::commands::registry::expand_home(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        spawn_board_daemon_blocking(path, name, source, width, height)
    })
    .await
    .map_err(|e| format!("daemon 启动任务失败：{e}"))?
}

/// 建骨架、拉起持板 daemon 进程并轮询就绪（在阻塞线程池执行）
fn spawn_board_daemon_blocking(
    path: String,
    name: String,
    source: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<SpawnDaemonResult, String> {
    let board_path = Path::new(&path);
    // 幂等探测：板目录已有活 daemon（描述端口可连通）则直接返回，不重复拉起
    if let Ok(text) = fs::read_to_string(board_path.join(".daemon.json")) {
        if let Ok(desc) = serde_json::from_str::<serde_json::Value>(&text) {
            let port = desc.get("port").and_then(|p| p.as_u64());
            let existing = desc
                .get("name")
                .and_then(|n| n.as_str())
                .map(String::from);
            if let (Some(port), Some(existing)) = (port, existing) {
                if port > 0 && port <= u64::from(u16::MAX) && port_alive(port as u16) {
                    return Ok(SpawnDaemonResult {
                        name: existing,
                        port: port as u16,
                    });
                }
            }
        }
    }
    // 板目录不存在时先建目录再建骨架（board.json + 目录布局）
    fs::create_dir_all(board_path).map_err(|e| format!("创建板目录失败：{}（{e}）", path))?;
    ensure_board_skeleton(board_path, width, height);

    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let daemon_js = Path::new(manifest_dir)
        .join(START_DAEMON_JS)
        .canonicalize()
        .map_err(|e| format!("无法定位 daemon 进程入口：{e}"))?;

    let mut cmd = Command::new("node");
    cmd.arg(&daemon_js)
        .arg("--name")
        .arg(&name)
        .arg("--path")
        .arg(&path);
    if let Some(source) = &source {
        if !source.is_empty() {
            cmd.arg("--source").arg(source);
        }
    }
    // 脱离父进程：GUI 关闭后 daemon 常驻（引用计数 release 才回收）
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("daemon 进程启动失败（需要 node 在 PATH）：{e}"))?;
    drop(child);

    let port = wait_for_daemon(&board_path, Duration::from_secs(15))
        .ok_or_else(|| format!("daemon {name} 启动超时（15s 内未就绪）"))?;
    Ok(SpawnDaemonResult { name, port })
}
