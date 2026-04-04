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
const { UndoTree } = require("../hit/undo-tree-core");
const { ActiveObjectManager } = require("./active-object-manager");
const { PageManager } = require("./page-manager");
const { PageObjectManager } = require("./page-object-manager");

/**
 * 白板管理器
 * @description 一个白板只能被一个白板管理器实例管辖
 * @class
 * @author Zhou Chenyu
 */
class BoardManager {
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
   * 白板根目录
   * @type {Directory}
   */
  directory;

  constructor() {
    this.undoTree = new UndoTree();
    this.activeObjectManager = new ActiveObjectManager();
  }

  /**
   * 添加新页
   * @todo
   * @returns {PageManager}
   */
  appendPage(templateId) {
    let page = new PageManager(this.pageCounterPool.generate());

    // 创建页文件夹和必要文件
    const pageDirectory = this.directory.cd("pages").cd(page.id.toString());
    pageDirectory.rmWhenExist().make();
    this.directory
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
      trace = {
        onPage: trace.onPage ? trace.onPage : this.pageOrder[0],
        offset: trace.offset ? trace.offset : 0,
      };
    }

    // 加载当前页
    this.loadedPages = new Deque();
    this.pageMap
      .get(trace.onPage)
      .load(this.root.cd("pages").cd(trace.onPage.toString()));
    this.loadedPages.pushBack(trace.onPage);

    // 加载前一页
    if (this.pageMap.get(trace.onPage).prevPage) {
      this.pageMap
        .get(trace.onPage)
        .prevPage.load(
          this.root
            .cd("pages")
            .cd(this.pageMap.get(trace.onPage).prevPage.id.toString()),
        );
      this.loadedPages.pushBack(this.pageMap.get(trace.onPage).prevPage.id);
    }

    // 加载后一页
    if (this.pageMap.get(trace.onPage).nextPage) {
      this.pageMap
        .get(trace.onPage)
        .nextPage.load(
          this.root
            .cd("pages")
            .cd(this.pageMap.get(trace.onPage).nextPage.id.toString()),
        );
      this.loadedPages.pushBack(this.pageMap.get(trace.onPage).nextPage.id);
    }

    // 加载后两页
    if (trace.offset != 0 && this.pageMap.get(trace.onPage).nextPage.nextPage) {
      this.pageMap
        .get(trace.onPage)
        .nextPage.nextPage.load(
          this.root
            .cd("pages")
            .cd(this.pageMap.get(trace.onPage).nextPage.nextPage.id.toString()),
        );
      this.loadedPages.pushBack(
        this.pageMap.get(trace.onPage).nextPage.nextPage.id,
      );
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
    manager.appendPage();

    return manager;
  }

  /**
   * 添加对象到指定页
   *
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
}

const boardMeta = {
  type: "board",
  version: "0.1.0",
};

module.exports = {
  BoardManager,
};
