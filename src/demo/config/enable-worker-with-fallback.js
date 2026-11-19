/**
 * @file worker 模式装配（含内存回退）
 * @description 带持久化的开板失败时清空 rootPath 并以新 worker 回退内存模式重试。
 * @module demo/config/enable-worker-with-fallback
 * @author Zhou Chenyu
 */

/**
 * 判断是否为板目录 owner 冲突
 * @param {Error} error - 开板错误
 * @returns {boolean} 是否属于 owner 冲突（不应回退内存模式）
 */
function isOwnerConflictError(error) {
  const message = error?.message ?? String(error ?? "");
  return (
    message.includes("已被其他持有者认领") ||
    message.includes("owner RPC 已在运行") ||
    message.includes("已被 GUI 持有")
  );
}

/**
 * 装配 worker 模式，持久化开板失败时回退内存模式
 * @param {{ rootPath?: string, enableWorkerMode: Function }} board - UI 侧 Board
 * @param {() => { terminate?: Function }} createWorker - worker 工厂（每次调用须返回新实例）
 * @param {{ onFallback?: (error: Error) => void }} [options={}] - 回退钩子（告警用）
 * @returns {Promise<{ terminate?: Function }>} 已就绪的 worker
 *
 * @description
 * 持久化首开可能因目录不可创建等失败；此时清空 rootPath 换新 worker
 * 以内存模式重试（板面功能照常，数据仅存续于本会话，relay 同步不受影响）。
 * owner 冲突（板已被其他持有者认领）不回退：静默切内存会让用户以为在编辑同一块板。
 * 内存模式本身的失败没有回退余地，直接抛出。回退必须换新 worker：
 * 超时时旧 worker 内的 createBoard 可能仍在推进，状态不可复用。
 */
async function enableWorkerWithFallback(board, createWorker, options = {}) {
  let worker = createWorker();
  let fallbackError = null;
  try {
    await board.enableWorkerMode(worker);
    return worker;
  } catch (error) {
    worker.terminate?.();
    if (!board.rootPath || isOwnerConflictError(error)) {
      throw error;
    }
    fallbackError = error;
  }
  options.onFallback?.(fallbackError);
  board.rootPath = undefined;
  worker = createWorker();
  try {
    await board.enableWorkerMode(worker);
    return worker;
  } catch (retryError) {
    worker.terminate?.();
    throw retryError;
  }
}

export { enableWorkerWithFallback };
