/**
 * @file Core Worker 入口
 * @description
 * 提供 Core Worker 的入口与运行时封装。
 * Worker 侧仅持有 BoardCore / BoardApi 等纯 Core 模块，通过 JSON-RPC 风格的消息协议响应 UI 侧请求。
 * 当文件运行在真正的 WorkerGlobalScope 中时会自动启动；测试环境可通过导出的工厂手动创建 runtime。
 * @module core-worker
 * @author Zhou Chenyu
 */

import { BoardApi } from "./core/bridges/board-api.js";
import { createDefaultPersistenceAdapter } from "./core/bridges/persistence-adapter.js";
import { createDefaultAomRenderHooks } from "./core/components/orchestration/aom-render-hooks.js";
import { BoardCore } from "./core/components/orchestration/board-core.js";
import { Logger } from "./utils/log/logger.js";
import { logBus } from "./utils/log/log-bus.js";

/**
 * 判断值是否可作为 Worker 消息宿主
 * @param {*} host - 待判断宿主
 * @returns {boolean} 是否具备 message 监听与 postMessage 能力
 */
function isWorkerMessageHost(host) {
  return Boolean(
    host &&
    typeof host.postMessage === "function" &&
    typeof host.addEventListener === "function" &&
    typeof host.removeEventListener === "function",
  );
}

/**
 * 判断当前上下文是否为真正的 WorkerGlobalScope
 * @param {*} value - 待判断值
 * @returns {boolean} 是否位于 WorkerGlobalScope
 */
function isWorkerGlobalScopeInstance(value) {
  return Boolean(
    typeof WorkerGlobalScope !== "undefined" &&
    value instanceof WorkerGlobalScope,
  );
}

/**
 * Core Worker 运行时
 * @class
 * @description
 * 封装 Worker 线程的消息分发、BoardCore 生命周期与 RPC 路由。
 * 在 P3.2 阶段先接通 ready 握手、BoardCore 创建与 BoardApi 方法分发；
 * MonitorCore / MonitorProxy 与渲染帧消息在后续阶段继续补齐。
 * @author Zhou Chenyu
 */
class CoreWorkerRuntime {
  /**
   * Worker 消息宿主
   * @type {{ postMessage: Function, addEventListener: Function, removeEventListener: Function }}
   */
  #host;

  /**
   * 当前 BoardCore 实例
   * @type {BoardCore | null}
   */
  #boardCore;

  /**
   * 当前 Core 侧 BoardApi 实例
   * @type {BoardApi | null}
   */
  #boardApi;

  /**
   * 绑定后的消息监听器
   * @type {(event: MessageEvent | { data?: any }) => void}
   */
  #messageListener;

  /**
   * Worker 运行时 Logger
   * @type {Logger}
   */
  #log;

  /**
   * Worker 日志转发取消函数
   * @type {Function | null}
   */
  #offWorkerLogs;

  /**
   * runtime 是否已启动
   * @type {boolean}
   */
  #started;

  /**
   * @param {{ postMessage: Function, addEventListener: Function, removeEventListener: Function }} host - Worker 消息宿主
   */
  constructor(host) {
    if (!isWorkerMessageHost(host)) {
      throw new TypeError(
        "CoreWorkerRuntime requires a host with postMessage/addEventListener/removeEventListener.",
      );
    }

    this.#host = host;
    this.#boardCore = null;
    this.#boardApi = null;
    this.#messageListener = this.#handleMessageEvent.bind(this);
    this.#log = new Logger("CoreWorker", "INFO", logBus);
    this.#offWorkerLogs = null;
    this.#started = false;
  }

  /**
   * 启动 Worker runtime
   * @returns {CoreWorkerRuntime} 当前 runtime 实例
   */
  start() {
    if (this.#started) {
      return this;
    }

    this.#started = true;
    this.#host.addEventListener("message", this.#messageListener);
    this.#offWorkerLogs = logBus.onLevels(["WARN", "ERROR"], (entry) => {
      this.#postMessage({
        type: "worker-log",
        level: entry.level,
        logger: entry.logger,
        args: [...(entry.args ?? [])],
        meta: entry.meta ?? {},
        timestamp: entry.timestamp,
      });
    });
    this.#postMessage({ type: "ready" });
    return this;
  }

  /**
   * 停止 Worker runtime
   * @returns {void}
   */
  stop() {
    if (!this.#started) {
      return;
    }

    this.#host.removeEventListener("message", this.#messageListener);
    this.#offWorkerLogs?.();
    this.#offWorkerLogs = null;
    this.#boardApi = null;
    this.#boardCore = null;
    this.#started = false;
  }

  /**
   * 向宿主发送消息
   * @param {Object} message - 待发送消息
   * @param {Transferable[]} [transferList=[]] - 可转移对象列表
   * @returns {void}
   */
  #postMessage(message, transferList = []) {
    if (Array.isArray(transferList) && transferList.length > 0) {
      this.#host.postMessage(message, transferList);
      return;
    }

    this.#host.postMessage(message);
  }

  /**
   * 处理宿主消息事件
   * @param {MessageEvent | { data?: any }} event - 宿主消息事件
   * @returns {void}
   */
  #handleMessageEvent(event) {
    const message = event?.data;
    if (!message || typeof message !== "object") {
      return;
    }

    switch (message.type) {
      case "rpc":
        this.#handleRpcMessage(message);
        return;
      case "viewport-change":
        this.#handleViewportChange(message);
        return;
      case "request-render-flush":
        this.#handleRenderFlush(message);
        return;
      default:
        return;
    }
  }

  /**
   * 处理 RPC 请求消息
   * @param {{ msgId?: string, method?: string, params?: Record<string, any> }} message - RPC 请求消息
   * @returns {void}
   */
  #handleRpcMessage(message) {
    const msgId = message?.msgId;
    const method = message?.method;
    const params = message?.params ?? {};

    if (typeof msgId !== "string" || typeof method !== "string") {
      this.#log.warn("Ignoring malformed rpc message.", message);
      return;
    }

    try {
      const result = this.#dispatchRpc(method, params);
      if (result instanceof Promise) {
        result
          .then((value) => {
            this.#postMessage({
              type: "rpc-response",
              msgId,
              result: value,
            });
          })
          .catch((error) => {
            this.#postMessage({
              type: "rpc-response",
              msgId,
              error: {
                code: error?.code ?? "INTERNAL_ERROR",
                message: error?.message ?? String(error),
              },
            });
          });
        return;
      }

      this.#postMessage({
        type: "rpc-response",
        msgId,
        result,
      });
    } catch (error) {
      this.#postMessage({
        type: "rpc-response",
        msgId,
        error: {
          code: error?.code ?? "INTERNAL_ERROR",
          message: error?.message ?? String(error),
        },
      });
    }
  }

  /**
   * 分发 RPC 方法
   * @param {string} method - RPC 方法名
   * @param {Record<string, any>} params - RPC 参数
   * @returns {*}
   */
  #dispatchRpc(method, params) {
    switch (method) {
      case "createBoard":
        return this.createBoard(params);
      case "destroyBoard":
        return this.destroyBoard();
      default:
        return this.#dispatchBoardApiMethod(method, params);
    }
  }

  /**
   * 创建 Worker 侧 BoardCore 与 BoardApi
   * @param {{ width?: number, height?: number, rootPath?: string }} [options={}] - Board 初始化选项
   * @returns {{ ok: boolean }} 创建结果
   */
  createBoard(options = {}) {
    if (this.#boardCore || this.#boardApi) {
      throw new Error("BoardCore already created.");
    }

    this.#boardCore = new BoardCore({
      width: options.width,
      height: options.height,
      rootPath: options.rootPath,
      persistenceAdapter: createDefaultPersistenceAdapter(),
      aomRenderHooks: createDefaultAomRenderHooks(),
    });
    this.#boardApi = new BoardApi(this.#boardCore);
    return { ok: true };
  }

  /**
   * 销毁 Worker 侧 BoardCore 与 BoardApi
   * @returns {{ ok: boolean }} 销毁结果
   */
  destroyBoard() {
    this.#boardApi = null;
    this.#boardCore = null;
    return { ok: true };
  }

  /**
   * 获取当前可用的 BoardApi
   * @returns {BoardApi} 当前 BoardApi 实例
   * @throws {Error} Board 尚未创建时抛出
   */
  #requireBoardApi() {
    if (!this.#boardApi) {
      throw new Error("BoardCore is not initialized. Call createBoard first.");
    }

    return this.#boardApi;
  }

  /**
   * 将 RPC 方法转发到 Worker 内的 BoardApi
   * @param {string} method - RPC 方法名
   * @param {Record<string, any>} params - RPC 参数
   * @returns {*}
   */
  #dispatchBoardApiMethod(method, params = {}) {
    const boardApi = this.#requireBoardApi();

    switch (method) {
      case "createObject":
        return boardApi.createObject(params.type, params.props);
      case "modifyObject":
        return boardApi.modifyObject(params.objectId, params.patch);
      case "modifyObjects":
        return boardApi.modifyObjects(params.patches);
      case "appendListItem":
        return boardApi.appendListItem(
          params.objectId,
          params.key,
          params.items,
        );
      case "replaceListItem":
        return boardApi.replaceListItem(
          params.objectId,
          params.key,
          params.index,
          params.item,
        );
      case "removeListItem":
        return boardApi.removeListItem(
          params.objectId,
          params.key,
          params.index,
        );
      case "deleteObjects":
        return boardApi.deleteObjects(params.objectIds);
      case "commitObjects":
        return boardApi.commitObjects(params.objectIds);
      case "addActiveObjects":
        return boardApi.addActiveObjects(params.objectIds);
      case "discardActiveObjects":
        return boardApi.discardActiveObjects(params.objectIds);
      case "queryObjects":
        return boardApi.queryObjects(params.ids);
      case "queryChunkObjects":
        return boardApi.queryChunkObjects(params.chunkIds);
      case "hitTest":
        return boardApi.hitTest(params.range, params.mode);
      case "createMonitor":
        return boardApi.createMonitor(params.options);
      case "destroyMonitor":
        return boardApi.destroyMonitor(params.monitorId);
      case "undo":
        return boardApi.undo();
      case "redo":
        return boardApi.redo();
      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  /**
   * 处理视口变更消息
   * @param {Object} _message - 视口变更消息
   * @returns {void}
   */
  #handleViewportChange(_message) {
    this.#log.throttledWarn(
      "viewport-change-before-monitor-core",
      "viewport-change received before MonitorCore implementation.",
    );
  }

  /**
   * 处理渲染 flush 请求
   * @param {Object} _message - 渲染 flush 请求消息
   * @returns {void}
   */
  #handleRenderFlush(_message) {
    this.#log.throttledWarn(
      "render-flush-before-monitor-core",
      "request-render-flush received before MonitorCore implementation.",
    );
  }
}

/**
 * 创建一个可手动控制的 CoreWorkerRuntime
 * @param {{ postMessage: Function, addEventListener: Function, removeEventListener: Function }} host - Worker 消息宿主
 * @returns {CoreWorkerRuntime} 新建的 runtime
 */
function createCoreWorkerRuntime(host) {
  return new CoreWorkerRuntime(host);
}

const defaultWorkerHost = globalThis?.self;
if (isWorkerGlobalScopeInstance(defaultWorkerHost)) {
  createCoreWorkerRuntime(defaultWorkerHost).start();
}

export { CoreWorkerRuntime, createCoreWorkerRuntime };
