/**
 * @file 关窗销毁
 * @description 窗口关闭前销毁 BoardCore（停止 owner RPC 并释放 claim），销毁失败或超时不阻塞关窗。
 * @module demo/config/graceful-shutdown
 * @author Zhou Chenyu
 */

/**
 * 关窗销毁的最长等待时长（毫秒）
 * @description 防止 destroyBoard 挂起卡死关窗；stop_owner_rpc 与 journaler detach
 * 都可能等待 IO，此处外层兜 3s。
 * @type {number}
 */
const CLOSE_DESTROY_TIMEOUT_MS = 3000;

/**
 * 安装关窗销毁钩子
 * @param {{ destroyBoard: Function }} boardApi - BoardApiRpc 实例
 * @param {{ tauriAvailable?: boolean, closeTimeoutMs?: number }} [options={}] - 运行环境与超时配置
 * @returns {Promise<void>} 钩子注册完成
 *
 * @description
 * Tauri 桌面端：拦下 close-requested 事件，先销毁 BoardCore（停止 owner RPC 并释放
 * claim）再真正关窗。web 端（浏览器 demo）仅能挂 beforeunload 尽力而为，页面销毁不保证
 * 异步完成；宿主进程被强杀（^C 等）时 claim 端口探测会判 stale，下次开板可回收。
 */
async function installGracefulShutdown(boardApi, options = {}) {
  const { tauriAvailable = false, closeTimeoutMs = CLOSE_DESTROY_TIMEOUT_MS } =
    options;

  if (!tauriAvailable) {
    globalThis.addEventListener?.("beforeunload", () => {
      void boardApi.destroyBoard();
    });
    return;
  }

  // 无打包器（frontendDist 直出原始 ESM），不能用裸说明符 import @tauri-apps/api；
  // withGlobalTauri: true 已注入 window.__TAURI__ 全局，直接读取
  const getCurrentWindow = globalThis.__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrentWindow !== "function") {
    // 全局缺失时降级 beforeunload 尽力销毁（与 web 分支同语义）
    globalThis.addEventListener?.("beforeunload", () => {
      void boardApi.destroyBoard();
    });
    return;
  }
  const appWindow = getCurrentWindow();
  // 重入保护：放行自身 close() 再次触发的 close-requested，避免无限拦截
  let closing = false;
  await appWindow.onCloseRequested(async (event) => {
    if (closing) return;
    closing = true;
    event.preventDefault();
    let timer = null;
    try {
      await Promise.race([
        boardApi.destroyBoard(),
        new Promise((resolve) => {
          timer = setTimeout(resolve, closeTimeoutMs);
        }),
      ]);
    } catch {
      // 销毁失败不阻塞关窗
    } finally {
      clearTimeout(timer);
    }
    await appWindow.close();
  });
}

export { installGracefulShutdown };
