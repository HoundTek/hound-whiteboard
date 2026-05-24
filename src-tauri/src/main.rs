#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

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

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![io_bridge_call])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
