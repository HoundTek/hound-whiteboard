use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct IOBridgeRequest {
  target: serde_json::Value,
  method: String,
  args: Option<Vec<serde_json::Value>>,
}

#[tauri::command]
fn io_bridge_call(request: IOBridgeRequest) -> Result<serde_json::Value, String> {
  let method = request.method;
  let args = request.args.unwrap_or_default();

  log::info!("IO Bridge call: {} with {} args", method, args.len());

  Ok(serde_json::json!({
    "result": "ok",
    "method": method,
    "args": args
  }))
}

// Tauri 2.0: 移动端入口点
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![io_bridge_call])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}