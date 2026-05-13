/**
 * @file 页面加载器
 * @module page-loader
 * @author Zhou Chenyu
 */

import { Page } from "./page.js";
import { EventBus } from "../utils/event-bus.js";

const PAGE_LOAD_MANAGER_EVENTS = Object.freeze({
  REQUEST_LOAD: "page-loader:request-load",
  REQUEST_UNLOAD: "page-loader:request-unload",
  BUFFER_UPDATED: "page-loader:buffer-updated",
});

const PAGE_LOAD_STRATEGIES = Object.freeze({
  TEMP: "temp",
  FULL: "full",
});

let pageLoaderIdCounter = 0;

/**
 * 页面加载器
 * @class
 * @description
 * 管理当前已加载的页网格缓冲区。
 * 需要注意的是 PageLoader 无法直接加载页，
 * 它需要给 Board 发出加载页的请求，
 * 由 Board 来调用 Page 的加载方法。
 * @author Zhou Chenyu
 */
class PageLoader {
  /**
   * 在该管理器中已加载的页
   * @description 以页坐标为键保存当前缓冲区中的页实例。
   * @type {Map<string, Page>}
   */
  pagesLoaded;

  /**
   * 当前页引用
   * @type {Page | undefined}
   */
  pageNow;

  /**
   * 可以加载的页数上限，为 0 则不限制
   * @type {number}
   */
  pagesLoadedLimit = 0;

  /**
   * 事件总线
   * @type {EventBus}
   */
  eventBus;

  /**
   * 当前 PageLoader 在事件总线中的请求方 id
   * @type {number | string}
   */
  requesterId;

  /**
   * 邻页解析器
   * @type {(page: Page, direction: "right" | "left" | "up" | "down") => Page | undefined}
   */
  resolveNeighbor;

  /**
   * 当前缓冲区边界
   * @type {{ minX: number, maxX: number, minY: number, maxY: number } | undefined}
   */
  bufferBounds;

  /**
   * @param {number} [limit = 0] - 可以加载的页数上限
   * @param {EventBus} [eventBus] - 页加载事件总线
   * @param {number | string} [requesterId] - 请求方 id
   * @param {(page: Page, direction: "right" | "left" | "up" | "down") => Page | undefined} [resolveNeighbor] - 邻页解析器
   */
  constructor(
    limit = 0,
    eventBus = new EventBus(),
    requesterId = ++pageLoaderIdCounter,
    resolveNeighbor = (page, direction) => {
      const neighborField = {
        right: "rightPage",
        left: "leftPage",
        up: "upPage",
        down: "downPage",
      }[direction];
      return neighborField ? page?.[neighborField] : undefined;
    },
  ) {
    this.pagesLoadedLimit = limit;
    this.pagesLoaded = new Map();
    this.eventBus = eventBus;
    this.requesterId = requesterId;
    this.resolveNeighbor = resolveNeighbor;
    this.bufferBounds = undefined;
  }

  moveCurrentRight() {
    return this.#moveCurrent("right");
  }

  forceMoveCurrentRightTempLoad() {
    return this.#forceMoveCurrent("right", PAGE_LOAD_STRATEGIES.TEMP);
  }

  forceMoveCurrentRightFullLoad() {
    return this.#forceMoveCurrent("right", PAGE_LOAD_STRATEGIES.FULL);
  }

  moveCurrentLeft() {
    return this.#moveCurrent("left");
  }

  forceMoveCurrentLeftTempLoad() {
    return this.#forceMoveCurrent("left", PAGE_LOAD_STRATEGIES.TEMP);
  }

  forceMoveCurrentLeftFullLoad() {
    return this.#forceMoveCurrent("left", PAGE_LOAD_STRATEGIES.FULL);
  }

  moveCurrentUp() {
    return this.#moveCurrent("up");
  }

  forceMoveCurrentUpTempLoad() {
    return this.#forceMoveCurrent("up", PAGE_LOAD_STRATEGIES.TEMP);
  }

  forceMoveCurrentUpFullLoad() {
    return this.#forceMoveCurrent("up", PAGE_LOAD_STRATEGIES.FULL);
  }

  moveCurrentDown() {
    return this.#moveCurrent("down");
  }

  forceMoveCurrentDownTempLoad() {
    return this.#forceMoveCurrent("down", PAGE_LOAD_STRATEGIES.TEMP);
  }

  forceMoveCurrentDownFullLoad() {
    return this.#forceMoveCurrent("down", PAGE_LOAD_STRATEGIES.FULL);
  }

  expandBufferRightTempLoad() {
    return this.#expandBuffer("right", PAGE_LOAD_STRATEGIES.TEMP);
  }

  expandBufferRightFullLoad() {
    return this.#expandBuffer("right", PAGE_LOAD_STRATEGIES.FULL);
  }

  expandBufferLeftTempLoad() {
    return this.#expandBuffer("left", PAGE_LOAD_STRATEGIES.TEMP);
  }

  expandBufferLeftFullLoad() {
    return this.#expandBuffer("left", PAGE_LOAD_STRATEGIES.FULL);
  }

  expandBufferUpTempLoad() {
    return this.#expandBuffer("up", PAGE_LOAD_STRATEGIES.TEMP);
  }

  expandBufferUpFullLoad() {
    return this.#expandBuffer("up", PAGE_LOAD_STRATEGIES.FULL);
  }

  expandBufferDownTempLoad() {
    return this.#expandBuffer("down", PAGE_LOAD_STRATEGIES.TEMP);
  }

  expandBufferDownFullLoad() {
    return this.#expandBuffer("down", PAGE_LOAD_STRATEGIES.FULL);
  }

  shrinkBufferRight() {
    return this.#shrinkBuffer("right");
  }

  shrinkBufferLeft() {
    return this.#shrinkBuffer("left");
  }

  shrinkBufferUp() {
    return this.#shrinkBuffer("up");
  }

  shrinkBufferDown() {
    return this.#shrinkBuffer("down");
  }

  /**
   * 重置当前页
   * @param {Page} page - 页实例
   * @returns {Page | undefined} 重置后的当前页实例
   */
  resetCurrentPage(page) {
    this.pagesLoaded.clear();
    this.bufferBounds = undefined;
    this.pageNow = page;
    if (page) this.#insertPage(page);
    this.#emitBufferUpdated("reset", "none");
    return this.pageNow;
  }

  resetBuffer() {
    const pages = this.getLoadedPages();
    for (const page of pages) {
      this.#emitUnloadRequest(page, "reset");
    }
    this.pagesLoaded.clear();
    this.bufferBounds = undefined;
    this.pageNow = undefined;
    this.#emitBufferUpdated("reset", "none");
  }

  /**
   * 当前页缓冲区快照
   * @returns {Page[]}
   */
  getLoadedPages() {
    return [...this.pagesLoaded.values()].sort((left, right) => {
      if (left.y !== right.y) return right.y - left.y;
      return left.x - right.x;
    });
  }

  /**
   * 当前页缓冲区页数
   * @returns {number}
   */
  get pagesLoadedCount() {
    return this.pagesLoaded.size;
  }

  /**
   * 当前页网格边界快照
   * @returns {{ minX: number, maxX: number, minY: number, maxY: number } | undefined}
   */
  getBufferBounds() {
    if (!this.bufferBounds) return undefined;
    return { ...this.bufferBounds };
  }

  /**
   * 尝试移动当前页在缓冲区内的位置
   * @param {"right" | "left" | "up" | "down"} direction - 移动方向
   * @returns {boolean} 是否成功移动
   * @private
   */
  #moveCurrent(direction) {
    if (!this.pageNow) return false;
    const targetPage = this.#getNeighbor(this.pageNow, direction);
    if (!targetPage || !this.#hasPage(targetPage)) {
      return false;
    }

    this.pageNow = targetPage;
    this.#emitBufferUpdated("move", direction);
    return true;
  }

  /**
   * 强制移动当前页在缓冲区内的位置
   * @param {"right" | "left" | "up" | "down"} direction - 移动方向
   * @param {"temp" | "full"} strategy - 加载策略
   * @returns {boolean} 是否成功移动
   * @private
   */
  #forceMoveCurrent(direction, strategy) {
    if (!this.pageNow) return false;
    const targetPage = this.#getNeighbor(this.pageNow, direction);
    if (!targetPage) return false;

    if (!this.#hasPage(targetPage)) {
      this.pageNow = targetPage;
      this.#appendPagesToBuffer(
        [targetPage],
        direction,
        strategy,
        "force-move",
      );
    } else {
      if (strategy === PAGE_LOAD_STRATEGIES.FULL) {
        this.#emitLoadRequest(
          targetPage,
          strategy,
          direction,
          "force-move",
          true,
        );
      }
      this.pageNow = targetPage;
    }

    this.#emitBufferUpdated("move", direction);
    return true;
  }

  /**
   * 扩展缓冲区
   * @param {"right" | "left" | "up" | "down"} direction - 扩展方向
   * @param {"temp" | "full"} strategy - 加载策略
   * @returns {boolean} 是否成功扩展
   * @private
   */
  #expandBuffer(direction, strategy) {
    if (this.pagesLoadedCount === 0) return false;

    const edgePages = this.#getEdgePages(direction);
    const targetPages = [];
    const seen = new Set();
    for (const edgePage of edgePages) {
      const targetPage = this.#getNeighbor(edgePage, direction);
      if (!targetPage || this.#hasPage(targetPage)) continue;

      const key = this.#getPageKey(targetPage);
      if (seen.has(key)) continue;
      seen.add(key);
      targetPages.push(targetPage);
    }

    if (targetPages.length === 0) return false;

    this.#appendPagesToBuffer(
      targetPages,
      direction,
      strategy,
      "expand-buffer",
    );
    this.#emitBufferUpdated("expand", direction);
    return true;
  }

  /**
   * 收缩缓冲区边界
   * @param {"right" | "left" | "up" | "down"} direction - 收缩方向
   * @returns {boolean} 是否成功收缩
   * @private
   */
  #shrinkBuffer(direction) {
    if (this.pagesLoadedCount === 0) return false;

    const boundaryPages = this.#getEdgePages(direction);
    if (
      boundaryPages.length === 0 ||
      boundaryPages.some((page) => page === this.pageNow)
    ) {
      return false;
    }

    for (const page of boundaryPages) {
      this.#removePage(page);
      this.#emitUnloadRequest(page, "shrink-buffer");
    }
    this.#emitBufferUpdated("shrink", direction);
    return true;
  }

  /**
   * 把页加载到缓冲区中
   * @param {Page[]} pages - 要加载的页
   * @param {"right" | "left" | "up" | "down"} direction - 加载方向
   * @param {"temp" | "full"} strategy - 加载策略
   * @param {"force-move" | "expand-buffer"} source - 加载来源
   * @private
   */
  #appendPagesToBuffer(pages, direction, strategy, source) {
    for (const page of pages) {
      this.#emitLoadRequest(page, strategy, direction, source, false);
      this.#insertPage(page);
    }

    this.#trimBuffer(direction);
  }

  /**
   * 修剪缓冲区
   * @param {"right" | "left" | "up" | "down"} direction - 修剪方向
   * @private
   */
  #trimBuffer(direction) {
    if (this.pagesLoadedLimit === 0) return;

    const oppositeDirection = {
      right: "left",
      left: "right",
      up: "down",
      down: "up",
    }[direction];

    while (this.pagesLoadedCount > this.pagesLoadedLimit) {
      let pagesToRemove = this.#getEdgePages(oppositeDirection).filter(
        (page) => page !== this.pageNow,
      );

      if (pagesToRemove.length === 0) {
        pagesToRemove = this.#getEdgePages(direction).filter(
          (page) => page !== this.pageNow,
        );
      }

      if (pagesToRemove.length === 0) {
        throw new Error("Current page can not be trimmed from buffer.");
      }

      for (const page of pagesToRemove) {
        this.#removePage(page);
        this.#emitUnloadRequest(page, "buffer-limit");
      }
    }
  }

  /**
   * 获取指定页的邻居页
   * @param {Page} page - 当前页
   * @param {"right" | "left" | "up" | "down"} direction - 方向
   * @returns {Page | undefined} 邻居页
   * @private
   */
  #getNeighbor(page, direction) {
    if (!page) return undefined;
    return this.resolveNeighbor(page, direction);
  }

  /**
   * 获取指定方向的边界页
   * @param {"right" | "left" | "up" | "down"} direction - 方向
   * @returns {Page[]}
   * @private
   */
  #getEdgePages(direction) {
    if (!this.bufferBounds) return [];

    const edgePages = [];
    for (const page of this.pagesLoaded.values()) {
      if (
        (direction === "left" && page.x === this.bufferBounds.minX) ||
        (direction === "right" && page.x === this.bufferBounds.maxX) ||
        (direction === "down" && page.y === this.bufferBounds.minY) ||
        (direction === "up" && page.y === this.bufferBounds.maxY)
      ) {
        edgePages.push(page);
      }
    }

    return edgePages.sort((left, right) => {
      if (direction === "left" || direction === "right") {
        return right.y - left.y;
      }
      return left.x - right.x;
    });
  }

  /**
   * 判断某页是否已在缓冲区中
   * @param {Page} page - 页实例
   * @returns {boolean}
   * @private
   */
  #hasPage(page) {
    return this.pagesLoaded.has(this.#getPageKey(page));
  }

  /**
   * 插入页到缓冲区
   * @param {Page} page - 页实例
   * @private
   */
  #insertPage(page) {
    this.pagesLoaded.set(this.#getPageKey(page), page);

    if (!this.bufferBounds) {
      this.bufferBounds = {
        minX: page.x,
        maxX: page.x,
        minY: page.y,
        maxY: page.y,
      };
      return;
    }

    this.bufferBounds.minX = Math.min(this.bufferBounds.minX, page.x);
    this.bufferBounds.maxX = Math.max(this.bufferBounds.maxX, page.x);
    this.bufferBounds.minY = Math.min(this.bufferBounds.minY, page.y);
    this.bufferBounds.maxY = Math.max(this.bufferBounds.maxY, page.y);
  }

  /**
   * 从缓冲区移除页
   * @param {Page} page - 页实例
   * @private
   */
  #removePage(page) {
    this.pagesLoaded.delete(this.#getPageKey(page));
    this.#recalculateBufferBounds();
  }

  /**
   * 重算缓冲区边界
   * @private
   */
  #recalculateBufferBounds() {
    const pages = [...this.pagesLoaded.values()];
    if (pages.length === 0) {
      this.bufferBounds = undefined;
      return;
    }

    let minX = pages[0].x;
    let maxX = pages[0].x;
    let minY = pages[0].y;
    let maxY = pages[0].y;
    for (const page of pages) {
      minX = Math.min(minX, page.x);
      maxX = Math.max(maxX, page.x);
      minY = Math.min(minY, page.y);
      maxY = Math.max(maxY, page.y);
    }
    this.bufferBounds = { minX, maxX, minY, maxY };
  }

  /**
   * 生成页坐标键
   * @param {Page} page - 页实例
   * @returns {string}
   * @private
   */
  #getPageKey(page) {
    return `${page.x},${page.y}`;
  }

  /**
   * 发出加载请求
   * @param {Page} page - 要加载的页
   * @param {"temp" | "full"} strategy - 加载策略
   * @param {"right" | "left" | "up" | "down"} direction - 加载方向
   * @param {"force-move" | "expand-buffer"} source - 加载来源
   * @param {boolean} alreadyBuffered - 是否已经在缓冲区中
   * @private
   */
  #emitLoadRequest(page, strategy, direction, source, alreadyBuffered) {
    this.eventBus.emit(PAGE_LOAD_MANAGER_EVENTS.REQUEST_LOAD, {
      requesterId: this.requesterId,
      page,
      strategy,
      direction,
      source,
      alreadyBuffered,
    });
  }

  /**
   * 发出卸载请求
   * @param {Page} page - 要卸载的页
   * @param {"buffer-limit" | "shrink-buffer" | "reset"} source - 卸载来源
   * @private
   */
  #emitUnloadRequest(page, source) {
    this.eventBus.emit(PAGE_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD, {
      requesterId: this.requesterId,
      page,
      source,
    });
  }

  /**
   * 发出缓冲区更新事件
   * @param {"expand" | "shrink" | "move" | "reset"} action - 更新动作
   * @param {"right" | "left" | "up" | "down" | "none"} direction - 更新方向
   * @private
   */
  #emitBufferUpdated(action, direction) {
    this.eventBus.emit(PAGE_LOAD_MANAGER_EVENTS.BUFFER_UPDATED, {
      action,
      direction,
      pageNow: this.pageNow,
      pagesLoaded: this.getLoadedPages(),
      bufferBounds: this.getBufferBounds(),
    });
  }
}

export { PageLoader, PAGE_LOAD_MANAGER_EVENTS, PAGE_LOAD_STRATEGIES };
