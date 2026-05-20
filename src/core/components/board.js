/**
 * 白板组件
 * @description
 * Board 类是白板在面向对象设计中的抽象核心，负责管理页、对象、历史等信息，
 * 并提供相关初级接口供工具和设备调用。一个 Board 实例对应一个白板管辖。
 * @module board
 * @author Zhou Chenyu
 */

import { BasicObject } from "../objects/basic-obj.js";
import { CounterPool } from "../utils/counter-pool.js";
import { DirectedGraph } from "../utils/directed-graph.js";
import { EventBus } from "../utils/event-bus.js";
import { UndoTree } from "../hit/undo-tree-core.js";
import { ActiveObjectManager } from "./active-object-manager.js";
import { Monitor } from "./monitor.js";
import {
  PageLoader,
  PAGE_LOAD_MANAGER_EVENTS,
  PAGE_LOAD_STRATEGIES,
} from "./page-loader.js";
import { Page } from "./page.js";
import { boardFileOperateBridge } from "../bridges/file-operate-bridge-renderer.js";

/**
 * @typedef {Object} BoardPageLoadedState
 * @property {Page} page - 当前页实例
 * @property {number} tempLoadedCount - 临时加载计数
 * @property {number} fullLoadedCount - 完整加载计数
 * @property {Map<number | string, "temp" | "full">} loaderStrategy - 各 PageLoader 当前持有策略
 */

/**
 * Board 运行时节点配置事件载荷。
 * @typedef {Object} BoardConfigureEventPayload
 * @property {string} to - 目标设备树节点绝对路径，必须包含 monitorId
 * @property {import("../devices/devices-tree.js").DevicesTreeNodeConfig} options - 要更新到节点上的配置片段；`defaultPath` 传 `null` 或空串表示清空，`processor`/`rewritePacket` 传 `null` 表示清空
 */

/**
 * 白板类
 * @description 一个白板实例就对应了一个白板管辖。
 * @class
 * @author Zhou Chenyu
 */
class Board {
  /**
   * 时间回溯树
   * @type {UndoTree}
   */
  undoTree;

  /**
   * 活动对象管理器
   * @type {ActiveObjectManager}
   * @description 管理当前活动对象（如选中对象、正在操作的对象等）
   */
  activeObjectManager;

  /**
    * 当前已知页的统一加载状态
    * @type {Map<number, BoardPageLoadedState>}
   */
    pageLoaded;

  /**
   * 白板的高度
   * @type {number}
   */
  height;

  /**
   * 白板的宽度
   * @type {number}
   */
  width;

  /**
   * 白板的文件路径
   * @type {string}
   */
  rootPath;

  /**
   * 页 id 池
   * @type {CounterPool}
   */
  pageCounterPool;

  /**
   * 对象 id 池
   * @type {CounterPool}
   */
  objectCounterPool;

  /**
   * 页加载事件总线
   * @type {EventBus}
   */
  pageLoadEventBus;

  /**
   * 显示器列表
   * @type {Map<string, Monitor>}
   */
  monitors;

  /**
   * 信道事件总线
   * @type {EventBus}
   */
  signalsEventBus;

  constructor() {
    this.undoTree = new UndoTree();
    this.pageLoaded = new Map();
    this.pageCounterPool = new CounterPool();
    this.objectCounterPool = new CounterPool();
    this.pageLoadEventBus = new EventBus();
    this.monitors = new Map();
    this.signalsEventBus = new EventBus();
    this.activeObjectManager = new ActiveObjectManager(this);
    this.#bindPageLoadEvents();
    this.#bindSignalsEventBus();
  }

  /**
   * 创建绑定到当前 Board 的页加载器
   * @param {number} [limit = 0] - 缓冲区上限，为 0 则不限制
   * @param {number | string} [requesterId] - 请求方 id
   * @returns {PageLoader}
   */
  createPageLoader(limit = 0, requesterId) {
    return new PageLoader(
      limit,
      this.pageLoadEventBus,
      requesterId,
      (page, direction) => this.getNeighborPage(page, direction),
    );
  }

  /**
   * 申请新的对象 id
   * @returns {number}
   */
  allocateObjectId() {
    return this.objectCounterPool.generate();
  }

  /**
   * 按 id 获取页实例，不存在时惰性创建
   * @param {number} pageId - 页 id
   * @returns {Page | undefined}
   */
  getPageById(pageId) {
    const pageState = this.#getOrCreatePageLoadedState(pageId);
    const page = pageState.page;

    this.#syncPageNeighborRefs(page);
    return page;
  }

  /**
   * 按坐标获取页实例，不存在时惰性创建
   * @param {number} x - 页二维坐标 x
   * @param {number} y - 页二维坐标 y
   * @returns {Page | undefined}
   */
  getPageByCoordinate(x, y) {
    const pageId = Page.coordinateToId(x, y);
    return this.getPageById(pageId);
  }

  /**
   * 获取页的左右邻页
   * @param {Page} page - 当前页
   * @param {"right" | "left" | "up" | "down"} direction - 方向
   * @returns {Page | undefined}
   */
  getNeighborPage(page, direction) {
    if (!page) return undefined;

    const delta = {
      right: { x: 1, y: 0 },
      left: { x: -1, y: 0 },
      up: { x: 0, y: 1 },
      down: { x: 0, y: -1 },
    }[direction];
    if (!delta) return undefined;

    return this.getPageByCoordinate(page.x + delta.x, page.y + delta.y);
  }

  /**
   * 同步页的四向邻页引用
   * @param {Page} page - 页实例
   * @private
   */
  #syncPageNeighborRefs(page) {
    if (!page) return;

    const directions = [
      ["right", 1, 0],
      ["left", -1, 0],
      ["up", 0, 1],
      ["down", 0, -1],
    ];

    for (const [direction, deltaX, deltaY] of directions) {
      const neighborId = Page.coordinateToId(page.x + deltaX, page.y + deltaY);

      const neighbor = this.pageLoaded.get(neighborId)?.page;
      if (!neighbor) continue;
      Page.connectTwoPage(page, neighbor, direction);
    }
  }

  /**
   * 获取或创建页加载状态。
   * @param {number} pageId - 页 id
   * @returns {BoardPageLoadedState}
   * @private
   */
  #getOrCreatePageLoadedState(pageId) {
    if (!this.pageLoaded.has(pageId)) {
      this.pageLoaded.set(pageId, {
        page: Page.fromId(pageId),
        tempLoadedCount: 0,
        fullLoadedCount: 0,
        loaderStrategy: new Map(),
      });
    }

    return this.pageLoaded.get(pageId);
  }

  /**
   * 创建绑定到当前 Board 的 Monitor
   * @param {HTMLElement} rootElement - Monitor 的根元素
   * @param {{ width: number, height: number }} options - Monitor 尺寸选项
   * @param {string} monitorId - Monitor id
   * @returns {Monitor}
   */
  createMonitor(rootElement, { width, height }, monitorId) {
    const monitorCanvas = document.createElement("canvas");
    rootElement.appendChild(monitorCanvas);
    const monitor = new Monitor(
      monitorCanvas,
      this,
      {
        width: width ?? this.pageWidth,
        height: height ?? this.pageHeight,
      },
      monitorId,
    );
    // [todo] 监听 Monitor 的视口变化事件以更新 Board 的 origin 和 zoom
    this.monitors.set(monitorId, monitor);
    return monitor;
  }

  /**
   * 添加对象到指定页
   * @param {BasicObject} obj - 要添加的对象
   * @param {number} [pageId = obj.ownerPageId] - 要添加到的归属页 id
   */
  addObject(obj, pageId = obj?.ownerPageId) {
    if (!(obj instanceof BasicObject)) {
      throw new TypeError("Invalid object instance.");
    }
    const page = this.getPageById(pageId);
    if (!page) {
      console.warn(`Page ${pageId} does not exist.`);
      throw new Error("Page not exist.");
    }

    page.addObject(obj);

    if (page.objectManager && this.width > 0 && this.height > 0) {
      page.objectManager.syncObjectCoverPagesForObject(
        obj,
        this.width,
        this.height,
      );
    }
  }

  /**
   * 绑定信道相关事件
   * @private
   */
  #bindSignalsEventBus() {
    // input 事件负责将信号送往对应节点
    this.signalsEventBus.on("input", ({ to, signals }) => {
      const monitorId = to.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (monitor) {
        monitor.devicesTree.dispatch({ to, signals });
      }
    });

    // mount 事件负责挂载工具到设备树
    this.signalsEventBus.on("mount", ({ to, tool }) => {
      const monitorId = to?.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (!monitor) return false;
      return monitor.devicesTree.mountTool(to, tool, {
        board: this,
        monitor,
      });
    });

    // umount 事件负责从设备树卸载工具
    this.signalsEventBus.on("umount", ({ to }) => {
      const monitorId = to?.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (!monitor) return false;
      return monitor.devicesTree.unmountTool(to);
    });

    // configure 事件负责更新设备树节点配置
    this.signalsEventBus.on("configure", ({ to, options }) => {
      const monitorId = to?.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (!monitor) return false;
      return monitor.devicesTree.configureNode(to, options ?? {});
    });
  }

  /**
   * 绑定页加载相关事件
   * @private
   */
  #bindPageLoadEvents() {
    this.pageLoadEventBus.on(
      PAGE_LOAD_MANAGER_EVENTS.REQUEST_LOAD,
      ({ requesterId, page, strategy, alreadyBuffered }) => {
        this.#loadPage(page, strategy, alreadyBuffered, requesterId).catch(
          (error) => {
            console.error("Failed to load page via IPC bridge:", error);
          },
        );
      },
    );

    this.pageLoadEventBus.on(
      PAGE_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD,
      ({ requesterId, page }) => {
        this.#unloadPage(page, requesterId).catch((error) => {
          console.error("Failed to unload page:", error);
        });
      },
    );
  }

  /**
   * 加载页
   * @param {Page} page - 要加载的页
   * @param {"temp" | "full"} strategy - 加载策略
   * @param {boolean} alreadyBuffered - 是否已经在缓冲区中
   * @param {number | string} requesterId - 发起加载请求的 PLM id
   * @returns {Promise<boolean>} 是否成功加载
   * @private
   */
  async #loadPage(page, strategy, alreadyBuffered, requesterId) {
    if (!page || requesterId === undefined) return false;

    const effectiveStrategy = this.#registerPageLoadRequest(
      page.id,
      requesterId,
      strategy,
    );

    const boardRootPath = this.rootPath;

    if (effectiveStrategy === PAGE_LOAD_STRATEGIES.FULL) {
      const changed = await page.loadFull(boardRootPath);
      return changed;
    }

    if (page.isLoad && !page.isTempLoad) {
      return false;
    }

    return page.loadTemp(boardRootPath);
  }

  /**
   * 卸载页
   * @param {Page} page - 要卸载的页
   * @param {number | string} requesterId - 发起卸载请求的 PLM id
   * @returns {Promise<boolean>} 是否成功卸载
   * @private
   */
  async #unloadPage(page, requesterId) {
    if (!page || requesterId === undefined) return false;

    const removedStrategy = this.#unregisterPageLoadRequest(
      page.id,
      requesterId,
    );
    if (!removedStrategy) return false;

    const pageState = this.pageLoaded.get(page.id);
    const fullLoadedCount = pageState?.fullLoadedCount ?? 0;
    const tempLoadedCount = pageState?.tempLoadedCount ?? 0;

    if (fullLoadedCount > 0) {
      return false;
    }

    if (tempLoadedCount > 0) {
      if (!page.isLoad) return false;
      return page.isTempLoad ? false : page.downgradeToTemp();
    }

    if (!page.isLoad) return false;
    return page.isTempLoad ? page.unloadTemp() : page.unload();
  }

  /**
   * 持久化页连接信息
   * @private
   */
  async #persistPageConnection() {
    if (!this.rootPath) return;
    await boardFileOperateBridge.writePageConnection(this.rootPath, {
      count: this.pageCounterPool.counter,
    });
  }

  /**
   * 记录某个页klfakkdk对某页的加载持有关系
   * @param {number} pageId - 页 id
   * @param {number | string} requesterId - 页加载器 id
   * @param {"temp" | "full"} strategy - 加载策略
   * @returns {"temp" | "full"} 生效后的策略
   * @private
   */
  #registerPageLoadRequest(pageId, requesterId, strategy) {
    const pageState = this.#getOrCreatePageLoadedState(pageId);
    const previousStrategy = pageState.loaderStrategy.get(requesterId);
    const effectiveStrategy =
      previousStrategy === PAGE_LOAD_STRATEGIES.FULL
        ? PAGE_LOAD_STRATEGIES.FULL
        : strategy;

    if (previousStrategy === effectiveStrategy) {
      return effectiveStrategy;
    }

    if (previousStrategy === PAGE_LOAD_STRATEGIES.TEMP) {
      pageState.tempLoadedCount = Math.max(0, pageState.tempLoadedCount - 1);
    } else if (previousStrategy === PAGE_LOAD_STRATEGIES.FULL) {
      pageState.fullLoadedCount = Math.max(0, pageState.fullLoadedCount - 1);
    }

    pageState.loaderStrategy.set(requesterId, effectiveStrategy);
    if (effectiveStrategy === PAGE_LOAD_STRATEGIES.FULL) {
      pageState.fullLoadedCount += 1;
    } else {
      pageState.tempLoadedCount += 1;
    }
    return effectiveStrategy;
  }

  /**
   * 取消某个 PLM 对某页的加载持有关系
   * @param {number} pageId - 页 id
   * @param {number | string} requesterId - PLM id
   * @returns {"temp" | "full" | undefined} 被移除的策略
   * @private
   */
  #unregisterPageLoadRequest(pageId, requesterId) {
    const pageState = this.pageLoaded.get(pageId);
    if (!pageState) return undefined;

    const previousStrategy = pageState.loaderStrategy.get(requesterId);
    if (!previousStrategy) return undefined;

    pageState.loaderStrategy.delete(requesterId);

    if (previousStrategy === PAGE_LOAD_STRATEGIES.FULL) {
      pageState.fullLoadedCount = Math.max(0, pageState.fullLoadedCount - 1);
    } else {
      pageState.tempLoadedCount = Math.max(0, pageState.tempLoadedCount - 1);
    }

    return previousStrategy;
  }

  /**
   * 获取某页当前总持有数
   * @param {number} pageId - 页 id
   * @returns {number}
   * @private
   */
  #getPageLoadCount(pageId) {
    const pageState = this.pageLoaded.get(pageId);
    if (!pageState) return 0;
    return pageState.tempLoadedCount + pageState.fullLoadedCount;
  }
}

const boardMeta = {
  type: "board",
  version: "0.1.0",
};

export { Board };
