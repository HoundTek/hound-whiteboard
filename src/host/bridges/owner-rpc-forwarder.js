/**
 * @file Owner RPC 转发器（主线程侧）
 * @description 监听 Tauri 的 owner-rpc-request 事件并转给 worker，把 worker 响应回传 Rust。
 * @module host/bridges/owner-rpc-forwarder
 * @author Zhou Chenyu
 */

import { resolveTauriInvoke } from "./io-invoke-forwarder.js";

/**
 * 解析主线程可用的 Tauri event.listen
 * @returns {Function|null} listen 函数；非 Tauri 环境为 null
 */
function resolveTauriListen() {
  if (typeof window === "undefined") return null;
  const event = window.__TAURI__?.event;
  if (typeof event?.listen === "function") return event.listen.bind(event);
  return null;
}

/**
 * 挂接 owner RPC 转发器
 * @param {{ postMessage: Function, addEventListener: Function, removeEventListener: Function }} endpoint - Worker 端点
 * @param {{ listen?: Function, invoke?: Function }} [deps={}] - 测试注入的依赖
 * @returns {() => void} 卸接函数
 *
 * @description
 * Tauri event/invoke 惰性解析；非 Tauri 环境或事件 API 不可用时挂接为空操作。
 */
function attachOwnerRpcForwarder(endpoint, deps = {}) {
  const listen = deps.listen ?? resolveTauriListen();
  if (typeof listen !== "function") {
    return () => {};
  }

  let unlisten = null;
  let disposed = false;

  const handleRequest = (event) => {
    const payload = event?.payload;
    if (!payload || typeof payload !== "object") return;
    endpoint.postMessage({
      type: "owner-rpc-request",
      requestId: payload.requestId,
      route: payload.route,
      params: payload.params,
      source: payload.source,
    });
  };

  const responseListener = (event) => {
    const message = event?.data;
    if (!message || message.type !== "owner-rpc-response") return;
    const invoke = deps.invoke ?? resolveTauriInvoke();
    Promise.resolve()
      .then(() =>
        invoke("owner_rpc_respond", {
          requestId: message.requestId,
          ok: message.ok === true,
          result: message.result,
          error: message.error,
        }),
      )
      .catch((error) => {
        console.error(
          `[owner-rpc-forwarder] 回传响应失败：${error?.message ?? error}`,
        );
      });
  };

  endpoint.addEventListener("message", responseListener);
  Promise.resolve(listen("owner-rpc-request", handleRequest))
    .then((dispose) => {
      if (typeof dispose === "function") unlisten = dispose;
      if (disposed && unlisten) unlisten();
    })
    .catch((error) => {
      console.error(
        `[owner-rpc-forwarder] 监听 owner-rpc-request 失败：${error?.message ?? error}`,
      );
    });

  return () => {
    if (disposed) return;
    disposed = true;
    endpoint.removeEventListener("message", responseListener);
    if (typeof unlisten === "function") {
      unlisten();
      unlisten = null;
    }
  };
}

export { attachOwnerRpcForwarder, resolveTauriListen };
