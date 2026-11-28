/**
 * @file Core Worker 入口
 * @description
 * 提供 Core Worker 的入口与运行时封装。
 * Worker 侧持有 BoardCore + BoardApi + ViewportCore，通过 JSON-RPC 风格的消息协议响应 UI 侧请求。
 * 领域分发委托给 BoardApi（api/board-api.js），本文件只负责消息路由、生命周期和渲染编排。
 * 当文件运行在真正的 WorkerGlobalScope 中时会自动启动；测试环境可通过导出的工厂手动创建 runtime。
 * @module host/core-worker
 * @author Zhou Chenyu
 */

import { createDefaultPersistenceAdapter } from "../kernel/board/persistence-adapter.js";
import { createDefaultAomRenderHooks } from "../kernel/board/aom-render-hooks.js";
import { BoardCore } from "../kernel/board/board-core.js";
import { ViewportCore } from "../renderers/canvas/viewport-core.js";
import { Logger } from "../utils/log/logger.js";
import { logBus } from "../utils/log/log-bus.js";
import { createConsolePrinter } from "../utils/log/console-printer.js";
import { handleDebugQuery } from "./debug-helper.js";
import { BoardApi } from "../kernel/api/board-api.js";
import { BOARD_API_ROUTES } from "../kernel/api/board-api-routes.js";
import { invokeBoardApiRoute } from "../kernel/api/board-api-residency.js";
import { createTauriDriver } from "../io/driver/tauri.js";
import { bindRoot } from "../io/driver/io-driver.js";
import { createPersistenceAdapter } from "../io/adapter/persistence.js";
import { createSessionStore } from "../kernel/store/session-store.js";
import { createNetworkCoordinator } from "./sync/network-coordinator.js";
import { createAmendForwarder } from "./sync/amend-forwarder.js";
import { createJournaler } from "../kernel/store/journaler.js";

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
 * 分子预览的超时时长（毫秒，无 mol 消息即判定分子失联并清预览）
 * @type {number}
 */
const MOL_PREVIEW_TIMEOUT_MS = 3000;

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
   * 建板代次，使旧连接的完成回调无法挂到后续 BoardCore
   * @type {number}
   */
  #boardGeneration = 0;

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
   * 日志跟随者（持久化模式非空）
   * @type {Object | null}
   */
  #journaler;

  /**
   * 网络协调器（syncUrl 存在且连接成功时非空）
   * @type {Object | null}
   */
  #coordinator;

  /**
   * remote-activity 事件订阅的退订函数
   * @type {Function | null}
   */
  #unsubscribeRemoteActivity;

  /**
   * hit-changed 事件订阅的退订函数
   * @type {Function | null}
   */
  #unsubscribeHitChanged;

  /**
   * 板级 amend 转发器，向全部健康同步通道扇出
   * @type {Object | null}
   */
  #amendForwarder;

  /**
   * 分子预览登记表（molId → 预览中的对象 id 集）
   * @type {Map<string, Set<string>>}
   */
  #molPreviews;

  /**
   * 分子预览超时定时器表（molId → 定时器，3s 无分子消息即按失联清预览）
   * @type {Map<string, ReturnType<typeof setTimeout>>}
   */
  #molPreviewTimers;

  /**
   * 分子预览消息水位与结束墓碑
   * @type {Map<string, {seq: number, closed: boolean}>}
   */
  #molPreviewStates = new Map();

  /**
   * 同步中继地址（createBoard 时记录，供断线重连）
   * @type {string | null}
   */
  #syncUrl = null;

  /**
   * 同步房间 id（createBoard 时记录，供断线重连）
   * @type {string | null}
   */
  #syncBoardId = null;

  /**
   * 协调器重连定时器
   * @type {ReturnType<typeof setTimeout> | null}
   */
  #coordinatorRetryTimer = null;

  /**
   * 本端 owner RPC 端点信息（{ownerId, host, port, token}）
   * @type {Object | null}
   */
  #ownerRpc = null;

  /**
   * owner RPC 是否正在关闭（关闭期间拒绝新的 owner RPC 请求）
   * @type {boolean}
   */
  #ownerRpcClosing = false;

  /**
   * 板操作串行链（UI RPC、owner RPC 共用，保证 source 切换期间不混入其它操作）
   * @type {Promise<void>}
   */
  #boardOpQueue = Promise.resolve();

  /**
   * GUI 板尺寸（createBoard 时记录，建板骨架用）
   * @type {{width: number, height: number}}
   */
  #boardSize = { width: 0, height: 0 };

  /**
   * 等待主线程 io-response 的挂起表
   * @type {Map<string, { resolve: Function, reject: Function }>}
   */
  #ioPending;

  /**
   * io-invoke 消息序号
   * @type {number}
   */
  #ioMsgSeq;

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
    this.#journaler = null;
    this.#coordinator = null;
    this.#unsubscribeRemoteActivity = null;
    this.#unsubscribeHitChanged = null;
    this.#amendForwarder = null;
    this.#molPreviews = new Map();
    this.#molPreviewTimers = new Map();
    this.#syncUrl = null;
    this.#syncBoardId = null;
    this.#coordinatorRetryTimer = null;
    this.#ownerRpc = null;
    this.#ownerRpcClosing = false;
    this.#boardOpQueue = Promise.resolve();
    this.#boardSize = { width: 0, height: 0 };
    this.#ioPending = new Map();
    this.#ioMsgSeq = 0;
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
   * 处理主线程回传的 IO 执行结果
   * @param {Object} message - io-response 消息
   * @returns {void}
   */
  #handleIoResponse(message) {
    const pending = this.#ioPending.get(message?.msgId);
    if (!pending) return;
    this.#ioPending.delete(message.msgId);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error ?? "io-invoke failed"));
    }
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
      case "io-response":
        this.#handleIoResponse(message);
        return;
      case "owner-rpc-request":
        this.#handleOwnerRpcMessage(message);
        return;
      case "awareness-send":
        this.#broadcastAwareness(message.data);
        return;
      default:
        return;
    }
  }

  /**
   * 向全部健康同步通道发送 volatile awareness
   * @param {Object} data - awareness 负载
   * @returns {void}
   * @private
   */
  #broadcastAwareness(data) {
    this.#coordinator?.sendAwareness(data);
  }

  /**
   * 将板操作排入串行链
   * @param {() => * | Promise<*>} task - 板操作
   * @returns {Promise<*>} 操作结果
   * @private
   */
  #enqueueBoardOp(task) {
    const run = this.#boardOpQueue.then(task, task);
    this.#boardOpQueue = run.catch(() => {});
    return run;
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

    const isLifecycle =
      method === "createBoard" ||
      method === "destroyBoard" ||
      method === "createViewport" ||
      method === "destroyViewport";
    const run = isLifecycle
      ? Promise.resolve().then(() => this.#dispatchRpc(method, params))
      : this.#enqueueBoardOp(() => this.#dispatchRpc(method, params));
    run
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
  }

  /**
   * 处理批量 RPC 请求
   * @description
   * 批量消息为 fire-and-forget，不产生 rpc-response；
   * 单条目失败不影响其余条目执行，全部失败条目以 rpc-batch-error 统一回传。
   * @param {{ batchId?: number, items?: Array<{ method: string } & Record<string, any>> }} message - 批量请求消息
   * @returns {void}
   */
  #handleBatchMessage(message) {
    const items = message?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    const errors = [];
    const tasks = items.map((item, index) => {
      const { method, ...params } = item;
      return this.#enqueueBoardOp(() => this.#invokeBoardApi(method, params)).catch(
        (error) => {
          errors.push({
            index,
            method: item?.method ?? "unknown",
            code: error?.code ?? "INTERNAL_ERROR",
            message: error?.message ?? String(error),
          });
          this.#log.error(
            `Batch item failed: ${item?.method ?? "unknown"}`,
            error,
          );
        },
      );
    });

    Promise.all(tasks).then(() => {
      if (errors.length > 0) {
        this.#postMessage({
          type: "rpc-batch-error",
          batchId: message?.batchId,
          errors,
        });
      }
    });
  }

  /**
   * 处理 owner RPC 请求
   * @param {{ requestId?: string, route?: string, params?: Record<string, any> }} message - 请求消息
   * @returns {void}
   *
   * @description
   * 经 BOARD_API_ROUTES 分发；请求按来源声明的 source 执行，写路由在响应前 flush journaler，
   * 保证 CLI 拿到结果时已落盘。与 UI RPC 共用串行链，source 切换期间不混入其它操作。
   */
  #handleOwnerRpcMessage(message) {
    const requestId = message?.requestId;
    const route = message?.route;
    const params = message?.params ?? {};
    const source = typeof message?.source === "string" ? message.source : undefined;
    if (typeof requestId !== "string" || typeof route !== "string") {
      this.#log.warn("Ignoring malformed owner rpc message.", message);
      return;
    }

    if (this.#ownerRpcClosing) {
      this.#postMessage({
        type: "owner-rpc-response",
        requestId,
        ok: false,
        error: "owner 正在关闭",
      });
      return;
    }

    const run = async () => {
      try {
        if (this.#boardCore === null || this.#boardApi === null) {
          throw new Error("BoardApi is not initialized.");
        }
        const entry = BOARD_API_ROUTES[route];
        if (!entry) {
          throw new Error(`未知 route：${route}`);
        }
        const execute = async () => {
          const result = await invokeBoardApiRoute(
            this.#boardCore,
            this.#boardApi,
            route,
            params,
          );
          if (entry.flush !== "none") {
            if (this.#journaler !== null) {
              await this.#journaler.flush();
            }
            this.#scheduleFlushRenderFrames();
          }
          return result;
        };
        const result = source
          ? await this.#boardCore.runAsSource(source, execute)
          : await execute();
        this.#postMessage({
          type: "owner-rpc-response",
          requestId,
          ok: true,
          result: result ?? null,
        });
      } catch (error) {
        this.#postMessage({
          type: "owner-rpc-response",
          requestId,
          ok: false,
          error: error?.message ?? String(error),
        });
      }
    };

    this.#enqueueBoardOp(run);
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
   * @param {{ width?: number, height?: number, rootPath?: string, source?: string }} [options={}] - Board 初始化选项
   * @returns {Promise<{ ok: boolean }>} 创建结果
   *
   * @description
   * rootPath 有效时进入持久化 owner 模式：可写挂载板目录，GUI 自己落盘并启动 owner RPC 端点；
   * 既有板从会话存储恢复（树、trash、层叠图、计数器与对象元数据），对象实例随区块按需加载。
   */
  async createBoard(options = {}) {
    if (this.#boardCore) {
      throw new Error("BoardCore already created.");
    }

    this.#boardGeneration += 1;
    this.#ownerRpcClosing = false;
    this.#boardSize = {
      width: options.width ?? 0,
      height: options.height ?? 0,
    };
    const persistence = await this.#setupPersistence(options.rootPath);

    // 盘上板配置优先：板尺寸是文档数据（决定区块划分），重开必须与原值一致
    const boardConfig = persistence?.session?.meta?.boardConfig;
    this.#boardCore = new BoardCore({
      width: boardConfig?.width || options.width,
      height: boardConfig?.height || options.height,
      rootPath: options.rootPath,
      source: options.source,
      persistenceAdapter:
        persistence?.adapter ?? createDefaultPersistenceAdapter(),
      aomRenderHooks: createDefaultAomRenderHooks(),
      hitRecords: persistence?.session?.records?.length
        ? persistence.session.records
        : undefined,
      lastTime: persistence?.session?.meta?.lastTime,
      coreIdCounters: persistence?.session?.meta?.coreIdCounters,
      objectIdCounters: persistence?.session?.meta?.objectIdCounters,
    });
    if (persistence?.store) {
      this.#boardCore.setObjectIndexLoader(() =>
        persistence.store.readObjectTypeIndex(),
      );
    }

    const renderHooks = this.#createViewportRenderHooks();
    this.#boardCore.aomRenderHooks = renderHooks;
    this.#boardCore.activeObjectManager.renderHooks = renderHooks;

    // awareness 下行：远程选择注册表变更合批通知 UI（选中装饰刷新与预览清理触发）
    this.#unsubscribeRemoteActivity = this.#boardCore.activityEventBus.on(
      "remote-activity",
      (event) => {
        this.#postMessage({
          type: "awareness",
          awarenessType: "remote-activity",
          data: event,
        });
      },
    );
    // hit 变更下行：远程文档变化通知 UI（工具清理失效选中）
    this.#unsubscribeHitChanged = this.#boardCore.activityEventBus.on(
      "hit-changed",
      () => {
        this.#postMessage({
          type: "awareness",
          awarenessType: "hit-changed",
        });
      },
    );

    this.#boardApi = new BoardApi(this.#boardCore);
    this.#amendForwarder = createAmendForwarder({
      boardCore: this.#boardCore,
      sendAwareness: (data) => this.#broadcastAwareness(data),
    });

    if (persistence) {
      this.#boardCore.restoreSession(persistence.session, { chunksTemp: true });
      this.#boardApi.refreshMaterializedProjection();
      // GUI 作为 owner 写全部来源流：本端与 relay 远端记录都由本端落盘；
      // 对象文件按 AOM 活动性仲裁（journaler 内跳过远程活动对象）；
      // chunkUnload 部分驻留下不移除缺失对象文件（显式删除仍生效）
      this.#journaler = createJournaler({
        boardCore: this.#boardCore,
        store: persistence.store,
        collectMeta: () => this.#boardCore.collectSessionMeta(),
        removeMissing: false,
      });
      this.#journaler.attach({
        nextSegmentSeqBySource: persistence.session.nextSegmentSeqBySource,
        lastTime: persistence.session.meta?.lastTime ?? 0,
        knownObjects: persistence.session.objects,
        knownTrash: persistence.session.trash,
        knownSourceMeta: persistence.session.sourceMeta ?? null,
        knownChunkMetadata: persistence.session.chunkMetadataList,
      });
      try {
        const ownerRpc = await this.#forwardIoInvoke("start_owner_rpc", {
          path: persistence.rootPath,
          source: this.#boardCore.source,
          boardId: options.boardId ?? persistence.rootPath,
          claimedAt: new Date().toISOString(),
        });
        if (!ownerRpc || typeof ownerRpc.port !== "number") {
          throw new Error("owner RPC 启动失败");
        }
        this.#ownerRpc = ownerRpc;
      } catch (error) {
        await this.#journaler.detach().catch(() => {});
        this.#journaler = null;
        throw error;
      }
    }

    // 同步：syncUrl 存在时连接中继；首次失败起每 3s 自动重试，不阻塞开板
    if (typeof options.syncUrl === "string" && options.syncUrl !== "") {
      this.#syncUrl = options.syncUrl;
      this.#syncBoardId =
        typeof options.boardId === "string" && options.boardId !== ""
          ? options.boardId
          : options.rootPath;
      await this.#connectCoordinator();
    }

    return { ok: true };
  }

  /**
   * 连接（或重连）同步中继
   * @returns {Promise<void>}
   * @private
   *
   * @description
   * 每次尝试使用新的协调器实例（断线后旧实例已自清理）；成功时挂接协调器，
   * 失败起每 3s 自动重试（板存活期间中继后启动也能连上）。
   */
  async #connectCoordinator() {
    if (this.#boardCore === null || this.#syncUrl === null) return;
    await this.#connectSyncChannel({
      url: this.#syncUrl,
      boardId: this.#syncBoardId,
      assign: (coordinator) => {
        this.#coordinator = coordinator;
      },
      scheduleReconnect: () => this.#scheduleCoordinatorReconnect(),
      logConnected: `已连接同步中继：${this.#syncUrl}`,
      logFailedPrefix: "同步中继连接失败，离线运行",
    });
  }

  /**
   * 建立 relay 协作同步通道
   * @param {Object} options - 连接参数
   * @param {string} options.url - WS 地址
   * @param {string} options.boardId - 板标识（relay 房间号）
   * @param {(coordinator: Object) => void} options.assign - 连接成功后的协调器归属赋值
   * @param {() => void} options.scheduleReconnect - 断线或失败时的重连调度
   * @param {string} options.logConnected - 连接成功日志文案
   * @param {string} options.logFailedPrefix - 连接失败日志前缀
   * @returns {Promise<void>}
   * @private
   *
   * @description
   * 每次尝试使用新的协调器实例（断线后旧实例已自清理）；connect 期间板已销毁则
   * 直接关闭防泄漏；成功时挂接协调器，失败时关闭实例并调度重连。
   */
  async #connectSyncChannel({
    url,
    boardId,
    assign,
    scheduleReconnect,
    logConnected,
    logFailedPrefix,
  }) {
    const boardCore = this.#boardCore;
    const boardApi = this.#boardApi;
    const generation = this.#boardGeneration;
    if (boardCore === null || boardApi === null) return;
    const coordinator = createNetworkCoordinator({
      boardCore,
      boardApi,
      url,
      boardId,
      // awareness 下行：volatile 消息（光标等）与成员离开转发 UI
      onAwareness: ({ source, data }) => {
        if (this.#boardGeneration !== generation) return;
        this.#postMessage({
          type: "awareness",
          awarenessType: data?.kind,
          source,
          data,
        });
        // 渲染侧预览：amend 通道的分子中间帧按预览坐标画对象本体（只影响渲染视图）
        if (
          data?.kind === "mol-begin" ||
          data?.kind === "mol-amend" ||
          data?.kind === "mol-end" ||
          data?.kind === "mol-abort"
        ) {
          this.#applyMolMessages(data);
        }
      },
      onDisconnect: () => {
        if (this.#boardGeneration !== generation) return;
        // 断线瞬间对端手势状态不可信：通知 UI 清空全部预览与光标，重连后重建
        this.#postMessage({ type: "awareness", awarenessType: "disconnect" });
        for (const viewportCore of this.#viewportCores.values()) {
          viewportCore.renderer?.clearAllPreviewPositions?.();
        }
        this.#clearAllMolPreviews();
        this.#requestStaticRender();
        scheduleReconnect();
      },
    });
    try {
      await coordinator.connect();
      if (
        this.#boardGeneration !== generation ||
        this.#boardCore !== boardCore ||
        this.#boardApi !== boardApi
      ) {
        await coordinator.close();
        return;
      }
      assign(coordinator);
      this.#log.info(logConnected);
    } catch (error) {
      this.#log.warn(`${logFailedPrefix}：${error?.message ?? error}`);
      await coordinator.close();
      if (this.#boardGeneration === generation) scheduleReconnect();
    }
  }

  /**
   * 应用 amend 通道的分子消息到渲染侧预览坐标
   * @param {Object} data - 分子消息数据（mol-begin / mol-amend / mol-end / mol-abort）
   * @returns {void}
   * @private
   *
   * @description
   * mol-begin 按 before/create 快照的 position 起预览，mol-amend 的 patch.position 以绝对坐标覆盖；
   * mol-end / mol-abort 清除该分子全部预览。预览只存在于渲染器视图，对象数据在分子记录到达时归位；
   * 每个分子挂 3s 超时兜底，消息中断时预览不残留。
   */
  #applyMolMessages(data) {
    if (this.#viewportCores.size === 0) return;
    let changed = false;
    switch (data?.kind) {
      case "mol-begin": {
        if (typeof data.molId !== "string" || !Array.isArray(data.entries)) {
          return;
        }
        if (this.#molPreviewStates.has(data.molId)) return;
        this.#molPreviewStates.set(data.molId, { seq: 0, closed: false });
        const ids = this.#molPreviewIds(data.molId);
        for (const entry of data.entries) {
          if (typeof entry?.objectId !== "string") continue;
          const position = entry.before?.position ?? entry.create?.position;
          if (
            typeof position?.x !== "number" ||
            typeof position?.y !== "number"
          ) {
            continue;
          }
          this.#setPreviewPosition(entry.objectId, position);
          ids.add(entry.objectId);
          changed = true;
        }
        this.#resetMolPreviewTimer(data.molId);
        break;
      }
      case "mol-amend": {
        if (!Array.isArray(data.mols)) return;
        for (const mol of data.mols) {
          if (typeof mol?.molId !== "string" || !Array.isArray(mol.entries)) {
            continue;
          }
          const state = this.#molPreviewStates.get(mol.molId);
          if (!state || state.closed) continue;
          if (typeof mol.seq === "number") {
            if (mol.seq <= state.seq) continue;
            state.seq = mol.seq;
          }
          const ids = this.#molPreviewIds(mol.molId);
          for (const entry of mol.entries) {
            if (typeof entry?.objectId !== "string") continue;
            const position = entry.patch?.position;
            if (
              typeof position?.x !== "number" ||
              typeof position?.y !== "number"
            ) {
              continue;
            }
            this.#setPreviewPosition(entry.objectId, position);
            ids.add(entry.objectId);
            changed = true;
          }
          this.#resetMolPreviewTimer(mol.molId);
        }
        break;
      }
      case "mol-end":
      case "mol-abort": {
        if (typeof data.molId !== "string") return;
        this.#molPreviewStates.set(data.molId, { seq: Infinity, closed: true });
        if (this.#molPreviewStates.size > 1000) {
          this.#molPreviewStates.delete(
            this.#molPreviewStates.keys().next().value,
          );
        }
        changed = this.#dropMolPreview(data.molId);
        break;
      }
      default:
        return;
    }
    if (changed) {
      // 全量缓存重画（预览位置变化后静态缓存按新位置重建）
      this.#requestStaticRender();
    }
  }

  /**
   * 取分子的预览对象 id 集（无则创建）
   * @param {string} molId - 分子 id
   * @returns {Set<string>} 预览对象 id 集
   * @private
   */
  #molPreviewIds(molId) {
    let ids = this.#molPreviews.get(molId);
    if (ids === undefined) {
      ids = new Set();
      this.#molPreviews.set(molId, ids);
    }
    return ids;
  }

  /**
   * 覆盖对象的渲染预览坐标（全部视口）
   * @param {string} objectId - 对象 id
   * @param {{ x: number, y: number }} position - 世界坐标
   * @returns {void}
   * @private
   */
  #setPreviewPosition(objectId, position) {
    for (const viewportCore of this.#viewportCores.values()) {
      viewportCore.renderer?.setPreviewPosition?.(objectId, position);
    }
  }

  /**
   * 重置分子预览的超时定时器（到期按分子失联清预览）
   * @param {string} molId - 分子 id
   * @returns {void}
   * @private
   */
  #resetMolPreviewTimer(molId) {
    const existing = this.#molPreviewTimers.get(molId);
    if (existing !== undefined) clearTimeout(existing);
    this.#molPreviewTimers.set(
      molId,
      setTimeout(() => {
        this.#molPreviewTimers.delete(molId);
        if (this.#dropMolPreview(molId)) {
          this.#requestStaticRender();
        }
      }, MOL_PREVIEW_TIMEOUT_MS),
    );
  }

  /**
   * 清除分子的全部渲染预览（mol-end / mol-abort / 超时）
   * @param {string} molId - 分子 id
   * @returns {boolean} 是否有预览被清除
   * @private
   */
  #dropMolPreview(molId) {
    const timer = this.#molPreviewTimers.get(molId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#molPreviewTimers.delete(molId);
    }
    const ids = this.#molPreviews.get(molId);
    if (ids === undefined) return false;
    this.#molPreviews.delete(molId);
    for (const objectId of ids) {
      for (const viewportCore of this.#viewportCores.values()) {
        viewportCore.renderer?.clearPreviewPosition?.(objectId);
      }
    }
    return true;
  }

  /**
   * 清空全部分子预览登记与超时定时器（断线 / 销毁时调用）
   * @returns {void}
   * @private
   */
  #clearAllMolPreviews() {
    for (const timer of this.#molPreviewTimers.values()) {
      clearTimeout(timer);
    }
    this.#molPreviewTimers.clear();
    this.#molPreviews.clear();
    this.#molPreviewStates.clear();
  }

  /**
   * 调度一次静态层全量刷新（预览坐标变化后缓存按新位置重建）
   * @description invalidateCachedObjects 置缓存脏，invalidateViewport 经调度器安排 rAF flush，
   * markFrameDirty 标记帧回传；三者缺一不可。
   * @returns {void}
   * @private
   */
  #requestStaticRender() {
    for (const viewportCore of this.#viewportCores.values()) {
      viewportCore.renderer?.invalidateCachedObjects?.();
      viewportCore.renderer?.invalidateViewport?.();
      viewportCore.markFrameDirty();
    }
  }

  /**
   * 调度一次协调器重连（板存活且未在计时时才调度）
   * @returns {void}
   * @private
   */
  #scheduleCoordinatorReconnect() {
    if (this.#boardCore === null || this.#syncUrl === null) return;
    if (this.#coordinatorRetryTimer !== null) return;
    this.#coordinatorRetryTimer = setTimeout(() => {
      this.#coordinatorRetryTimer = null;
      void this.#connectCoordinator();
    }, 3000);
  }

  /**
   * 装配持久化（rootPath 有效时）
   * @param {string} [rootPath] - 白板根路径
   * @returns {Promise<{ adapter: Object, store: Object, session: Object, rootPath: string } | null>} 持久化上下文，内存模式为 null
   *
   * @description
   * 可写挂载（布局 v2：GUI 落日志流、活动对象文件与 meta 分片）+ 建板骨架。
   * owner RPC 由 createBoard 在 journaler 就绪后启动。
   * 板不存在时自行建骨架（不再依赖 spawn 侧）。
   * @private
   */
  async #setupPersistence(rootPath) {
    if (typeof rootPath !== "string" || rootPath.trim() === "") {
      return null;
    }
    const driver = createTauriDriver({
      invoke: (command, args) => this.#forwardIoInvoke(command, args),
    });
    // 可写挂载先行（目录不存在且声明写权限时自动创建）
    const registered = await driver.registerRoot(rootPath, {
      read: true,
      write: true,
      ls: true,
      mkdir: true,
      rm: true,
      hide: false,
      zip: false,
    });
    if (!registered?.rootId) {
      throw new Error(`持久化根目录注册失败：${rootPath}`);
    }
    const { rootId } = registered;
    const store = createSessionStore(bindRoot(driver, rootId));
    // 建板骨架（原 daemon 职责收回 GUI；幂等）
    if (!(await store.exists())) {
      await store.create(
        this.#boardSize.width > 0 && this.#boardSize.height > 0
          ? { boardConfig: { ...this.#boardSize } }
          : {},
      );
    }
    const session = await store.loadAll({ includeObjects: false });
    return {
      adapter: createPersistenceAdapter({ driver, rootId }),
      store,
      session,
      rootPath,
    };
  }

  /**
   * 转发 IO 调用到主线程执行
   * @param {string} command - Rust command 名称
   * @param {Object} args - 参数
   * @returns {Promise<*>} 执行结果
   * @private
   */
  #forwardIoInvoke(command, args) {
    const msgId = `io-${++this.#ioMsgSeq}`;
    return new Promise((resolve, reject) => {
      this.#ioPending.set(msgId, { resolve, reject });
      this.#postMessage({ type: "io-invoke", msgId, command, args });
    });
  }

  /**
   * 销毁 Worker 侧 BoardCore
   * @returns {Promise<{ ok: boolean }>} 销毁结果
   */
  async destroyBoard() {
    this.#boardGeneration += 1;
    // 先关 owner RPC 门闸：新请求立即失败，避免销毁后仍被 source 切换阻塞
    this.#ownerRpcClosing = true;
    // 再等在途板操作结束，避免 owner RPC 的 source 切换跨过销毁边界
    await this.#boardOpQueue.catch(() => {});
    const ownerRpc = this.#ownerRpc;
    this.#ownerRpc = null;
    if (this.#coordinatorRetryTimer !== null) {
      clearTimeout(this.#coordinatorRetryTimer);
      this.#coordinatorRetryTimer = null;
    }
    this.#amendForwarder?.close();
    this.#amendForwarder = null;
    this.#clearAllMolPreviews();
    if (this.#coordinator) {
      await this.#coordinator.close();
      this.#coordinator = null;
    }
    this.#syncUrl = null;
    this.#syncBoardId = null;
    this.#unsubscribeRemoteActivity?.();
    this.#unsubscribeRemoteActivity = null;
    this.#unsubscribeHitChanged?.();
    this.#unsubscribeHitChanged = null;
    // 先 flush 写完再停 owner RPC（释放 claim），让等待中的 daemon 接手时盘上数据完整
    if (this.#journaler) {
      await this.#journaler.detach();
      this.#journaler = null;
    }
    if (ownerRpc !== null) {
      try {
        await this.#forwardIoInvoke("stop_owner_rpc", { ownerId: ownerRpc.ownerId });
      } catch (error) {
        this.#log.warn(`停止 owner RPC 失败：${error?.message ?? error}`);
      }
    }
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
      // 内容变脏时主动通知 UI，使其在空闲休眠后能被远端编辑唤醒
      onFrameDirty: () => {
        this.#postMessage({ type: "render-dirty", viewportId });
      },
      tiles: true,
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
   * @returns {import("../kernel/board/aom-render-hooks.js").AomRenderHooks}
   */
  #createViewportRenderHooks() {
    return {
      /**
       * 刷新所有 ViewportCore 的活动层
       * @description
       * 仅失效显式传入的对象。未传对象时刷新全部活动 drawable。
       * @param {import("../kernel/objects/basic-obj.js").BasicObject[]} objectInstances - 受影响对象
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
       * @param {import("../kernel/chunk/chunk.js").Chunk[]} chunks - 需要刷新的区块
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
       * @param {import("../kernel/objects/basic-obj.js").BasicObject[]} objectInstances - 受影响对象
       * @param {import("../kernel/chunk/chunk.js").Chunk[]} fallbackChunks - 回退区块
       * @param {Map<string, import("../kernel/range/index.js").RectangleRange>} previousWorldRects - 旧世界范围快照
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
       * @param {import("../kernel/objects/basic-obj.js").BasicObject[]} _objectInstances - 受影响对象
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
   * @description
   * 通过 {@link ./api/board-api-routes.js} 的路由表分发，
   * 并按路由条目声明的 flush 时机在调用完成后调度渲染帧 flush。
   * @param {string} method - RPC 方法名
   * @param {Record<string, any>} params - RPC 参数
   * @returns {Promise<*>} 调用结果
   */
  async #invokeBoardApi(method, params = {}) {
    const api = this.#boardApi;
    if (!api) {
      throw new Error("BoardApi is not initialized. Call createBoard first.");
    }

    const route = BOARD_API_ROUTES[method];
    if (!route) {
      throw new Error(`Unknown RPC method: ${method}`);
    }

    const result = await invokeBoardApiRoute(
      this.#boardCore,
      api,
      method,
      params,
    );

    if (route.flush === "sync" || route.flush === "async") {
      this.#scheduleFlushRenderFrames();
    }

    return result;
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

    // 倍率可能在会话中变化（跨屏拖动），先同步再按新倍率 resize
    if (Number.isFinite(message?.devicePixelRatio)) {
      viewportCore.setDevicePixelRatio?.(message.devicePixelRatio);
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
    if (query === "reconnect") {
      void this.#reconnectSyncChannels();
      return;
    }
    const boardCore = this.#requireBoardCore();
    handleDebugQuery(boardCore, query, params);
  }

  /**
   * 关闭并重建 relay 同步通道
   * @description 调试动作：通道卡死或状态可疑时手动重建，不走 3s 重连等待。
   * 通道不存在（离线/单机）时仅记录日志。
   * @returns {Promise<void>}
   * @private
   */
  async #reconnectSyncChannels() {
    if (this.#coordinator === null) {
      this.#log.info("调试重连：当前无同步通道（离线/单机）");
      return;
    }
    await this.#coordinator.close().catch(() => {});
    this.#coordinator = null;
    this.#log.info("调试重连：重建 relay 协调器");
    await this.#connectCoordinator();
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
