/**
 * @file UI 侧白板 facade
 * @description
 * Board 是白板在 UI 线程的宿主 facade，负责持有 DevicesDAG、signalsEventBus、viewports 等 UI 运行时。
 * Core 数据职责（对象、区块、AOM）全部在 Worker 侧，UI 侧通过 BoardApiRpc 与之通信。
 * @module ui/components/orchestration/board
 * @author Zhou Chenyu
 */

import { IncrementalIdPool } from "../../../kernel/utils/incremental-id-pool.js";
import { EventBus } from "../../../kernel/utils/event-bus.js";
import { SharedStateStore } from "../../../kernel/utils/shared-state-store.js";
import { DevicesDAG } from "../../devices-dag/index.js";
import { BoardApiRpc } from "../../../host/bridges/board-api-rpc.js";
import { attachIoInvokeForwarder } from "../../../host/bridges/io-invoke-forwarder.js";
import { Viewport } from "./viewport.js";
import { DEFAULT_CHUNK_SIZE } from "../../../kernel/board/board-core.js";
import { joinPath } from "../../../kernel/utils/path.js";
import { Logger } from "../../../utils/log/logger.js";
import { logBus } from "../../../utils/log/log-bus.js";

/**
 * Board 日志
 * @type {Logger}
 */
const boardLog = new Logger("Board", "WARN", logBus);

/**
 * createBoard 默认超时（毫秒）
 * @description 持久化首开要拉起板 daemon，Rust 侧就绪轮询上限 15s，此处留足余量。
 * @type {number}
 */
const CREATE_BOARD_TIMEOUT_MS = 20000;

/**
 * Board 运行时节点配置事件载荷。
 * @typedef {Object} BoardConfigureEventPayload
 * @property {string} to - 目标设备图节点绝对路径，必须包含 viewportId
 * @property {import("../../devices-dag/dag-type.js").DevicesDAGNodeConfig} options - 要更新到节点上的配置片段；`defaultRoute` 传 `null` 或空串表示清空，`handler` 传 `null` 表示清空
 */

/**
 * 白板类（UI Facade）
 * @description
 * Board 是白板在 UI 线程的运行时宿主。所有 Core 数据职责在 Worker 侧，
 * UI 侧仅管理输入路由（DevicesDAG）、视口（Viewport）和 RPC 通信。
 * @class
 * @author Zhou Chenyu
 */
class Board {
  /**
   * BoardApiRpc 实例
   * @type {BoardApiRpc | null}
   */
  #boardApi;

  /**
   * 当前绑定的 Worker 端点
   * @type {{ postMessage: Function, addEventListener: Function, removeEventListener: Function } | null}
   */
  #worker;

  /**
   * IO invoke 转发器卸接函数
   * @type {(() => void) | null}
   */
  #detachIoForwarder;

  /**
   * 区块宽（世界单位；存储与载入粒度，不是板尺寸）
   * @type {number}
   */
  width;

  /**
   * 区块高（世界单位）
   * @type {number}
   */
  height;

  /**
   * 白板文件路径
   * @type {string | undefined}
   */
  rootPath;

  /**
   * 视口列表
   * @type {Map<string, Viewport>}
   */
  viewports;

  /**
   * 信道事件总线
   * @type {EventBus}
   */
  signalsEventBus;

  /**
   * 白板级唯一设备图
   * @type {DevicesDAG}
   */
  devicesDAG;

  /**
   * 跨信道会话状态的共享存储
   * @description
   * 服务于"多个设备与图外 UI 必须达成一致"的场景（如按钮组与工具栏高亮）。
   * 多写者 LWW，订阅同步通知；DAG 内经 `services.sharedState` 注入。
   * @type {SharedStateStore}
   */
  sharedState;

  /**
   * 对象 id 池
   * @type {IncrementalIdPool}
   */
  #idPool;

  /**
   * @param {{
   *   width?: number,
   *   height?: number,
   *   rootPath?: string,
   *   idSource?: string,
   *   syncUrl?: string,
   *   boardId?: string,
   * }} [options={}] - 白板初始化选项
   */
  constructor(options = {}) {
    // width/height 是区块边长（存储与载入粒度），不是板尺寸：世界无限
    this.width =
      Number.isFinite(options.width) && options.width > 0
        ? options.width
        : DEFAULT_CHUNK_SIZE;
    this.height =
      Number.isFinite(options.height) && options.height > 0
        ? options.height
        : DEFAULT_CHUNK_SIZE;
    this.rootPath = isValidBoardRootPath(options.rootPath)
      ? options.rootPath
      : undefined;
    /**
     * 同步中继地址（不传则离线运行）
     * @type {string|undefined}
     */
    this.syncUrl =
      typeof options.syncUrl === "string" && options.syncUrl !== ""
        ? options.syncUrl
        : undefined;
    /**
     * 同步房间 id（缺省取 rootPath：板即房间）
     * @type {string|undefined}
     */
    this.boardId =
      typeof options.boardId === "string" && options.boardId !== ""
        ? options.boardId
        : undefined;

    this.#boardApi = null;
    this.#worker = null;
    this.#detachIoForwarder = null;
    this.#idPool = new IncrementalIdPool(options.idSource ?? "");
    this.viewports = new Map();
    this.signalsEventBus = new EventBus();
    this.devicesDAG = new DevicesDAG({
      maxDispatchDepth: 32,
      strict: globalThis.__JEST__ === true,
    });
    this.sharedState = new SharedStateStore();

    // 根节点 services：声明全局共享基础设施依赖
    const board = this;
    this.devicesDAG.configureNode("/", {
      services: {
        board,
        sharedState: this.sharedState,
        get boardApi() {
          return board.getBoardApi();
        },
      },
    });

    this.#bindSignalsEventBus();
  }

  /**
   * 当前区块宽
   * @type {number}
   */
  get chunkWidth() {
    return this.width;
  }

  /**
   * 当前区块高
   * @type {number}
   */
  get chunkHeight() {
    return this.height;
  }

  /**
   * 对象 id 池的来源标识
   * @type {string}
   */
  get idSource() {
    return this.#idPool.source;
  }

  /**
   * 申请新的对象 id
   * @returns {string} 携带来源命名空间的字符串 id
   */
  allocateObjectId() {
    const id = this.#idPool.allocate();
    // 计数随板元数据持久化（上报在随后的 createObject 之前到达内核，同一通道保序）
    void this.#boardApi?.reportObjectIdCounter?.(
      this.idSource,
      this.#idPool.counter,
    );
    return id;
  }

  /**
   * 按会话元数据续种对象 id 池
   * @param {Object<string, number>} counters - 各来源已分配的最大计数
   * @returns {void}
   * @private
   */
  #reseedIdPool(counters) {
    const counter = counters?.[this.idSource];
    if (Number.isInteger(counter) && counter > 0) {
      this.#idPool.ensureAbove(counter);
    }
  }

  /**
   * 通过 Worker 初始化 BoardApiRpc
   * @description
   * 创建 BoardApiRpc 并在 Worker 中初始化 BoardCore。
   * 必须在创建任何 viewport 之前调用。
   * @param {{ postMessage: Function, addEventListener: Function, removeEventListener: Function }} worker - Worker 或兼容端点
   * @param {{ timeoutMs?: number, readyTimeoutMs?: number, createBoardTimeoutMs?: number }} [options={}] - RPC 选项
   * @returns {Promise<BoardApiRpc>} 已就绪的 BoardApiRpc
   */
  async enableWorkerMode(worker, options = {}) {
    if (this.#boardApi instanceof BoardApiRpc) {
      return this.#boardApi;
    }

    if (this.viewports.size > 0) {
      throw new Error("enableWorkerMode must be called before createViewport.");
    }

    const boardApi = new BoardApiRpc(worker, options);
    boardApi.onBatchError((errors, batchId) => {
      boardLog.warn(
        `Batch ${batchId} reported ${errors.length} failed item(s):`,
        errors,
      );
    });

    // worker 内驱动的文件操作经主线程转发到 Tauri invoke
    this.#detachIoForwarder = attachIoInvokeForwarder(worker);

    try {
      await boardApi.waitUntilReady(
        options.readyTimeoutMs ?? options.timeoutMs,
      );
      await boardApi.createBoard(
        {
          width: this.width,
          height: this.height,
          rootPath: this.rootPath,
          source: this.idSource || undefined,
          syncUrl: this.syncUrl,
          boardId: this.boardId ?? this.rootPath,
        },
        options.createBoardTimeoutMs ?? CREATE_BOARD_TIMEOUT_MS,
      );
      // 按会话元数据续种对象 id 池，避免重开后分配碰撞
      const counters = await boardApi.getObjectIdCounters();
      this.#reseedIdPool(counters);
    } catch (error) {
      boardApi.destroy(error?.message ?? "Failed to enable worker mode.");
      throw error;
    }

    this.#boardApi = boardApi;
    this.#worker = worker;
    return boardApi;
  }

  /**
   * 创建绑定到当前 Board 的 Viewport
   * @description 会同时创建 base/live/ui 三层 canvas，并把 viewport 注册到 `Board.viewports`。
   *   必须在 `enableWorkerMode` 之后调用。
   * @param {HTMLElement} rootElement - Viewport 的根元素
   * @param {{ width: number, height: number }} options - Viewport 尺寸选项
   * @param {string} viewportId - Viewport id
   * @returns {Viewport}
   */
  createViewport(rootElement, { width, height }, viewportId) {
    if (!this.#worker) {
      throw new Error(
        "createViewport requires Worker mode to be enabled. Call enableWorkerMode first.",
      );
    }

    const viewportWidth = width ?? this.chunkWidth;
    const viewportHeight = height ?? this.chunkHeight;
    const viewportRoot = document.createElement("div");
    const canvas = document.createElement("canvas");
    const uiCanvas = document.createElement("canvas");

    viewportRoot.id = `viewport-root-${viewportId}`;
    viewportRoot.className = "viewport-root";
    viewportRoot.style.width = `${viewportWidth}px`;
    viewportRoot.style.height = `${viewportHeight}px`;

    canvas.id = `viewport-canvas-${viewportId}`;
    canvas.className = "viewport-layer viewport-layer-live";

    uiCanvas.id = `viewport-ui-canvas-${viewportId}`;
    uiCanvas.className = "viewport-layer viewport-layer-ui";

    viewportRoot.appendChild(canvas);
    viewportRoot.appendChild(uiCanvas);
    rootElement.appendChild(viewportRoot);

    const viewport = new Viewport(
      {
        rootElement: viewportRoot,
        canvas,
        uiCanvas,
        worker: this.#worker,
      },
      this,
      {
        width: viewportWidth,
        height: viewportHeight,
      },
      viewportId,
    );

    this.viewports.set(viewportId, viewport);
    this.devicesDAG.configureNode(viewportId, {
      services: { viewport },
      semantics: { viewport: true },
    });

    this.#boardApi
      .createViewport({
        viewportId,
        width: viewportWidth,
        height: viewportHeight,
      })
      .then(() => {
        viewport.startWorkerSync?.();
      })
      .catch((error) => {
        console.error("[Board] Failed to create worker viewport:", error);
      });

    return viewport;
  }

  /**
   * 绑定信道相关事件
   * @description 单个信号包的分发失败只记录日志，不中断输入循环。
   * @private
   */
  #bindSignalsEventBus() {
    // input 事件负责将信号送往对应节点
    this.signalsEventBus.on("input", ({ to, signals }) => {
      try {
        this.devicesDAG.dispatch({ to, signals });
      } catch (error) {
        boardLog.error(`dispatch failed for "${to}":`, error);
      }
    });
  }

  /**
   * 获取 BoardApiRpc 实例
   * @returns {BoardApiRpc | null}
   */
  getBoardApi() {
    return this.#boardApi;
  }
}

/**
 * 校验白板根路径是否合法
 * @param {string} boardRootPath - 白板根路径
 * @returns {boolean}
 */
function isValidBoardRootPath(boardRootPath) {
  return typeof boardRootPath === "string" && boardRootPath.trim() !== "";
}

export { Board };
