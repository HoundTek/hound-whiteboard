/**
 * @file UI 侧白板 facade
 * @description
 * Board 类是白板在 UI 线程的宿主 facade，负责持有 DevicesDAG、signalsEventBus、viewports 等 UI 运行时，
 * 并将 Core 数据职责（对象注册、区块加载、AOM、UndoTree、持久化）委托给 BoardCore。
 * 一个 Board 实例对应一个白板管辖。
 * @module core/components/board
 * @author Zhou Chenyu
 */

import { BasicObject } from "../../objects/basic-obj.js";
import { CounterPool } from "../../utils/counter-pool.js";
import { EventBus } from "../../utils/event-bus.js";
import { DevicesDAG } from "../../devices-dag/index.js";
import { BoardCore } from "./board-core.js";
import { createBoardRenderHooks } from "./board-render-hooks.js";
import { createRendererPersistenceAdapter } from "../../bridges/persistence-adapter.js";
import { boardFileOperateBridge } from "../../bridges/file-operate-bridge-renderer.js";
import { BoardApiRpc } from "../../bridges/board-api.js";
import { Viewport } from "./viewport.js";

function isValidBoardRootPath(boardRootPath) {
  return typeof boardRootPath === "string" && boardRootPath.trim() !== "";
}

/**
 * Board 运行时节点配置事件载荷。
 * @typedef {Object} BoardConfigureEventPayload
 * @property {string} to - 目标设备图节点绝对路径，必须包含 viewportId
 * @property {import("../../devices-dag/dag.js").DevicesDAGNodeConfig} options - 要更新到节点上的配置片段；`defaultRoute` 传 `null` 或空串表示清空，`handler` 传 `null` 表示清空
 */

/**
 * 白板类（UI Facade）
 * @description
 * Board 是白板在 UI 线程的运行时宿主，不再直接承担所有 Core 数据职责。
 * 内部持有 BoardCore 实例，Core 侧的数据与方法通过委托访问。
 * 保留 DevicesDAG、signalsEventBus、viewports、createViewport() 等 UI 专用能力。
 * @class
 * @author Zhou Chenyu
 */
class Board {
  /**
   * BoardCore 实例
   * @type {BoardCore}
   */
  #boardCore;

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
   * 时间回溯树（委托至 BoardCore）
   * @type {import("../../hit/undo-tree-core.js").UndoTree}
   */
  undoTree;

  /**
   * 活动对象管理器（委托至 BoardCore）
   * @type {import("./active-object-manager.js").ActiveObjectManager}
   */
  activeObjectManager;

  /**
   * 当前已知区块的统一加载状态（委托至 BoardCore）
   * @type {Map<number, BoardChunkLoadedState>}
   */
  chunkLoaded;

  /**
   * 白板级对象实例注册表（委托至 BoardCore）
   * @type {Map<number, BoardObjectLoadedState>}
   */
  objectLoaded;

  /**
   * 区块加载事件总线（委托至 BoardCore）
   * @type {EventBus}
   */
  chunkLoadEventBus;

  /**
   * 根区块加载器（委托至 BoardCore）
   * @type {import("../chunk/chunk-loader.js").ChunkLoader}
   */
  rootChunkLoader;

  /**
   * 白板的宽度（委托至 BoardCore）
   * @type {number}
   */
  get width() {
    return this.#boardCore.width;
  }

  set width(value) {
    this.#boardCore.width = value;
  }

  /**
   * 白板的高度（委托至 BoardCore）
   * @type {number}
   */
  get height() {
    return this.#boardCore.height;
  }

  set height(value) {
    this.#boardCore.height = value;
  }

  /**
   * 白板的文件路径（委托至 BoardCore）
   * @type {string | undefined}
   */
  get rootPath() {
    return this.#boardCore.rootPath;
  }

  set rootPath(value) {
    this.#boardCore.rootPath = value;
  }

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
   * @param {{
   *   width?: number,
   *   height?: number,
   *   rootPath?: string,
   * }} [options={}] - 白板初始化选项
   */
  constructor(options = {}) {
    // 1. 创建 UI 侧渲染钩子（在 viewports Map 准备好之前先创建，实际连接在 createViewport 后生效）
    const renderHooks = createBoardRenderHooks(
      () => this.viewports,
      () => this.activeObjectManager?.activeObjects,
    );

    // 2. 创建持久化适配器
    const effectiveRootPath = isValidBoardRootPath(options.rootPath)
      ? options.rootPath
      : undefined;
    const persistenceAdapter = effectiveRootPath
      ? createRendererPersistenceAdapter(
          effectiveRootPath,
          boardFileOperateBridge,
        )
      : undefined;

    // 3. 创建 BoardCore
    this.#boardCore = new BoardCore({
      width: options.width,
      height: options.height,
      rootPath: effectiveRootPath,
      aomRenderHooks: renderHooks,
      persistenceAdapter,
    });

    // 4. 绑定 Core 数据引用（指向 BoardCore 内部实例）
    this.undoTree = this.#boardCore.undoTree;
    this.chunkLoaded = this.#boardCore.chunkLoaded;
    this.objectLoaded = this.#boardCore.objectLoaded;
    this.chunkLoadEventBus = this.#boardCore.chunkLoadEventBus;
    this.rootChunkLoader = this.#boardCore.rootChunkLoader;
    this.activeObjectManager = this.#boardCore.activeObjectManager;

    // 5. BoardApiRpc 实例初始为 null，通过 enableWorkerMode 初始化
    this.#boardApi = null;

    // 6. UI 专用初始化
    this.#worker = null;
    this.viewports = new Map();
    this.signalsEventBus = new EventBus();
    this.devicesDAG = new DevicesDAG({
      maxDispatchDepth: 32,
    });
    this.#bindSignalsEventBus();
  }

  /**
   * 是否使用内存模式
   * @returns {boolean}
   */
  memoryMode() {
    return this.#boardCore.memoryMode();
  }

  /**
   * 当前白板是否启用文件系统持久化
   * @returns {boolean}
   */
  isPersistent() {
    return this.#boardCore.isPersistent();
  }

  /**
   * 解析当前白板可用的持久化根路径
   * @param {string} [boardRootPath=this.rootPath] - 候选根路径
   * @returns {string | undefined}
   */
  resolvePersistenceRootPath(boardRootPath = this.rootPath) {
    return this.#boardCore.resolvePersistenceRootPath(boardRootPath);
  }

  /**
   * 创建绑定到当前 Board 的 ChunkLoader
   * @param {number | string} [requesterId] - 请求方 id
   * @returns {import("../chunk/chunk-loader.js").ChunkLoader}
   */
  createChunkLoader(requesterId) {
    return this.#boardCore.createChunkLoader(requesterId);
  }

  /**
   * 获取白板根区块加载器
   * @returns {import("../chunk/chunk-loader.js").ChunkLoader}
   */
  getChunkLoader() {
    return this.#boardCore.getChunkLoader();
  }

  /**
   * 按 id 获取区块实例
   * @param {number} chunkId - 区块 id
   * @returns {import("../chunk/chunk.js").Chunk | undefined}
   */
  getChunkById(chunkId) {
    return this.#boardCore.getChunkById(chunkId);
  }

  /**
   * 按坐标获取区块实例
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {import("../chunk/chunk.js").Chunk | undefined}
   */
  getChunkByCoordinate(x, y) {
    return this.#boardCore.getChunkByCoordinate(x, y);
  }

  /**
   * 获取区块的左右邻区块
   * @param {import("../chunk/chunk.js").Chunk} chunk - 当前区块
   * @param {"right" | "left" | "up" | "down"} direction - 方向
   * @returns {import("../chunk/chunk.js").Chunk | undefined}
   */
  getNeighborChunk(chunk, direction) {
    return this.#boardCore.getNeighborChunk(chunk, direction);
  }

  /**
   * 获取某区块当前总持有数
   * @param {number} chunkId - 区块 id
   * @returns {number}
   */
  getChunkLoadCount(chunkId) {
    return this.#boardCore.getChunkLoadCount(chunkId);
  }

  /**
   * 获取对象加载状态条目
   * @param {number} objectId - 对象 id
   * @returns {object | undefined}
   */
  getObjectEntry(objectId) {
    return this.#boardCore.getObjectEntry(objectId);
  }

  /**
   * 获取对象实例
   * @param {number} objectId - 对象 id
   * @returns {BasicObject | undefined}
   */
  getObjectById(objectId) {
    return this.#boardCore.getObjectById(objectId);
  }

  /**
   * 获取对象当前完整加载计数
   * @param {number} objectId - 对象 id
   * @returns {number}
   */
  getObjectLoadCount(objectId) {
    return this.#boardCore.getObjectLoadCount(objectId);
  }

  /**
   * 注册对象实例到白板级对象表
   * @param {BasicObject} obj - 对象实例
   * @param {{ coveredChunkIds?: Iterable<number> }} [options={}] - 额外选项
   * @returns {BasicObject}
   */
  registerObjectInstance(obj, options = {}) {
    return this.#boardCore.registerObjectInstance(obj, options);
  }

  /**
   * 获取对象覆盖区块集合
   * @param {number} objectId - 对象 id
   * @param {Iterable<number>} [candidateChunkIds=[]] - 候选区块 id
   * @returns {Set<number>}
   */
  getObjectCoverChunks(objectId, candidateChunkIds = []) {
    return this.#boardCore.getObjectCoverChunks(objectId, candidateChunkIds);
  }

  /**
   * 按区块加载对象实例到白板级对象表
   * @param {import("../chunk/chunk.js").Chunk | number} chunkOrId - 区块实例或区块 id
   * @param {string} [boardRootPath=this.rootPath] - 白板根路径
   * @returns {Promise<Map<number, BasicObject>>}
   */
  async loadChunkObjectEntries(chunkOrId, boardRootPath = this.rootPath) {
    return this.#boardCore.loadChunkObjectEntries(chunkOrId, boardRootPath);
  }

  /**
   * 保存指定区块归属的对象
   * @param {import("../chunk/chunk.js").Chunk | number} chunkOrId - 区块实例或区块 id
   * @param {string} [boardRootPath=this.rootPath] - 白板根路径
   * @returns {Promise<void>}
   */
  async saveChunkObjectEntries(chunkOrId, boardRootPath = this.rootPath) {
    return this.#boardCore.saveChunkObjectEntries(chunkOrId, boardRootPath);
  }

  /**
   * 根据区块当前加载状态同步其对象 loadedCount，并清理失活对象
   * @param {import("../chunk/chunk.js").Chunk | number} chunkOrId - 区块实例或区块 id
   * @returns {Promise<void>}
   */
  async syncChunkObjectEntries(chunkOrId) {
    return this.#boardCore.syncChunkObjectEntries(chunkOrId);
  }

  /**
   * 卸载指定区块相关的对象实例
   * @param {import("../chunk/chunk.js").Chunk | number} chunkOrId - 区块实例或区块 id
   */
  unloadChunkObjectEntries(chunkOrId) {
    return this.#boardCore.unloadChunkObjectEntries(chunkOrId);
  }

  /**
   * 添加对象到白板
   * @param {BasicObject} obj - 要添加的对象
   */
  addObject(obj) {
    return this.#boardCore.addObject(obj);
  }

  /**
   * 通过 Worker 初始化 BoardApiRpc 与 BoardCore
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
      handler: () => ({ acc: { viewport } }),
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
      const viewportId = to.split("/")[1];
      const viewport = this.viewports.get(viewportId);
      if (viewport) {
        this.devicesDAG.dispatch(
          { to, signals },
          { board: this, boardApi: this.#boardApi },
        );
      }
    });

    const resolveWorkflowPath = (viewportId, name) =>
      `/${viewportId}/workflows/${name}`;

    // mount 事件负责挂载 workflow 到设备图。
    this.signalsEventBus.on(
      "mount",
      ({ viewportId, name, workflow, edges = [] } = {}) => {
        const viewport = this.viewports.get(viewportId);
        if (!viewport || !name || !workflow) return false;

        const workflowPath = resolveWorkflowPath(viewportId, name);
        const mountedNode = this.devicesDAG.mountWorkflow(
          workflowPath,
          workflow,
          {
            board: this,
            viewport,
          },
        );

        /**
         * 在已挂载的单源单汇子图中找到汇节点
         * @param {import("../../devices-dag/dag-node-edge.js").DevicesDAGNode[]} mountedNodes
         * @returns {import("../../devices-dag/dag-node-edge.js").DevicesDAGNode|undefined}
         */
        const findPrefixSink = (mountedNodes = []) => {
          if (mountedNodes.length === 1) return mountedNodes[0];
          return mountedNodes.find((n) => {
            for (const outEdge of n.outEdges.values()) {
              if (mountedNodes.includes(outEdge.target)) return false;
            }
            return true;
          });
        };

        for (const { from, edge, prefix } of edges) {
          const sourcePath = `/${viewportId}${from}`;

          if (prefix) {
            const prefixSubDAG = { ...prefix, rootPath: `/${edge}` };
            const prefixNodes = this.devicesDAG.mountSubDAG(
              sourcePath,
              prefixSubDAG,
            );
            const sinkNode = findPrefixSink(prefixNodes);
            if (sinkNode?.path) {
              this.devicesDAG.addEdge(sinkNode.path, edge, workflowPath);
            }
          } else {
            this.devicesDAG.addEdge(sourcePath, edge, workflowPath);
          }
        }

        return mountedNode;
      },
    );

    // umount 事件负责从设备图卸载 workflow。
    this.signalsEventBus.on(
      "umount",
      ({ viewportId, name, edges = [] } = {}) => {
        const viewport = this.viewports.get(viewportId);
        if (!viewport || !name) return false;

        const workflowPath = resolveWorkflowPath(viewportId, name);
        for (const { from, edge } of edges) {
          this.devicesDAG.removeEdge(`/${viewportId}${from}`, edge);
        }

        return this.devicesDAG.unmountWorkflow(workflowPath, {
          acc: { board: this, boardApi: this.#boardApi, viewport },
        });
      },
    );
  }

  /**
   * 对象 id 池
   * @type {CounterPool}
   * @private
   */
  #counterPool = new CounterPool();

  /**
   * 申请新的对象 id
   * @returns {number}
   */
  allocateObjectId() {
    return this.#counterPool.generate();
  }

  /**
   * 当前区块宽（取自 BoardCore）
   * @type {number}
   */
  get chunkWidth() {
    return this.width;
  }

  /**
   * 当前区块高（取自 BoardCore）
   * @type {number}
   */
  get chunkHeight() {
    return this.height;
  }

  /**
   * 获取 BoardApiRpc 实例
   * @description 返回通过 enableWorkerMode 初始化的 RPC 端点。
   * 调用方通过该接口以 objectId 令牌与 Worker 侧 BoardCore 交互。
   * @returns {BoardApiRpc | null}
   */
  getBoardApi() {
    return this.#boardApi;
  }
}

const boardMeta = {
  type: "board",
  version: "0.1.0",
};

export { Board };
