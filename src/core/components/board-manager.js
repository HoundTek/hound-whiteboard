/**
 * 白板管理器
 *
 * @author Zhou Chenyu
 */

const { Deque } = require("../../utils/deque");
const { Directory } = require("../../utils/io");
const { BasicObject } = require("../objects/basic-obj");
const { CounterPool } = require("../utils/counter-pool");
const { DirectedGraph } = require("../utils/directed-graph");
const { EventBus } = require("../utils/event-bus");
const { UndoTree } = require("../hit/undo-tree-core");
const { ActiveObjectManager } = require("./active-object-manager");
const {
  PageLoadManager,
  PAGE_LOAD_MANAGER_EVENTS,
  PAGE_LOAD_STRATEGIES,
} = require("./page-load-manager");
const { PageManager } = require("./page-manager");
const { PageObjectManager } = require("./page-object-manager");

/**
 * 白板管理器
 * @description 一个白板只能被一个白板管理器实例管辖
 * @class
 * @author Zhou Chenyu
 */
class BoardManager {
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
   * @type {Directory}
   */
  root;

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
   */
  pageLoadManager;

  constructor() {
    this.undoTree = new UndoTree();
    this.activeObjectManager = new ActiveObjectManager();
    this.pageMap = new Map();
    this.pageOrder = [];
    this.pageTemporaryLoadedCount = new Map();
    this.pageFullyLoadedCount = new Map();
    this.loadedPages = new Deque();
    this.pageCounterPool = new CounterPool();
    this.objectCounterPool = new CounterPool();
    this.pageLoadEventBus = new EventBus();
    this.pageLoadManager = new PageLoadManager(
      BoardManager.PAGE_BUFFER_LIMIT,
      this.pageLoadEventBus,
    );
    this.loadedPages = this.pageLoadManager.pagesLoaded;
    this.#bindPageLoadEvents();
  }

  /**
   * 添加新页
   * @todo
   * @returns {PageManager}
   */
  appendPage(templateId) {
    let page = new PageManager(this.pageCounterPool.generate());

    // 创建页文件夹和必要文件
    const pageDirectory = this.root.cd("pages").cd(page.id.toString());
    pageDirectory.rmWhenExist().make();
    this.root
      .cd("objects")
      .cd("page" + page.id.toString())
      .rmWhenExist()
      .make();

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
    this.#persistPageConnection();

    // [todo] 加入 Undotree
    return page;
  }

  /**
   * 加载白板
   * @description 加载白板的 meta、config 以及页等信息
   * @param {Directory} directory - 白板根目录
   * @return {BoardManager} 返回自身以支持链式调用
   * @throws {Error} 如果目录不合法或文件损坏
   * @todo
   */
  load(directory) {
    this.root = directory;

    // 检查是否是合法的白板文件
    const metaFile = this.root.peek("meta", "json");
    if (!metaFile.exist()) {
      console.warn("meta.json does not exist.");
      throw new Error("Not a board file.");
    }
    const meta = metaFile.catJSON();
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

    // 加载 config
    const configFile = this.root.peek("config", "json");
    if (!configFile.exist()) {
      console.warn("config.json does not exist.");
      throw new Error("Corrupted board file.");
    }
    const config = configFile.catJSON();

    this.width = config.width;
    this.height = config.height;

    // [todo] 加载其它 meta 和 config 相关的东西

    // 加载页顺序信息
    const connectionFile = this.root.cd("pages").peek("connection", "json");
    if (!connectionFile.exist()) {
      console.warn("pages/connection.json does not exist.");
      throw new Error("Corrupted board file.");
    } else {
      const connection = connectionFile.catJSON();
      this.pageOrder = connection.order;
      this.pageCounterPool = new CounterPool(connection.count);
    }

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

    const traceFile = this.root.peek("trace", "json");
    let trace;
    // [FIXME] 应该由 Monitor 设备来决定加载哪一页
    if (!traceFile.exist()) {
      console.log("trace.json does not exist.");
      // 默认加载第一页
      trace = {
        onPage: this.pageOrder[0],
        offset: 0,
      };
    } else {
      trace = traceFile.catJSON();
      if (!trace.onPage) {
        trace.onPage = this.pageOrder[0];
      }
      if (trace.offset === undefined) {
        trace.offset = 0;
      }
    }

    // 检查 trace 中的页是否合法
    const currentPage = this.pageMap.get(trace.onPage);
    if (!currentPage) {
      throw new Error(`Trace page ${trace.onPage} does not exist.`);
    }

    // 初始化缓冲区并加载当前页
    this.pageLoadManager.resetBuffer();
    this.pageLoadManager.resetCurrentPage(currentPage);
    this.#loadPage(currentPage, PAGE_LOAD_STRATEGIES.FULL, false);

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
   * @returns {BoardManager}
   * @todo
   */
  static create(directory, boardInfo) {
    const manager = new BoardManager();
    manager.directory = directory;
    manager.root = directory;
    directory.rmWhenExist().make();
    directory.peek("meta", "json").writeJSON(boardMeta);
    directory.peek("config", "json").writeJSON({
      width: boardInfo.width,
      height: boardInfo.height,
    });
    directory.cd("devices").make();
    directory.cd("history").make();
    directory.cd("objects").make();
    directory.cd("pages").make();
    directory.cd("templates").make();

    // [todo] 创建文件结构
    // 创建页
    const firstPage = manager.appendPage(boardInfo.templateID);
    directory
      .cd("pages")
      .peek("connection", "json")
      .writeJSON({
        count: 1,
        order: [firstPage.id],
        size: 1,
      });
    directory.peek("trace", "json").writeJSON({
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
      ({ page, strategy, alreadyBuffered }) => {
        this.#loadPage(page, strategy, alreadyBuffered);
      },
    );

    this.pageLoadEventBus.on(
      PAGE_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD,
      ({ page }) => {
        this.#unloadPage(page);
      },
    );
  }

  /**
   * 加载页
   * @param {PageManager} page - 要加载的页
   * @param {"temp" | "full"} strategy - 加载策略
   * @param {boolean} alreadyBuffered - 是否已经在缓冲区中
   * @returns {boolean} 是否成功加载
   * @private
   */
  #loadPage(page, strategy, alreadyBuffered) {
    if (!page) return false;

    const pageDirectory = this.#resolvePageDirectory(page.id);

    if (strategy === PAGE_LOAD_STRATEGIES.FULL) {
      const needUpgrade = page.isLoad && page.isTempLoad;
      const changed = page.loadFull(pageDirectory);

      if (!alreadyBuffered) {
        this.#increasePageLoadCount(this.pageFullyLoadedCount, page.id);
      } else if (needUpgrade) {
        this.#decreasePageLoadCount(this.pageTemporaryLoadedCount, page.id);
        this.#increasePageLoadCount(this.pageFullyLoadedCount, page.id);
      }
      return changed;
    }

    const changed = page.loadTemp(pageDirectory);
    if (!alreadyBuffered) {
      this.#increasePageLoadCount(this.pageTemporaryLoadedCount, page.id);
    }
    return changed;
  }

  /**
   * 卸载页
   * @param {PageManager} page - 要卸载的页
   * @returns {boolean} 是否成功卸载
   * @private
   */
  #unloadPage(page) {
    if (!page || !page.isLoad) return false;

    if (page.isTempLoad) {
      this.#decreasePageLoadCount(this.pageTemporaryLoadedCount, page.id);
      return page.unloadTemp();
    }

    this.#decreasePageLoadCount(this.pageFullyLoadedCount, page.id);
    return page.unload();
  }

  /**
   * 解析页目录
   * @param {number} pageId - 页 id
   * @returns {Directory} 页目录
   * @private
   */
  #resolvePageDirectory(pageId) {
    const pagesDirectory = this.root.cd("pages");
    const nestedDirectory = pagesDirectory.cd(pageId.toString());
    if (nestedDirectory.exist()) {
      return nestedDirectory;
    }
    return pagesDirectory;
  }

  /**
   * 持久化页连接信息
   * @private
   */
  #persistPageConnection() {
    if (!this.root) return;
    this.root.cd("pages").peek("connection", "json").writeJSON({
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
}

const boardMeta = {
  type: "board",
  version: "0.1.0",
};

module.exports = {
  BoardManager,
};
