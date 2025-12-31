/**
 * 白板管理器
 *
 * @author Zhou Chenyu
 */

const { Deque } = require("../../utils/deque");
const { Directory } = require("../../utils/io");
const { BasicObject } = require("../objects/basic-classes");
const { CounterPool } = require("../utils/counter-pool");
const { DirectedGraph } = require("../utils/directed-graph");
const { UndoTree } = require("../utils/undo-tree-core");
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

  constructor() {
    this.undoTree = new UndoTree();
    this.activeObjectManager = new ActiveObjectManager();
  }

  /**
   * 添加新页
   * @todo
   * @returns {PageManager}
   */
  appendPage() {
    let page = new PageManager(this.pageCounterPool.generate());

    // [todo] 创建页文件夹和必要文件

    // [todo] 初始化页内容（如模板等）

    // 加入页映射和链表
    this.pageMap.set(page.id, page);
    if (this.pageOrder.length > 0) {
      let lastPage = this.pageMap.get(
        this.pageOrder[this.pageOrder.length - 1]
      );
      PageManager.connectTwoPage(lastPage, page)
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
   * @todo
   */
  load(directory) {
    this.root = directory;
    const metaFile = this.root.peek("meta", "json");
    if (!metaFile.exist()) {
      console.warn("meta is not exist.");
      throw new Error("Not a board file.");
    }
    const meta = metaFile.catJSON();
    if (meta.type !== boardMeta.type) {
      console.warn(
        `Not a board file. Expected type ${boardMeta.type}, got ${meta.type}.`
      );
      throw new Error("Not a board file.");
    }
    if (meta.version !== boardMeta.version) {
      console.warn(
        `Board version mismatch. Expected ${boardMeta.version}, got ${meta.version}.`
      );
    }

    const configFile = this.root.peek("config", "json");
    if (!configFile.exist()) {
      console.warn("config is not exist.");
      throw new Error("Corrupted board file.");
    }
    const config = configFile.catJSON();

    this.width = config.width;
    this.height = config.height;
    // [todo] 加载其它 meta 和 config 相关的东西

    // [todo] 加载页
    const connectionFile = this.root.cd("pages").peek("connection", "json");
    if (!connectionFile.exist()) {
      console.warn("pages/connection.json is not exist.");
    } else {
      const connection = connectionFile.catJSON();
      this.pageOrder = connection.order;
      this.pageCounterPool = new CounterPool(connection.count);
    }

    // 构建页链表和页映射
    this.pageMap = new Map();
    let previousPage = null;
    for (const pageId of this.pageOrder) {
      const currentPage = new PageManager();
      if (previousPage) {
        previousPage.nextPage = currentPage;
        currentPage.prevPage = previousPage;
      }
      this.pageMap.set(pageId, currentPage);
      previousPage = currentPage;
    }

    const traceFile = this.root.peek("trace", "json");
    let trace;
    // [FIXME] 应是由设备来决定加载哪一页
    // 但现在设备管理器还没做，所以先写成这样
    // 敏捷开发魅力时刻
    if (!traceFile.exist()) {
      console.log("trace is not exist.");
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
            .cd(this.pageMap.get(trace.onPage).prevPage.id.toString())
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
            .cd(this.pageMap.get(trace.onPage).nextPage.id.toString())
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
            .cd(this.pageMap.get(trace.onPage).nextPage.nextPage.id.toString())
        );
      this.loadedPages.pushBack(
        this.pageMap.get(trace.onPage).nextPage.nextPage.id
      );
    }

    // [todo] 加载上次打开的历史，如工具、设备等

    return this;
  }

  /**
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
    const manager = new BoardManager().load(directory);
    directory.existOrMake();
    directory.peek("meta", "json").writeJSON(boardMeta);
    directory.peek("config", "json").writeJSON({
      width: boardInfo.width,
      height: boardInfo.height,
    });
    directory.cd("pages").rmWhenExist().make();
    // [todo] 创建文件结构
    return manager;
  }

  /**
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
