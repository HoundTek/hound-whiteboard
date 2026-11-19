//! 板目录 owner RPC 端点
//!
//! GUI 作为板目录 owner 时：
//! - 在板目录写 `.owner.json`（`kind: "gui"` + host/port/token）
//! - 在 127.0.0.1 上开本地 WebSocket，把 CLI/daemon 请求转给 WebView 里的 BoardApi
//! - 关闭板时停止监听并释放 claim

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::net::{SocketAddr, TcpStream as StdTcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};
use tokio_tungstenite::{tungstenite::Message, WebSocketStream};
use uuid::Uuid;

use crate::commands::registry::expand_home;

const OWNER_FILE: &str = ".owner.json";
const OWNER_LOCK_FILE: &str = ".owner.lock";
const OWNER_LOCK_MAX_ATTEMPTS: usize = 20;
const OWNER_LOCK_RETRY_MS: u64 = 50;
const OWNER_RPC_TIMEOUT: Duration = Duration::from_secs(30);

/// owner RPC 请求的响应
struct OwnerRpcResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

struct OwnerRpcHandle {
    owner_id: String,
    board_path: PathBuf,
    task: tauri::async_runtime::JoinHandle<()>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<OwnerRpcResponse>>>>,
}

/// owner RPC 全局状态（一个 app 同时只持有一块板）
#[derive(Default)]
pub struct OwnerRpcState {
    inner: Mutex<Option<OwnerRpcHandle>>,
}

/// start_owner_rpc 返回的端点信息
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerRpcInfo {
    owner_id: String,
    host: String,
    port: u16,
    token: String,
}

/// 板目录下的 owner claim 路径
fn owner_file(board_path: &Path) -> PathBuf {
    board_path.join(OWNER_FILE)
}

/// 板目录下的 owner 锁路径
fn owner_lock_file(board_path: &Path) -> PathBuf {
    board_path.join(OWNER_LOCK_FILE)
}

/// 读取 owner claim
fn read_claim(board_path: &Path) -> Option<Value> {
    let text = fs::read_to_string(owner_file(board_path)).ok()?;
    serde_json::from_str(&text).ok()
}

/// 判断端口是否有活连接
fn port_alive(port: u16) -> bool {
    if port == 0 {
        return false;
    }
    let Ok(addr) = format!("127.0.0.1:{port}").parse::<SocketAddr>() else {
        return false;
    };
    StdTcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// 判断 claim 是否仍存活
fn claim_is_live(claim: &Value) -> bool {
    let port = claim
        .get("transport")
        .and_then(|transport| transport.get("port"))
        .and_then(Value::as_u64);
    match port {
        Some(port) if port > 0 && port <= u64::from(u16::MAX) => {
            port_alive(port as u16)
        }
        _ => false,
    }
}

/// 抢 owner 锁
fn acquire_owner_lock(board_path: &Path) -> Result<(), String> {
    let lock_path = owner_lock_file(board_path);
    for _ in 0..OWNER_LOCK_MAX_ATTEMPTS {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                let _ = write!(file, "{}", std::process::id());
                return Ok(());
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if let Some(claim) = read_claim(board_path) {
                    if claim_is_live(&claim) {
                        return Err("板目录已被其他持有者认领".to_string());
                    }
                }
                // 无活 claim 的残留锁：回收后重试
                let _ = fs::remove_file(&lock_path);
                std::thread::sleep(Duration::from_millis(OWNER_LOCK_RETRY_MS));
            }
            Err(error) => {
                return Err(format!("无法创建 owner 锁：{error}"));
            }
        }
    }
    Err("owner 锁竞争失败".to_string())
}

/// 释放 owner 锁
fn release_owner_lock(board_path: &Path) {
    let _ = fs::remove_file(owner_lock_file(board_path));
}

/// 原子写入 owner claim
fn write_claim(board_path: &Path, claim: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(claim)
        .map_err(|error| format!("序列化 owner claim 失败：{error}"))?;
    let tmp = board_path.join(format!(
        "{OWNER_FILE}.tmp-{}-{}",
        std::process::id(),
        Uuid::new_v4()
    ));
    let result = (|| -> std::io::Result<()> {
        fs::write(&tmp, text)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        }
        fs::rename(&tmp, owner_file(board_path))?;
        Ok(())
    })()
    .map_err(|error| format!("写入 owner claim 失败：{error}"));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// 按 ownerId 删除 claim
fn remove_claim_if_owner(board_path: &Path, owner_id: &str) -> bool {
    let Some(claim) = read_claim(board_path) else {
        return false;
    };
    if claim.get("ownerId").and_then(Value::as_str) != Some(owner_id) {
        return false;
    }
    fs::remove_file(owner_file(board_path)).is_ok()
}

/// 启动 owner RPC 端点并 claim 板目录
#[tauri::command]
pub async fn start_owner_rpc(
    app: AppHandle,
    state: State<'_, OwnerRpcState>,
    path: String,
    source: String,
    board_id: Option<String>,
    claimed_at: String,
) -> Result<OwnerRpcInfo, String> {
    let expanded = expand_home(&path)?;
    let board_path = PathBuf::from(expanded);
    {
        let guard = state.inner.lock().await;
        if guard.is_some() {
            return Err("owner RPC 已在运行".to_string());
        }
    }

    acquire_owner_lock(&board_path)?;
    if let Some(claim) = read_claim(&board_path) {
        if claim_is_live(&claim) {
            release_owner_lock(&board_path);
            return Err("板目录已被其他持有者认领".to_string());
        }
    }

    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(listener) => listener,
        Err(error) => {
            release_owner_lock(&board_path);
            return Err(format!("绑定 owner RPC 端口失败：{error}"));
        }
    };
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(error) => {
            release_owner_lock(&board_path);
            return Err(format!("读取 owner RPC 端口失败：{error}"));
        }
    };
    let owner_id = Uuid::new_v4().to_string();
    let token = Uuid::new_v4().to_string();
    let claimed_at = if claimed_at.trim().is_empty() {
        "unknown".to_string()
    } else {
        claimed_at
    };
    let claim = json!({
        "ownerId": owner_id,
        "pid": std::process::id(),
        "source": source,
        "boardId": board_id,
        "transport": {
            "kind": "gui",
            "host": "127.0.0.1",
            "port": port,
            "token": token,
        },
        "claimedAt": claimed_at,
    });
    if let Err(error) = write_claim(&board_path, &claim) {
        release_owner_lock(&board_path);
        return Err(error);
    }
    release_owner_lock(&board_path);

    let pending = Arc::new(Mutex::new(HashMap::new()));
    let task = tauri::async_runtime::spawn(server_loop(
        app,
        listener,
        token.clone(),
        pending.clone(),
    ));
    let mut guard = state.inner.lock().await;
    *guard = Some(OwnerRpcHandle {
        owner_id: owner_id.clone(),
        board_path,
        task,
        pending,
    });
    Ok(OwnerRpcInfo {
        owner_id,
        host: "127.0.0.1".to_string(),
        port,
        token,
    })
}

/// 停止 owner RPC 端点并释放 claim
#[tauri::command]
pub async fn stop_owner_rpc(
    state: State<'_, OwnerRpcState>,
    owner_id: String,
) -> Result<bool, String> {
    let handle = {
        let mut guard = state.inner.lock().await;
        guard.take()
    };
    let Some(handle) = handle else {
        return Ok(false);
    };
    if handle.owner_id != owner_id {
        let mut guard = state.inner.lock().await;
        *guard = Some(handle);
        return Ok(false);
    }
    handle.task.abort();
    Ok(remove_claim_if_owner(&handle.board_path, &owner_id))
}

/// 把 WebView 的响应回给等待中的 WS 请求
#[tauri::command]
pub async fn owner_rpc_respond(
    state: State<'_, OwnerRpcState>,
    request_id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    let pending = {
        let guard = state.inner.lock().await;
        guard.as_ref().map(|handle| handle.pending.clone())
    };
    let Some(pending) = pending else {
        return Err("owner RPC 未运行".to_string());
    };
    let sender = pending.lock().await.remove(&request_id);
    if let Some(sender) = sender {
        sender
            .send(OwnerRpcResponse { ok, result, error })
            .map_err(|_| "owner RPC 请求已结束".to_string())?;
    }
    Ok(())
}

/// WS 接受循环
async fn server_loop(
    app: AppHandle,
    listener: TcpListener,
    token: String,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<OwnerRpcResponse>>>>,
) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            break;
        };
        let app = app.clone();
        let token = token.clone();
        let pending = pending.clone();
        tauri::async_runtime::spawn(async move {
            handle_connection(app, stream, token, pending).await;
        });
    }
}

/// 处理单条 WS 连接
async fn handle_connection(
    app: AppHandle,
    stream: TcpStream,
    token: String,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<OwnerRpcResponse>>>>,
) {
    let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
        return;
    };

    let auth = match ws.next().await {
        Some(Ok(Message::Text(text))) => text.to_string(),
        _ => return,
    };
    let auth: Value = match serde_json::from_str(&auth) {
        Ok(value) => value,
        Err(_) => return,
    };
    if auth.get("token").and_then(Value::as_str) != Some(token.as_str()) {
        let _ = ws.close(None).await;
        return;
    }
    let _ = send_json(&mut ws, &json!({ "ok": true })).await;

    while let Some(message) = ws.next().await {
        let Ok(Message::Text(text)) = message else {
            continue;
        };
        let Ok(request) = serde_json::from_str::<Value>(text.as_str()) else {
            continue;
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let Some(route) = request.get("route").and_then(Value::as_str) else {
            let _ = send_json(
                &mut ws,
                &json!({ "id": id, "ok": false, "error": "缺少 route" }),
            )
            .await;
            continue;
        };
        let params = request.get("params").cloned().unwrap_or(Value::Null);
        let source = request
            .get("source")
            .and_then(Value::as_str)
            .map(str::to_string);
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        pending.lock().await.insert(request_id.clone(), tx);
        let emitted = app.emit(
            "owner-rpc-request",
            json!({
                "requestId": request_id,
                "route": route,
                "params": params,
                "source": source,
            }),
        );
        if emitted.is_err() {
            pending.lock().await.remove(&request_id);
            let _ = send_json(
                &mut ws,
                &json!({ "id": id, "ok": false, "error": "WebView 不可用" }),
            )
            .await;
            continue;
        }
        match tokio::time::timeout(OWNER_RPC_TIMEOUT, rx).await {
            Ok(Ok(response)) => {
                let _ = send_json(
                    &mut ws,
                    &json!({
                        "id": id,
                        "ok": response.ok,
                        "result": response.result,
                        "error": response.error,
                    }),
                )
                .await;
            }
            _ => {
                pending.lock().await.remove(&request_id);
                let _ = send_json(
                    &mut ws,
                    &json!({ "id": id, "ok": false, "error": "owner RPC 超时" }),
                )
                .await;
            }
        }
    }
}

/// 发送一条 JSON 文本帧
async fn send_json(ws: &mut WebSocketStream<TcpStream>, value: &Value) -> Result<(), ()> {
    ws.send(Message::Text(value.to_string().into()))
        .await
        .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claim_roundtrip_and_owner_scoped_removal() {
        let dir = std::env::temp_dir().join(format!("hwb-owner-rpc-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        acquire_owner_lock(&dir).unwrap();
        let claim = json!({
            "ownerId": "owner-1",
            "pid": std::process::id(),
            "source": "gui-test",
            "boardId": null,
            "transport": {
                "kind": "gui",
                "host": "127.0.0.1",
                "port": 1,
                "token": "token-1",
            },
            "claimedAt": "2026-11-19T00:00:00.000Z",
        });
        write_claim(&dir, &claim).unwrap();
        release_owner_lock(&dir);

        let stored = read_claim(&dir).unwrap();
        assert_eq!(stored["ownerId"], "owner-1");
        assert_eq!(stored["transport"]["kind"], "gui");
        assert!(!remove_claim_if_owner(&dir, "other-owner"));
        assert!(remove_claim_if_owner(&dir, "owner-1"));
        assert!(read_claim(&dir).is_none());

        let _ = fs::remove_dir_all(&dir);
    }
}
