/**
 * @file IO invoke 转发器（主线程侧）
 * @description 监听 worker 的 io-invoke 消息，经 Tauri invoke 执行后回传 io-response；worker 内驱动由此间接到达 Rust 可信执行面。
 * @module host/bridges/io-invoke-forwarder
 * @author Zhou Chenyu
 */

/**
 * 解析主线程可用的 Tauri invoke
 * @returns {Function} invoke 函数
 * @throws {Error} 当前环境没有 Tauri invoke
 */
function resolveTauriInvoke() {
  if (typeof window !== "undefined") {
    const core = window.__TAURI__?.core;
    if (typeof core?.invoke === "function") return core.invoke.bind(core);
    const internals = window.__TAURI_INTERNALS__;
    if (typeof internals?.invoke === "function") {
      return internals.invoke.bind(internals);
    }
  }
  throw new Error("[io-forwarder] Tauri invoke unavailable on main thread.");
}

/**
 * 挂接 IO invoke 转发器
 * @param {{ postMessage: Function, addEventListener: Function, removeEventListener: Function }} endpoint - Worker 端点
 * @param {Function} [invoke] - invoke 实现（默认在首个 io-invoke 到达时解析主线程 Tauri invoke）
 * @returns {() => void} 卸接函数
 *
 * @description
 * Tauri invoke 惰性解析：内存模式永不触发 io-invoke，无 Tauri 环境下挂接无害。
 */
function attachIoInvokeForwarder(endpoint, invoke) {
  /**
   * 处理 worker 的 io-invoke 请求
   * @param {MessageEvent | { data?: any }} event - 消息事件
   * @returns {void}
   */
  const listener = (event) => {
    const message = event?.data;
    if (!message || message.type !== "io-invoke") return;
    const { msgId, command, args } = message;
    Promise.resolve()
      .then(() => (invoke ?? resolveTauriInvoke())(command, args))
      .then((result) => {
        endpoint.postMessage({ type: "io-response", msgId, ok: true, result });
      })
      .catch((error) => {
        endpoint.postMessage({
          type: "io-response",
          msgId,
          ok: false,
          error: error?.message ?? String(error),
        });
      });
  };
  endpoint.addEventListener("message", listener);
  return () => endpoint.removeEventListener("message", listener);
}

export { attachIoInvokeForwarder, resolveTauriInvoke };
