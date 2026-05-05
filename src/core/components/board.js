/**
 * 白板组件
 * @description
 * Board 类是白板在面向对象设计中的抽象核心，负责管理页、对象、历史等信息，
 * 并提供相关初级接口供工具和设备调用。一个 Board 实例对应一个白板管辖。
 * @module board
 * @author Zhou Chenyu
 */

import { Deque } from "../../utils/deque.js";
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
import { PageObjectManager } from "./page-object-manager.js";
import { boardFileOperateBridge } from "../bridges/file-operate-bridge-renderer.js";

/**
 * 白板类
 * @description 一个白板实例就对应了一个白板管辖。
 * @class
 * @author Zhou Chenyu
 */
class Board {
  /**
   * 页缓冲区上限
   * @description 已加载的页不超过 4 页（包含临时加载和完整加载）。
   * @type {number}
   */
  static PAGE_BUFFER_LIMIT = 4;

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
   * 页 id -> 页实例映射
   * @description 拥有页实例的所有权
   * @type {Map<number, Page>}
   */
  pageMap;

  /**
   * 页顺序（使用 id）
   * @type {number[]}
   */
  pageOrder;

  /**
   * 某页被临时加载的次数
   * @description 仅当页被临时加载时才增加
   * @type {Map<number, number>}
   */
  pageTemporaryLoadedCount;

  /**
   * 某页被完整加载的次数
   * @description 仅当页被完整加载时才增加
   * @type {Map<number, number>}
   */
  pageFullyLoadedCount;

  /**
   * 已加载的页
   * @description 已加载的页不超过 4 页
   * @type {Deque}
   */
  loadedPages;

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
   * 每页由哪些 PLM 持有以及持有策略
   * @type {Map<number, Map<number | string, "temp" | "full">>}
   */
  pageLoadOwners;

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
    this.activeObjectManager = new ActiveObjectManager();
    this.pageMap = new Map();
    this.pageOrder = [];
    this.pageTemporaryLoadedCount = new Map();
    this.pageFullyLoadedCount = new Map();
    this.pageLoadOwners = new Map();
    this.pageCounterPool = new CounterPool();
    this.objectCounterPool = new CounterPool();
    this.pageLoadEventBus = new EventBus();
    this.monitors = new Map();
    this.signalsEventBus = new EventBus();
    this.#bindPageLoadEvents();
    this.#bindSignalsEventBus();
  }

  /**
   * 创建绑定到当前 Board 的页加载器
   * @param {number} [limit] - 缓冲区上限
   * @param {number | string} [requesterId] - 请求方 id
   * @returns {PageLoader}
   */
  createPageLoader(limit = Board.PAGE_BUFFER_LIMIT, requesterId) {
    return new PageLoader(limit, this.pageLoadEventBus, requesterId);
  }

  /**
   * 创建绑定到当前 Board 的显示器
   * @param {HTMLElement} rootElement - 显示器的根元素
   * @param {{ width: number, height: number }} options - 显示器尺寸选项
   * @param {string} monitorId - 显示器 id
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
   * 添加新页
   * @todo
   * @returns {Promise<Page>}
   */
  async appendPage(templateId) {
    let page = new Page(this.pageCounterPool.generate());

    await boardFileOperateBridge.createPageStorage(this.rootPath, page.id);

    // [todo] 初始化页内容（如模板等）
    // [todo] 模板现在还没有实现，先不管 templateId 参数

    // 加入页映射和链表
    this.pageMap.set(page.id, page);
    if (this.pageOrder.length > 0) {
      let lastPage = this.pageMap.get(
        this.pageOrder[this.pageOrder.length - 1],
      );
      Page.connectTwoPage(lastPage, page);
    }
    this.pageOrder.push(page.id);
    await this.#persistPageConnection();

    // [todo] 加入 Undotree
    return page;
  }

  /**
   * 加载白板
   * @description 加载白板的 meta、config 以及页等信息
   * @param {string} rootPath - 白板根目录
   * @return {Promise<Board>} 返回自身以支持链式调用
   * @throws {Error} 如果目录不合法或文件损坏
   * @todo
   */
  async load(rootPath) {
    this.rootPath = rootPath;
    const snapshot = await boardFileOperateBridge.loadBoardSnapshot(
      this.rootPath,
      boardMeta,
    );
    const meta = snapshot.meta;
    const config = snapshot.config;
    const connection = snapshot.connection;
    const trace = snapshot.trace;

    if (meta.type !== boardMeta.type) {
      console.warn(
        `Not a board file. Expected type ${boardMeta.type}, got ${meta.type}.`,
      );
      throw new Error("Not a board file.");
    }
    if (meta.version !== boardMeta.version) {
      console.warn(
        `Board version mismatch. Expected ${boardMeta.version}, got ${meta.version}.`,
      );
    }

    this.width = config.width;
    this.height = config.height;

    // [todo] 加载其它 meta 和 config 相关的东西

    // 加载页顺序信息
    this.pageOrder = connection.order;
    this.pageCounterPool = new CounterPool(connection.count);

    this.pageLoadOwners.clear();
    this.pageTemporaryLoadedCount.clear();
    this.pageFullyLoadedCount.clear();

    // 构建页链表和页映射
    this.pageMap = new Map();
    let previousPage = null;
    for (const pageId of this.pageOrder) {
      const currentPage = new Page(pageId);
      Page.connectTwoPage(previousPage, currentPage);
      this.pageMap.set(pageId, currentPage);
      previousPage = currentPage;
    }

    // [FIXME] 应该由 Monitor 设备来决定加载哪一页

    // 检查 trace 中的页是否合法
    const currentPage = this.pageMap.get(trace.onPage);
    if (!currentPage) {
      throw new Error(`Trace page ${trace.onPage} does not exist.`);
    }

    // [todo] 加载上次打开的历史，如工具、设备等

    return this;
  }

  /**
   * 创建新白板
   *
   * @param {Directory} rootPath - 白板根目录
   * @param {Object} boardInfo - 白板信息
   * @param {string} boardInfo.templateID - 要应用的模板ID
   * @param {number} boardInfo.width - 白板的宽度
   * @param {number} boardInfo.height - 白板的高度
   *
   * @static
   * @author Zhou Chenyu
   * @returns {Promise<Board>}
   * @todo
   */
  static async create(rootPath, boardInfo) {
    const board = new Board();
    board.rootPath = rootPath;
    await boardFileOperateBridge.createBoardRoot(rootPath, boardMeta, {
      width: boardInfo.width,
      height: boardInfo.height,
    });

    // [todo] 创建文件结构
    // 创建页
    const firstPage = await board.appendPage(boardInfo.templateID);
    await boardFileOperateBridge.writeTrace(rootPath.getPath(), {
      onPage: firstPage.id,
      offset: 0,
    });

    return board;
  }

  /**
   * 添加对象到指定页
   * @todo
   * @param {BasicObject} obj - 要添加的对象
   * @param {number} pageId - 要添加到的页 id
   */
  addObject(obj, pageId) {
    const page = this.pageMap.get(pageId);
    if (!page) {
      console.warn(`Page ${pageId} does not exist.`);
      throw new Error("Page not exist.");
    }
    page.addObject(obj);
  }

  /**
   * 绑定信道相关事件
   * @private
   */
  #bindSignalsEventBus() {
    this.signalsEventBus.on("input", ({ to, signals }) => {
      // 获取信号的目标 Monitor（如果有的话），并把信号送到 Monitor
      const monitorId = to.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (monitor) {
        monitor.devicesTree.dispatch({ to, signals });
      }
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

    if (this.pageFullyLoadedCount.has(page.id)) {
      return false;
    }

    if (this.pageTemporaryLoadedCount.has(page.id)) {
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
      order: this.pageOrder,
      size: this.pageOrder.length,
    });
  }

  /**
   * 增加页加载计数
   * @param {Map<number, number>} map - 页加载计数映射
   * @param {number} pageId - 页 id
   * @private
   */
  #increasePageLoadCount(map, pageId) {
    map.set(pageId, (map.get(pageId) || 0) + 1);
  }

  /**
   * 减少页加载计数
   * @param {Map<number, number>} map - 页加载计数映射
   * @param {number} pageId - 页 id
   * @private
   */
  #decreasePageLoadCount(map, pageId) {
    const count = map.get(pageId) || 0;
    if (count <= 1) {
      map.delete(pageId);
      return;
    }
    map.set(pageId, count - 1);
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
    if (!this.pageLoadOwners.has(pageId)) {
      this.pageLoadOwners.set(pageId, new Map());
    }

    const owners = this.pageLoadOwners.get(pageId);
    const previousStrategy = owners.get(requesterId);
    const effectiveStrategy =
      previousStrategy === PAGE_LOAD_STRATEGIES.FULL
        ? PAGE_LOAD_STRATEGIES.FULL
        : strategy;

    if (previousStrategy === effectiveStrategy) {
      return effectiveStrategy;
    }

    if (previousStrategy === PAGE_LOAD_STRATEGIES.TEMP) {
      this.#decreasePageLoadCount(this.pageTemporaryLoadedCount, pageId);
    } else if (previousStrategy === PAGE_LOAD_STRATEGIES.FULL) {
      this.#decreasePageLoadCount(this.pageFullyLoadedCount, pageId);
    }

    owners.set(requesterId, effectiveStrategy);
    if (effectiveStrategy === PAGE_LOAD_STRATEGIES.FULL) {
      this.#increasePageLoadCount(this.pageFullyLoadedCount, pageId);
    } else {
      this.#increasePageLoadCount(this.pageTemporaryLoadedCount, pageId);
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
    if (!this.pageLoadOwners.has(pageId)) return undefined;

    const owners = this.pageLoadOwners.get(pageId);
    const previousStrategy = owners.get(requesterId);
    if (!previousStrategy) return undefined;

    owners.delete(requesterId);
    if (owners.size === 0) {
      this.pageLoadOwners.delete(pageId);
    }

    if (previousStrategy === PAGE_LOAD_STRATEGIES.FULL) {
      this.#decreasePageLoadCount(this.pageFullyLoadedCount, pageId);
    } else {
      this.#decreasePageLoadCount(this.pageTemporaryLoadedCount, pageId);
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
    return (
      (this.pageTemporaryLoadedCount.get(pageId) || 0) +
      (this.pageFullyLoadedCount.get(pageId) || 0)
    );
  }
}

const boardMeta = {
  type: "board",
  version: "0.1.0",
};

export { Board };
