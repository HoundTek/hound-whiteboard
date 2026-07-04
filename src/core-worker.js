/**
 * @file Core Worker 入口
 * @description
 * 提供 Core Worker 的入口与运行时封装。
 * Worker 侧持有 BoardCore 等纯 Core 模块，通过 JSON-RPC 风格的消息协议响应 UI 侧请求。
 * 当文件运行在真正的 WorkerGlobalScope 中时会自动启动；测试环境可通过导出的工厂手动创建 runtime。
 * @module core-worker
 * @author Zhou Chenyu
 */

import { deserialize } from "./core/objects/object-deserializer.js";
import { Matrix, Vector } from "./core/utils/math.js";
import { intersectsRanges, RectangleRange } from "./core/range/index.js";
import { createDefaultPersistenceAdapter } from "./core/bridges/persistence-adapter.js";
import { createDefaultAomRenderHooks } from "./core/components/orchestration/aom-render-hooks.js";
import { BoardCore } from "./core/components/orchestration/board-core.js";
import { MonitorCore } from "./core/components/orchestration/monitor-core.js";
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
 * 规整 monitorId 以便作为 Map key 使用
 * @param {string | number} monitorId - monitor 标识
 * @returns {string} 规整后的 key
 */
function normalizeMonitorKey(monitorId) {
  return String(monitorId ?? "");
}

/**
 * Core Worker 运行时
 * @class
 * @description
 * 封装 Worker 线程的消息分发、BoardCore 生命周期与 RPC 路由。
 * 在 P3.3 阶段进一步接通 MonitorCore、viewport-change / request-render-flush 与 render-frame 回传。
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
   * 当前 MonitorCore 注册表
   * @type {Map<string, MonitorCore>}
   */
  #monitorCores;

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
    this.#monitorCores = new Map();
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
    this.#destroyAllMonitorCores();
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
      case "createMonitor":
        return this.createMonitor(params.options);
      case "destroyMonitor":
        return this.destroyMonitor(params.monitorId);
      default:
        return this.#dispatchBoardApiMethod(method, params);
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

    const renderHooks = this.#createMonitorRenderHooks();
    this.#boardCore.aomRenderHooks = renderHooks;
    this.#boardCore.activeObjectManager.renderHooks = renderHooks;

    return { ok: true };
  }

  /**
   * 销毁 Worker 侧 BoardCore
   * @returns {{ ok: boolean }} 销毁结果
   */
  destroyBoard() {
    this.#destroyAllMonitorCores();
    this.#boardCore = null;
    return { ok: true };
  }

  /**
   * 创建 Worker 侧 MonitorCore
   * @param {{ monitorId?: string | number, width?: number, height?: number }} [options={}] - Monitor 初始化选项
   * @returns {void}
   */
  createMonitor(options = {}) {
    const boardCore = this.#requireBoardCore();
    const monitorId = options?.monitorId;
    if (
      monitorId === undefined ||
      monitorId === null ||
      String(monitorId).trim() === ""
    ) {
      throw new TypeError("createMonitor requires a valid monitorId.");
    }

    const monitorKey = normalizeMonitorKey(monitorId);
    const width = Number.isFinite(options?.width) ? options.width : 0;
    const height = Number.isFinite(options?.height) ? options.height : 0;
    const existingMonitorCore = this.#monitorCores.get(monitorKey);

    if (existingMonitorCore) {
      if (existingMonitorCore.resize(width, height)) {
        existingMonitorCore.requestRenderLayersRefresh();
      }
      return;
    }

    const monitorCore = new MonitorCore({
      boardCore,
      monitorId,
      width,
      height,
      postRenderFrame: (message, transferList = []) => {
        this.#postMessage(message, transferList);
      },
    });

    this.#monitorCores.set(monitorKey, monitorCore);
    monitorCore.requestRenderLayersRefresh();
  }

  /**
   * 销毁 Worker 侧 MonitorCore
   * @param {string | number} monitorId - Monitor 标识
   * @returns {void}
   */
  destroyMonitor(monitorId) {
    const monitorCore = this.#resolveMonitorCore(monitorId);
    if (!monitorCore) return;

    monitorCore.destroy();
    this.#monitorCores.delete(normalizeMonitorKey(monitorId));
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
   * 创建绑定到 MonitorCore 集合的 AOM 渲染钩子
   * @returns {import("./core/components/orchestration/aom-render-hooks.js").AomRenderHooks}
   */
  #createMonitorRenderHooks() {
    return {
      /**
       * 刷新所有 MonitorCore 的活动层
       * @param {import("./core/objects/basic-obj.js").BasicObject[]} objectInstances - 受影响对象
       */
      requestLiveRender: (objectInstances = []) => {
        if (this.#monitorCores.size === 0) return;

        for (const monitorCore of this.#monitorCores.values()) {
          const liveRenderer = monitorCore.liveRenderer;
          if (!liveRenderer) continue;

          const dirtyObjectMap = new Map();
          for (const obj of objectInstances) {
            dirtyObjectMap.set(obj.id, obj);
          }
          for (const obj of liveRenderer.collectActiveDrawables?.() ?? []) {
            dirtyObjectMap.set(obj.id, obj);
          }

          if (typeof liveRenderer.invalidateObjects === "function") {
            liveRenderer.invalidateObjects([...dirtyObjectMap.values()]);
          }
          monitorCore.markFrameDirty();
        }
      },

      /**
       * 刷新所有 MonitorCore 的静态层
       * @param {import("./core/components/chunk/chunk.js").Chunk[]} chunks - 需要刷新的区块
       */
      requestBaseRender: (chunks = []) => {
        if (this.#monitorCores.size === 0) return;

        for (const monitorCore of this.#monitorCores.values()) {
          if (chunks.length > 0) {
            monitorCore.baseRenderer?.invalidateChunks?.(chunks);
            monitorCore.markFrameDirty();
            continue;
          }

          monitorCore.requestViewportBaseRender?.();
        }
      },

      /**
       * 按对象范围刷新 MonitorCore 的静态层
       * @param {import("./core/objects/basic-obj.js").BasicObject[]} objectInstances - 受影响对象
       * @param {import("./core/components/chunk/chunk.js").Chunk[]} fallbackChunks - 回退区块
       * @param {Map<number, import("./core/range/index.js").RectangleRange>} previousWorldRects - 旧世界范围快照
       */
      requestBaseRenderForObjects: (
        objectInstances = [],
        fallbackChunks = [],
        previousWorldRects = new Map(),
      ) => {
        if (this.#monitorCores.size === 0) return;

        for (const monitorCore of this.#monitorCores.values()) {
          const dirtyRects = monitorCore.baseRenderer?.invalidateObjects?.(
            objectInstances,
            { previousWorldRects },
          );

          if (Array.isArray(dirtyRects) && dirtyRects.length > 0) {
            monitorCore.syncChunkBufferWithViewport?.();
            monitorCore.markFrameDirty();
            continue;
          }

          if (fallbackChunks.length > 0) {
            monitorCore.baseRenderer?.invalidateChunks?.(fallbackChunks);
            monitorCore.markFrameDirty();
            continue;
          }

          monitorCore.requestViewportBaseRender?.();
        }
      },

      /**
       * 刷新所有 MonitorCore 当前视口
       * @param {import("./core/objects/basic-obj.js").BasicObject[]} _objectInstances - 受影响对象
       */
      flushViewportForObjects: (_objectInstances = []) => {
        if (this.#monitorCores.size === 0) return;

        for (const monitorCore of this.#monitorCores.values()) {
          monitorCore.flushViewportRender?.();
        }
      },
    };
  }

  /**
   * 销毁全部 MonitorCore
   * @returns {void}
   */
  #destroyAllMonitorCores() {
    for (const monitorCore of this.#monitorCores.values()) {
      monitorCore.destroy();
    }
    this.#monitorCores.clear();
  }

  /**
   * 解析目标 MonitorCore
   * @param {string | number | undefined} monitorId - monitor 标识
   * @returns {MonitorCore | undefined}
   */
  #resolveMonitorCore(monitorId) {
    if (monitorId !== undefined && monitorId !== null) {
      return this.#monitorCores.get(normalizeMonitorKey(monitorId));
    }

    if (this.#monitorCores.size === 1) {
      return this.#monitorCores.values().next().value;
    }

    return undefined;
  }

  /**
   * 将 RPC 方法转发到 Worker 内的 BoardCore
   * @param {string} method - RPC 方法名
   * @param {Record<string, any>} params - RPC 参数
   * @returns {*}
   */
  #dispatchBoardApiMethod(method, params = {}) {
    const boardCore = this.#requireBoardCore();

    switch (method) {
      case "createObject": {
        const objectId = params.props?.id;
        if (objectId == null) {
          throw new Error("createObject requires an explicit object id.");
        }
        const existingObject = boardCore.getObjectById(objectId);
        if (existingObject) {
          throw new Error(
            `Duplicate object id ${objectId}: an object with this id already exists.`,
          );
        }

        const obj = deserialize({
          type: params.type,
          id: objectId,
          position: params.props?.position ?? { x: 0, y: 0 },
          transform: { a: 1, b: 0, c: 0, d: 1 },
          property: { ...(params.props?.property ?? {}) },
          data: { ...(params.props?.data ?? {}) },
        });

        boardCore.registerObjectInstance(obj);
        boardCore.activeObjectManager.add(new Set([obj]));

        return objectId;
      }
      case "modifyObject": {
        const obj = boardCore.getObjectById(params.objectId);
        if (!obj) {
          throw new Error(`Object ${params.objectId} not found.`);
        }
        const patch = params.patch;
        if (patch.position != null) {
          obj.position = new Vector(patch.position.x, patch.position.y);
        }
        if (patch.transform != null) {
          const { a, b, c, d } = patch.transform;
          obj.setTransform(new Matrix(a, b, c, d));
        }
        if (patch.property != null) {
          obj.setProperty(patch.property);
        }
        if (patch.data != null) {
          obj.setData(patch.data);
        }
        return;
      }
      case "modifyObjects": {
        const patches = Array.isArray(params.patches) ? params.patches : [];
        for (const { objectId, patch } of patches) {
          if (objectId == null || !patch) continue;
          const obj = boardCore.getObjectById(objectId);
          if (!obj) continue;
          if (patch.position != null) {
            obj.position = new Vector(patch.position.x, patch.position.y);
          }
          if (patch.transform != null) {
            const { a, b, c, d } = patch.transform;
            obj.setTransform(new Matrix(a, b, c, d));
          }
          if (patch.property != null) {
            obj.setProperty(patch.property);
          }
          if (patch.data != null) {
            obj.setData(patch.data);
          }
        }
        return;
      }
      case "appendListItem": {
        const obj = boardCore.getObjectById(params.objectId);
        if (obj) {
          obj.appendListItem(params.key, ...(params.items ?? []));
        }
        return;
      }
      case "replaceListItem": {
        const obj = boardCore.getObjectById(params.objectId);
        if (obj) {
          obj.replaceListItem(params.key, params.index, params.item);
        }
        return;
      }
      case "removeListItem": {
        const obj = boardCore.getObjectById(params.objectId);
        if (obj) {
          obj.removeListItem(params.key, params.index);
        }
        return;
      }
      case "deleteObjects": {
        const objectIds = Array.isArray(params.objectIds)
          ? params.objectIds
          : [];
        const aom = boardCore.activeObjectManager;
        const activeToDiscard = [];
        const affectedChunks = new Set();

        for (const objectId of objectIds) {
          const obj = boardCore.getObjectById(objectId);
          if (!obj) continue;

          if (aom?.activeObjectIndex?.has?.(objectId)) {
            activeToDiscard.push(obj);
          }

          for (const { chunk } of boardCore.chunkLoaded.values()) {
            if (chunk?.objectManager?.staticGraph?.hasNode?.(objectId)) {
              chunk.removeObject(objectId);
              affectedChunks.add(chunk);
            }
          }

          boardCore.objectLoaded.delete(objectId);
        }

        if (activeToDiscard.length > 0) {
          aom.discard(new Set(activeToDiscard));
        }

        if (affectedChunks.size > 0 && boardCore.aomRenderHooks?.requestBaseRender) {
          boardCore.aomRenderHooks.requestBaseRender([...affectedChunks]);
        }
        return;
      }
      case "commitObjects": {
        const objectIds = Array.isArray(params.objectIds)
          ? params.objectIds
          : [];
        const objects = objectIds
          .map((id) => boardCore.getObjectById(id))
          .filter(Boolean);
        if (objects.length > 0) {
          boardCore.activeObjectManager.apply(new Set(objects));
        }
        return;
      }
      case "addActiveObjects": {
        const objectIds = Array.isArray(params.objectIds)
          ? params.objectIds
          : [];
        const objects = objectIds
          .map((id) => boardCore.getObjectById(id))
          .filter(Boolean);
        if (objects.length > 0) {
          boardCore.activeObjectManager.choose(new Set(objects));
        }
        return;
      }
      case "discardActiveObjects": {
        const objectIds = Array.isArray(params.objectIds)
          ? params.objectIds
          : [];
        const objects = objectIds
          .map((id) => boardCore.getObjectById(id))
          .filter(Boolean);

        const transientObjectIds = objects.filter(
          (obj) => !hasStaticBoardObject(boardCore, obj.id),
        );

        boardCore.activeObjectManager.discard(new Set(objects));

        for (const objectId of transientObjectIds) {
          boardCore.objectLoaded.delete(objectId);
        }
        return;
      }
      case "queryObjects": {
        const ids = Array.isArray(params.ids) ? params.ids : [];
        const aom = boardCore.activeObjectManager;
        return ids
          .map((objectId) => {
            const obj = boardCore.getObjectById(objectId);
            if (!obj) return null;
            const isActive = aom?.activeObjectIndex?.has?.(objectId) ?? false;
            return {
              id: obj.id,
              type: obj.constructor.name,
              isActive,
              position: { x: obj.position.x, y: obj.position.y },
              transform: obj.transform
                ? {
                    a: obj.transform.a,
                    b: obj.transform.b,
                    c: obj.transform.c,
                    d: obj.transform.d,
                  }
                : undefined,
              boundingBox: obj.rich?.boundingBox,
              range: obj.getRange(),
              property: { ...(obj.property ?? {}) },
              data: { ...(obj.data ?? {}) },
            };
          })
          .filter(Boolean);
      }
      case "queryChunkObjects": {
        const chunkIds = Array.isArray(params.chunkIds) ? params.chunkIds : [];
        const seen = new Set();
        for (const chunkId of chunkIds) {
          const chunk = boardCore.getChunkById(chunkId);
          if (!chunk?.objectManager?.staticGraph) continue;
          for (const objectId of chunk.objectManager.staticGraph.getNodes()) {
            seen.add(objectId);
          }
        }
        return [...seen];
      }
      case "hitTest": {
        let queryRange;
        const range = params.range;
        if (range instanceof RectangleRange) {
          queryRange = range;
        } else if (typeof range?.left === "number") {
          queryRange = RectangleRange.fromRectLike(range);
        } else {
          queryRange = range;
        }
        if (!queryRange) return [];

        const hits = [];
        for (const [objectId] of boardCore.objectLoaded) {
          const obj = boardCore.getObjectById(objectId);
          if (!obj) continue;

          const worldRange = obj.getRange()?.withPosition?.(obj.position);
          if (!worldRange) continue;

          if (intersectsRanges(worldRange, queryRange)) {
            hits.push(objectId);
          }
        }
        return hits;
      }
      case "undo":
        throw new Error("Not implemented yet.");
      case "redo":
        throw new Error("Not implemented yet.");
      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  /**
   * 处理视口变更消息
   * @param {{ monitorId?: string | number, origin?: { x?: number, y?: number }, zoom?: number, viewportSize?: { width?: number, height?: number } }} message - 视口变更消息
   * @returns {void}
   */
  #handleViewportChange(message) {
    const monitorCore = this.#resolveMonitorCore(message?.monitorId);
    if (!monitorCore) {
      this.#log.throttledWarn(
        "viewport-change-unknown-monitor",
        `viewport-change ignored for unknown monitor: ${String(
          message?.monitorId,
        )}`,
      );
      return;
    }

    monitorCore.onViewportChange({
      origin: message?.origin,
      zoom: message?.zoom,
      viewportSize: message?.viewportSize,
      force: message?.force,
    });
  }

  /**
   * 处理渲染 flush 请求
   * @param {{ monitorId?: string | number }} message - 渲染 flush 请求消息
   * @returns {void}
   */
  #handleRenderFlush(message) {
    const monitorId = message?.monitorId;
    if (monitorId !== undefined && monitorId !== null) {
      const monitorCore = this.#resolveMonitorCore(monitorId);
      if (!monitorCore) {
        this.#log.throttledWarn(
          "render-flush-unknown-monitor",
          `request-render-flush ignored for unknown monitor: ${String(
            monitorId,
          )}`,
        );
        return;
      }

      monitorCore.flushRenderFrame();
      return;
    }

    for (const monitorCore of this.#monitorCores.values()) {
      monitorCore.flushRenderFrame();
    }
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

/**
 * 判断对象是否已进入 Worker 侧的区块静态图
 * @param {import("./core/components/orchestration/board-core.js").BoardCore} boardCore - BoardCore 实例
 * @param {number} objectId - 对象 id
 * @returns {boolean}
 */
function hasStaticBoardObject(boardCore, objectId) {
  for (const { chunk } of boardCore.chunkLoaded.values()) {
    if (chunk?.objectManager?.staticGraph?.hasNode?.(objectId)) {
      return true;
    }
  }
  return false;
}

const defaultWorkerHost = globalThis?.self;
if (isWorkerGlobalScopeInstance(defaultWorkerHost)) {
  createCoreWorkerRuntime(defaultWorkerHost).start();
}

export { CoreWorkerRuntime, createCoreWorkerRuntime };
