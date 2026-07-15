/**
 * @file Core Worker 入口
 * @description
 * 提供 Core Worker 的入口与运行时封装。
 * Worker 侧持有 BoardCore + BoardApi + ViewportCore，通过 JSON-RPC 风格的消息协议响应 UI 侧请求。
 * 领域分发委托给 BoardApi（api/board-api.js），本文件只负责消息路由、生命周期和渲染编排。
 * 当文件运行在真正的 WorkerGlobalScope 中时会自动启动；测试环境可通过导出的工厂手动创建 runtime。
 * @module core/engine/core-worker
 * @author Zhou Chenyu
 */

import { createDefaultPersistenceAdapter } from "../bridges/persistence-adapter.js";
import { createDefaultAomRenderHooks } from "./orchestration/aom-render-hooks.js";
import { BoardCore } from "./orchestration/board-core.js";
import { ViewportCore } from "./orchestration/viewport-core.js";
import { Logger } from "../../utils/log/logger.js";
import { logBus } from "../../utils/log/log-bus.js";
import { createConsolePrinter } from "../../utils/log/console-printer.js";
import { handleDebugQuery } from "./debug-helper.js";
import { BoardApi } from "./api/board-api.js";

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
 * 规整 viewportId 以便作为 Map key 使用
 * @param {string | number} viewportId - viewport 标识
 * @returns {string} 规整后的 key
 */
function normalizeViewportKey(viewportId) {
  return String(viewportId ?? "");
}

/**
 * Core Worker 运行时
 * @class
 * @description
 * 封装 Worker 线程的消息分发、BoardCore 生命周期与 RPC 路由。
 * 接通 ViewportCore、viewport-change / request-render-flush 与 render-frame 回传。
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
   * Engine 侧 BoardApi 分发器
   * @type {BoardApi | null}
   */
  #boardApi;

  /**
   * 当前 ViewportCore 注册表
   * @type {Map<string, ViewportCore>}
   */
  #viewportCores;

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

  /** Worker 运行时 DEBUG 日志订阅取消函数 */
  #offDebugLog;

  /**
   * runtime 是否已启动
   * @type {boolean}
   */
  #started;

  /**
   * 渲染帧 flush 是否已调度
   * @type {boolean}
   */
  #flushScheduled;

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
    this.#viewportCores = new Map();
    this.#messageListener = this.#handleMessageEvent.bind(this);
    this.#log = new Logger("CoreWorker", "INFO", logBus);
    this.#offWorkerLogs = null;
    this.#started = false;
    this.#flushScheduled = false;
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
    this.#offDebugLog = createConsolePrinter(logBus, {
      levels: ["DEBUG"],
      timestamps: true,
    });
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
    this.#offDebugLog?.();
    this.#offDebugLog = null;
    this.#offWorkerLogs?.();
    this.#offWorkerLogs = null;
    this.#destroyAllViewportCores();
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
      case "rpc-batch":
        this.#handleBatchMessage(message);
        return;
      case "viewport-change":
        this.#handleViewportChange(message);
        return;
      case "request-render-flush":
        this.#handleRenderFlush(message);
        return;
      case "debug-request":
        this.#handleDebugRequest(message);
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
   * 处理批量 RPC 请求
   * @description 批量消息为 fire-and-forget，不产生 rpc-response。
   * @param {{ items?: Array<{ method: string } & Record<string, any>> }} message - 批量请求消息
   * @returns {void}
   */
  #handleBatchMessage(message) {
    const items = message?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    for (const item of items) {
      try {
        const { method, ...params } = item;
        this.#invokeBoardApi(method, params);
      } catch (error) {
        this.#log.error(
          `Batch item failed: ${item?.method ?? "unknown"}`,
          error,
        );
      }
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
      case "createViewport":
        return this.createViewport(params.options);
      case "destroyViewport":
        return this.destroyViewport(params.viewportId);
      default:
        return this.#invokeBoardApi(method, params);
    }
  }

  /**
   * 创建 Worker 侧 BoardCore
   * @param {{ width?: number, height?: number, rootPath?: string }} [options={}] - Board 初始化选项
   * @returns {{ ok: boolean }} 创建结果
   */
  createBoard(options = {}) {
    if (this.#boardCore) {
      throw new Error("BoardCore already created.");
    }

    this.#boardCore = new BoardCore({
      width: options.width,
      height: options.height,
      rootPath: options.rootPath,
      persistenceAdapter: createDefaultPersistenceAdapter(),
      aomRenderHooks: createDefaultAomRenderHooks(),
    });

    const renderHooks = this.#createViewportRenderHooks();
    this.#boardCore.aomRenderHooks = renderHooks;
    this.#boardCore.activeObjectManager.renderHooks = renderHooks;

    this.#boardApi = new BoardApi(this.#boardCore);

    return { ok: true };
  }

  /**
   * 销毁 Worker 侧 BoardCore
   * @returns {{ ok: boolean }} 销毁结果
   */
  destroyBoard() {
    this.#destroyAllViewportCores();
    this.#boardApi = null;
    this.#boardCore = null;
    return { ok: true };
  }

  /**
   * 创建 Worker 侧 ViewportCore
   * @param {{ viewportId?: string | number, width?: number, height?: number }} [options={}] - Viewport 初始化选项
   * @returns {void}
   */
  createViewport(options = {}) {
    const boardCore = this.#requireBoardCore();
    const viewportId = options?.viewportId;
    if (
      viewportId === undefined ||
      viewportId === null ||
      String(viewportId).trim() === ""
    ) {
      throw new TypeError("createViewport requires a valid viewportId.");
    }

    const viewportKey = normalizeViewportKey(viewportId);
    const width = Number.isFinite(options?.width) ? options.width : 0;
    const height = Number.isFinite(options?.height) ? options.height : 0;
    const existingViewportCore = this.#viewportCores.get(viewportKey);

    if (existingViewportCore) {
      if (existingViewportCore.resize(width, height)) {
        existingViewportCore.requestRenderLayersRefresh();
      }
      return;
    }

    const viewportCore = new ViewportCore({
      boardCore,
      viewportId,
      width,
      height,
      postRenderFrame: (message, transferList = []) => {
        this.#postMessage(message, transferList);
      },
    });

    this.#viewportCores.set(viewportKey, viewportCore);
    viewportCore.requestRenderLayersRefresh();
  }

  /**
   * 销毁 Worker 侧 ViewportCore
   * @param {string | number} viewportId - Viewport 标识
   * @returns {void}
   */
  destroyViewport(viewportId) {
    const viewportCore = this.#resolveViewportCore(viewportId);
    if (!viewportCore) return;

    viewportCore.destroy();
    this.#viewportCores.delete(normalizeViewportKey(viewportId));
  }

  /**
   * 获取当前可用的 BoardCore
   * @returns {BoardCore} 当前 BoardCore 实例
   * @throws {Error} Board 尚未创建时抛出
   */
  #requireBoardCore() {
    if (!this.#boardCore) {
      throw new Error("BoardCore is not initialized. Call createBoard first.");
    }

    return this.#boardCore;
  }

  /**
   * 创建绑定到 ViewportCore 集合的 AOM 渲染钩子
   * @returns {import("./orchestration/aom-render-hooks.js").AomRenderHooks}
   */
  #createViewportRenderHooks() {
    return {
      /**
       * 刷新所有 ViewportCore 的活动层
       * @description
       * 仅失效显式传入的对象。未传对象时刷新全部活动 drawable。
       * @param {import("./objects/basic-obj.js").BasicObject[]} objectInstances - 受影响对象
       */
      requestActiveRender: (objectInstances = []) => {
        if (this.#viewportCores.size === 0) return;

        for (const viewportCore of this.#viewportCores.values()) {
          const renderer = viewportCore.renderer;
          if (!renderer) continue;

          const targetObjects =
            objectInstances.length > 0
              ? objectInstances
              : (renderer.collectActiveDrawables?.() ?? []);

          if (typeof renderer.invalidateActiveObjects === "function") {
            renderer.invalidateActiveObjects(targetObjects);
          }
          viewportCore.markFrameDirty();
        }
      },

      /**
       * 刷新所有 ViewportCore 的静态层
       * @param {import("./chunk/chunk.js").Chunk[]} chunks - 需要刷新的区块
       */
      requestStaticRender: (chunks = []) => {
        if (this.#viewportCores.size === 0) return;

        for (const viewportCore of this.#viewportCores.values()) {
          if (chunks.length > 0) {
            viewportCore.renderer?.invalidateChunks?.(chunks);
            viewportCore.markFrameDirty();
            continue;
          }

          viewportCore.requestViewportStaticRefresh?.();
        }
      },

      /**
       * 按对象范围刷新 ViewportCore 的静态层
       * @param {import("./objects/basic-obj.js").BasicObject[]} objectInstances - 受影响对象
       * @param {import("./chunk/chunk.js").Chunk[]} fallbackChunks - 回退区块
       * @param {Map<number, import("../shared/range/index.js").RectangleRange>} previousWorldRects - 旧世界范围快照
       */
      requestStaticRenderForObjects: (
        objectInstances = [],
        fallbackChunks = [],
        previousWorldRects = new Map(),
      ) => {
        if (this.#viewportCores.size === 0) return;

        for (const viewportCore of this.#viewportCores.values()) {
          const dirtyRects = viewportCore.renderer?.invalidateCachedObjects?.(
            objectInstances,
            { previousWorldRects },
          );

          if (Array.isArray(dirtyRects) && dirtyRects.length > 0) {
            viewportCore.syncChunkBufferWithViewport?.();
            viewportCore.markFrameDirty();
            continue;
          }

          if (fallbackChunks.length > 0) {
            viewportCore.renderer?.invalidateChunks?.(fallbackChunks);
            viewportCore.markFrameDirty();
            continue;
          }

          viewportCore.requestViewportStaticRefresh?.();
        }
      },

      /**
       * 刷新所有 ViewportCore 当前视口
       * @param {import("./objects/basic-obj.js").BasicObject[]} _objectInstances - 受影响对象
       */
      flushViewportForObjects: (_objectInstances = []) => {
        if (this.#viewportCores.size === 0) return;

        for (const viewportCore of this.#viewportCores.values()) {
          viewportCore.flushViewportRender?.();
        }
      },
    };
  }

  /**
   * 销毁全部 ViewportCore
   * @returns {void}
   */
  #destroyAllViewportCores() {
    for (const viewportCore of this.#viewportCores.values()) {
      viewportCore.destroy();
    }
    this.#viewportCores.clear();
  }

  /**
   * 解析目标 ViewportCore
   * @param {string | number | undefined} viewportId - viewport 标识
   * @returns {ViewportCore | undefined}
   */
  #resolveViewportCore(viewportId) {
    if (viewportId !== undefined && viewportId !== null) {
      return this.#viewportCores.get(normalizeViewportKey(viewportId));
    }

    if (this.#viewportCores.size === 1) {
      return this.#viewportCores.values().next().value;
    }

    return undefined;
  }

  /**
   * 安排一次渲染帧 flush（同周期去重）
   * @description
   * 在对象 mutation RPC 完成后安排渲染回传，消除 rAF 等待延迟。
   * 同一 microtask 周期内多次调用只执行一次 flush。
   * @returns {void}
   */
  #scheduleFlushRenderFrames() {
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    queueMicrotask(() => {
      this.#flushScheduled = false;
      for (const viewportCore of this.#viewportCores.values()) {
        viewportCore.flushRenderFrame();
      }
    });
  }

  /**
   * 立即刷新所有 ViewportCore 的渲染帧（无去重，直接执行）
   * @returns {void}
   */
  #flushRenderFrames() {
    for (const viewportCore of this.#viewportCores.values()) {
      viewportCore.flushRenderFrame();
    }
  }

  /**
   * 将 RPC 方法转发到 Engine 侧 BoardApi
   * @param {string} method - RPC 方法名
   * @param {Record<string, any>} params - RPC 参数
   * @returns {*}
   */
  #invokeBoardApi(method, params = {}) {
    const api = this.#boardApi;
    if (!api) {
      throw new Error("BoardApi is not initialized. Call createBoard first.");
    }

    let result;
    switch (method) {
      case "createObject":
        result = api.createObject(params.type, params.props);
        break;
      case "modifyObject":
        result = api.modifyObject(params.objectId, params.patch);
        break;
      case "modifyObjects":
        result = api.modifyObjects(params.patches);
        break;
      case "appendListItem":
        result = api.appendListItem(params.objectId, params.key, params.items);
        break;
      case "replaceListItem":
        result = api.replaceListItem(
          params.objectId,
          params.key,
          params.index,
          params.item,
        );
        break;
      case "removeListItem":
        result = api.removeListItem(params.objectId, params.key, params.index);
        break;
      case "deleteObjects":
        result = api.deleteObjects(params.objectIds);
        break;
      case "commitObjects":
        result = api.commitObjects(params.objectIds);
        break;
      case "addActiveObjects":
        result = api.addActiveObjects(params.objectIds);
        break;
      case "discardActiveObjects":
        result = api.discardActiveObjects(params.objectIds);
        break;
      case "queryObjects":
        result = api.queryObjects(params.ids);
        break;
      case "queryChunkObjects":
        result = api.queryChunkObjects(params.chunkIds);
        break;
      case "hitTest":
        return api.hitTest(params.range, params.mode);
      case "undo":
        result = api.undo();
        break;
      case "redo":
        result = api.redo();
        break;
      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }

    // 对象修改后调度渲染帧 flush
    if (this.#isMutationMethod(method)) {
      this.#scheduleFlushRenderFrames();
    }

    return result;
  }

  /**
   * 判断 RPC 方法是否为对象修改类方法
   * @param {string} method - RPC 方法名
   * @returns {boolean}
   */
  #isMutationMethod(method) {
    return [
      "modifyObject",
      "modifyObjects",
      "appendListItem",
      "replaceListItem",
      "removeListItem",
      "deleteObjects",
    ].includes(method);
  }

  /**
   * 处理视口变更消息
   * @param {{ viewportId?: string | number, origin?: { x?: number, y?: number }, zoom?: number, viewportSize?: { width?: number, height?: number } }} message - 视口变更消息
   * @returns {void}
   */
  #handleViewportChange(message) {
    const viewportCore = this.#resolveViewportCore(message?.viewportId);
    if (!viewportCore) {
      this.#log.throttledWarn(
        "viewport-change-unknown-viewport",
        `viewport-change ignored for unknown viewport: ${String(
          message?.viewportId,
        )}`,
      );
      return;
    }

    viewportCore.onViewportChange({
      origin: message?.origin,
      zoom: message?.zoom,
      viewportSize: message?.viewportSize,
      force: message?.force,
    });
  }

  /**
   * 处理渲染 flush 请求
   * @param {{ viewportId?: string | number }} message - 渲染 flush 请求消息
   * @returns {void}
   */
  #handleRenderFlush(message) {
    const viewportId = message?.viewportId;
    if (viewportId !== undefined && viewportId !== null) {
      const viewportCore = this.#resolveViewportCore(viewportId);
      if (!viewportCore) {
        this.#log.throttledWarn(
          "render-flush-unknown-viewport",
          `request-render-flush ignored for unknown viewport: ${String(
            viewportId,
          )}`,
        );
        return;
      }

      viewportCore.flushRenderFrame();
      return;
    }

    for (const viewportCore of this.#viewportCores.values()) {
      viewportCore.flushRenderFrame();
    }
  }

  /**
   * 处理调试请求，输出调试信息到 Logger
   * @param {{ query?: string, chunkId?: number, [key: string]: any }} message - 调试请求消息
   * @returns {void}
   * @private
   */
  #handleDebugRequest(message) {
    const { query, ...params } = message;
    const boardCore = this.#requireBoardCore();
    handleDebugQuery(boardCore, query, params);
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
