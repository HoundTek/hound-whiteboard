/**
 * 白板管理器
 *
 * @author Zhou Chenyu
 */

import { Deque } from "../../utils/deque.js";
import { BasicObject } from "../objects/basic-obj.js";
import { CounterPool } from "../utils/counter-pool.js";
import { DirectedGraph } from "../utils/directed-graph.js";
import { EventBus } from "../utils/event-bus.js";
import { UndoTree } from "../hit/undo-tree-core.js";
import { ActiveObjectManager } from "./active-object-manager.js";
import {
  PageLoadManager,
  PAGE_LOAD_MANAGER_EVENTS,
  PAGE_LOAD_STRATEGIES,
} from "./page-load-manager.js";
import { PageManager } from "./page-manager.js";
import { PageObjectManager } from "./page-object-manager.js";
import { boardFileOperateBridge } from "./file-operate-bridge-renderer.js";

/**
 * 白板管理器
 * @description 一个白板只能被一个白板管理器实例管辖
 * @class
 * @author Zhou Chenyu
 */
class BoardManager {
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
   * @type {Map<number, PageManager>}
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
   * 页缓冲区控制器
   * @type {PageLoadManager}
   * @todo 这个应该是由 Monitor 设备来创建和持有的，BoardManager 只负责调用它提供的接口来加载和卸载页
   */
  pageLoadManager;

  /**
   * 每页由哪些 PLM 持有以及持有策略
   * @type {Map<number, Map<number | string, "temp" | "full">>}
   */
  pageLoadOwners;

  constructor() {
    this.undoTree = new UndoTree();
    this.activeObjectManager = new ActiveObjectManager();
    this.pageMap = new Map();
    this.pageOrder = [];
    this.pageTemporaryLoadedCount = new Map();
    this.pageFullyLoadedCount = new Map();
    this.pageLoadOwners = new Map();
    this.loadedPages = new Deque();
    this.pageCounterPool = new CounterPool();
    this.objectCounterPool = new CounterPool();
    this.pageLoadEventBus = new EventBus();
    this.pageLoadManager = this.createPageLoadManager();
    this.loadedPages = this.pageLoadManager.pagesLoaded;
    this.#bindPageLoadEvents();
  }

  /**
   * 创建绑定到当前 BoardManager 的页加载管理器
   * @param {number} [limit] - 缓冲区上限
   * @param {number | string} [requesterId] - 请求方 id
   * @returns {PageLoadManager}
   */
  createPageLoadManager(limit = BoardManager.PAGE_BUFFER_LIMIT, requesterId) {
    return new PageLoadManager(limit, this.pageLoadEventBus, requesterId);
  }

  /**
   * 添加新页
   * @todo
   * @returns {Promise<PageManager>}
   */
  async appendPage(templateId) {
    let page = new PageManager(this.pageCounterPool.generate());

    await boardFileOperateBridge.createPageStorage(this.rootPath, page.id);

    // [todo] 初始化页内容（如模板等）
    // [todo] 模板现在还没有实现，先不管 templateId 参数

    // 加入页映射和链表
    this.pageMap.set(page.id, page);
    if (this.pageOrder.length > 0) {
      let lastPage = this.pageMap.get(
        this.pageOrder[this.pageOrder.length - 1],
      );
      PageManager.connectTwoPage(lastPage, page);
    }
    this.pageOrder.push(page.id);
    await this.#persistPageConnection();

    // [todo] 加入 Undotree
    return page;
  }

  /**
   * 加载白板
   * @description 加载白板的 meta、config 以及页等信息
   * @param {string} directory - 白板根目录
   * @return {Promise<BoardManager>} 返回自身以支持链式调用
   * @throws {Error} 如果目录不合法或文件损坏
   * @todo
   */
  async load(directory) {
    this.rootPath = directory;
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

    this.pageLoadManager.resetBuffer();
    this.pageLoadOwners.clear();
    this.pageTemporaryLoadedCount.clear();
    this.pageFullyLoadedCount.clear();

    // 构建页链表和页映射
    this.pageMap = new Map();
    let previousPage = null;
    for (const pageId of this.pageOrder) {
      const currentPage = new PageManager(pageId);
      PageManager.connectTwoPage(previousPage, currentPage);
      this.pageMap.set(pageId, currentPage);
      previousPage = currentPage;
    }

    // [FIXME] 应该由 Monitor 设备来决定加载哪一页

    // 检查 trace 中的页是否合法
    const currentPage = this.pageMap.get(trace.onPage);
    if (!currentPage) {
      throw new Error(`Trace page ${trace.onPage} does not exist.`);
    }

    // 初始化缓冲区并加载当前页
    this.pageLoadManager.resetCurrentPage(currentPage);
    await this.#loadPage(
      currentPage,
      PAGE_LOAD_STRATEGIES.FULL,
      false,
      this.pageLoadManager.requesterId,
    );

    if (currentPage.prevPage) {
      this.pageLoadManager.expandBufferLeftFullLoad();
    }

    if (currentPage.nextPage) {
      this.pageLoadManager.expandBufferRightFullLoad();
    }

    if (
      trace.offset !== 0 &&
      currentPage.nextPage &&
      currentPage.nextPage.nextPage
    ) {
      this.pageLoadManager.expandBufferRightFullLoad();
    }

    // [todo] 加载上次打开的历史，如工具、设备等

    return this;
  }

  /**
   * 创建新白板
   *
   * @param {Directory} directory - 白板根目录
   * @param {Object} boardInfo - 白板信息
   * @param {string} boardInfo.templateID - 要应用的模板ID
   * @param {number} boardInfo.width - 白板的宽度
   * @param {number} boardInfo.height - 白板的高度
   *
   * @static
   * @author Zhou Chenyu
   * @returns {Promise<BoardManager>}
   * @todo
   */
  static async create(directory, boardInfo) {
    const manager = new BoardManager();
    manager.directory = directory;
    manager.rootPath = directory;
    await boardFileOperateBridge.createBoardRoot(directory, boardMeta, {
      width: boardInfo.width,
      height: boardInfo.height,
    });

    // [todo] 创建文件结构
    // 创建页
    const firstPage = await manager.appendPage(boardInfo.templateID);
    await boardFileOperateBridge.writeTrace(directory.getPath(), {
      onPage: firstPage.id,
      offset: 0,
    });

    return manager;
  }

  /**
   * 添加对象到指定页
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
   * @param {PageManager} page - 要加载的页
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
   * @param {PageManager} page - 要卸载的页
   * @param {number | string} requesterId - 发起卸载请求的 PLM id
   * @returns {Promise<boolean>} 是否成功卸载
   * @private
   */
  async #unloadPage(page, requesterId) {
    if (!page || requesterId === undefined) return false;

    const removedStrategy = this.#unregisterPageLoadRequest(page.id, requesterId);
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
   * 记录某个 PLM 对某页的加载持有关系
   * @param {number} pageId - 页 id
   * @param {number | string} requesterId - PLM id
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

export {
  BoardManager,
};
