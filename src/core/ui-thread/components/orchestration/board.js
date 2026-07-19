/**
 * @file UI 侧白板 facade
 * @description
 * Board 是白板在 UI 线程的宿主 facade，负责持有 DevicesDAG、signalsEventBus、viewports 等 UI 运行时。
 * Core 数据职责（对象、区块、AOM、UndoTree）全部在 Worker 侧，UI 侧通过 BoardApiRpc 与之通信。
 * @module core/ui-thread/components/orchestration/board
 * @author Zhou Chenyu
 */

import { CounterPool } from "../../../engine/utils/counter-pool.js";
import { EventBus } from "../../../engine/utils/event-bus.js";
import { DevicesDAG } from "../../devices-dag/index.js";
import { BoardApiRpc } from "../../../bridges/board-api-rpc.js";
import { Viewport } from "./viewport.js";
import { joinPath } from "../../../engine/utils/path.js";

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
   * 白板宽度
   * @type {number}
   */
  width;

  /**
   * 白板高度
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
   * 对象 id 池
   * @type {CounterPool}
   */
  #counterPool;

  /**
   * @param {{
   *   width?: number,
   *   height?: number,
   *   rootPath?: string,
   * }} [options={}] - 白板初始化选项
   */
  constructor(options = {}) {
    this.width = options.width ?? 0;
    this.height = options.height ?? 0;
    this.rootPath = isValidBoardRootPath(options.rootPath)
      ? options.rootPath
      : undefined;

    this.#boardApi = null;
    this.#worker = null;
    this.#counterPool = new CounterPool();
    this.viewports = new Map();
    this.signalsEventBus = new EventBus();
    this.devicesDAG = new DevicesDAG({
      maxDispatchDepth: 32,
      strict: globalThis.__JEST__ === true,
    });

    // 根节点 services：声明全局共享基础设施依赖
    const board = this;
    this.devicesDAG.configureNode("/", {
      services: {
        board,
        get boardApi() {
          return board.getBoardApi();
        },
      },
    });

    this.#bindSignalsEventBus();
  }

  /**
   * 当前区块宽（等于白板宽度）
   * @type {number}
   */
  get chunkWidth() {
    return this.width;
  }

  /**
   * 当前区块高（等于白板高度）
   * @type {number}
   */
  get chunkHeight() {
    return this.height;
  }

  /**
   * 申请新的对象 id
   * @returns {number}
   */
  allocateObjectId() {
    return this.#counterPool.generate();
  }

  /**
   * 通过 Worker 初始化 BoardApiRpc
   * @description
   * 创建 BoardApiRpc 并在 Worker 中初始化 BoardCore。
   * 必须在创建任何 viewport 之前调用。
   * @param {{ postMessage: Function, addEventListener: Function, removeEventListener: Function }} worker - Worker 或兼容端点
   * @param {{ timeoutMs?: number, readyTimeoutMs?: number }} [options={}] - RPC 选项
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

    try {
      await boardApi.waitUntilReady(
        options.readyTimeoutMs ?? options.timeoutMs,
      );
      await boardApi.createBoard({
        width: this.width,
        height: this.height,
        rootPath: this.rootPath,
      });
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
   * @private
   */
  #bindSignalsEventBus() {
    // input 事件负责将信号送往对应节点
    this.signalsEventBus.on("input", ({ to, signals }) => {
      this.devicesDAG.dispatch({ to, signals });
    });
  }

  /**
   * 申请新的对象 id
   * @returns {number}
   */
  allocateObjectId() {
    return this.#counterPool.generate();
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
