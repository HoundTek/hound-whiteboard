/**
 * @file 页面加载管理器
 * @module page-load-manager
 * @author Zhou Chenyu
 */

const { Deque } = require("../../utils/deque");
const { PageManager } = require("./page-manager");
const { EventBus } = require("../utils/event-bus");

const PAGE_LOAD_MANAGER_EVENTS = Object.freeze({
  REQUEST_LOAD: "page-load-manager:request-load",
  REQUEST_UNLOAD: "page-load-manager:request-unload",
  BUFFER_UPDATED: "page-load-manager:buffer-updated",
});

const PAGE_LOAD_STRATEGIES = Object.freeze({
  TEMP: "temp",
  FULL: "full",
});

/**
 * 页面加载管理器
 * @class
 * @description
 * 管理当前已加载的页。
 * 需要注意的是 PageLoadManager 无法直接加载页，
 * 它需要给 BoardManager 发出加载页的请求，
 * 由 BoardManager 来调用 PageManager 的加载方法。
 * @author Zhou Chenyu
 */
class PageLoadManager {
  /**
   * 在该管理器中已加载的页
   * @description 页数不超过 `pagesLoadedLimit` 页，为页实例引用的双端队列。
   * @type {Deque}
   */
  pagesLoaded;

  /**
   * 当前页引用
   * @type {PageManager}
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
   * @param {number} [limit = 0] - 可以加载的页数上限
   * @param {EventBus} [eventBus] - 页加载事件总线
   */
  constructor(limit = 0, eventBus = new EventBus()) {
    this.pagesLoadedLimit = limit;
    this.pagesLoaded = new Deque();
    this.eventBus = eventBus;
  }

  /**
   * 向右移动当前页在缓冲区内的位置
   * @description 如果当前页右边在缓冲区中没有页了，则不进行任何操作。
   * @returns {boolean} 是否成功移动
   */
  moveCurrentRight() {
    return this.#moveCurrent("right");
  }

  /**
   * 强制向右移动当前页在缓冲区内的位置
   * @description
   * 如果当前页右边在缓冲区中没有页了，则缓冲区会尝试加载右页。
   * 加载策略为临时加载。
   * @returns {boolean} 是否成功移动
   */
  forceMoveCurrentRightTempLoad() {
    return this.#forceMoveCurrent("right", PAGE_LOAD_STRATEGIES.TEMP);
  }

  /**
   * 强制向右移动当前页在缓冲区内的位置
   * @description
   * 如果当前页右边在缓冲区中没有页了，则缓冲区会尝试加载右页。
   * 加载策略为完整加载。
   * @returns {boolean} 是否成功移动
   */
  forceMoveCurrentRightFullLoad() {
    return this.#forceMoveCurrent("right", PAGE_LOAD_STRATEGIES.FULL);
  }

  /**
   * 向左移动当前页在缓冲区内的位置
   * @description 如果当前页左边在缓冲区中没有页了，则不进行任何操作。
   * @returns {boolean} 是否成功移动
   */
  moveCurrentLeft() {
    return this.#moveCurrent("left");
  }

  /**
   * 强制向左移动当前页在缓冲区内的位置
   * @description
   * 如果当前页左边在缓冲区中没有页了，则缓冲区会尝试加载左页。
   * 加载策略为临时加载。
   * @returns {boolean} 是否成功移动
   */
  forceMoveCurrentLeftTempLoad() {
    return this.#forceMoveCurrent("left", PAGE_LOAD_STRATEGIES.TEMP);
  }

  /**
   * 强制向左移动当前页在缓冲区内的位置
   * @description
   * 如果当前页左边在缓冲区中没有页了，则缓冲区会尝试加载左页。
   * 加载策略为完整加载。
   * @returns {boolean} 是否成功移动
   */
  forceMoveCurrentLeftFullLoad() {
    return this.#forceMoveCurrent("left", PAGE_LOAD_STRATEGIES.FULL);
  }

  /**
   * 向右扩展缓冲区，加载策略为临时加载
   * @returns {boolean} 是否成功扩展
   */
  expandBufferRightTempLoad() {
    return this.#expandBuffer("right", PAGE_LOAD_STRATEGIES.TEMP);
  }

  /**
   * 向右扩展缓冲区，加载策略为完整加载
   * @returns {boolean} 是否成功扩展
   */
  expandBufferRightFullLoad() {
    return this.#expandBuffer("right", PAGE_LOAD_STRATEGIES.FULL);
  }

  /**
   * 向左扩展缓冲区，加载策略为临时加载
   * @returns {boolean} 是否成功扩展
   */
  expandBufferLeftTempLoad() {
    return this.#expandBuffer("left", PAGE_LOAD_STRATEGIES.TEMP);
  }

  /**
   * 向左扩展缓冲区，加载策略为完整加载
   * @returns {boolean} 是否成功扩展
   */
  expandBufferLeftFullLoad() {
    return this.#expandBuffer("left", PAGE_LOAD_STRATEGIES.FULL);
  }

  /**
   * 重置当前页
   * @param {PageManager} page - 页实例
   * @returns {PageManager | undefined} 重置后的当前页实例，若参数无效，则为 undefined
   * @description
   * 该方法会清空当前缓冲区并把参数页设为当前页。
   * 如果参数页不在当前板中，则不进行任何操作。
   */
  resetCurrentPage(page) {
    this.pagesLoaded.clear();
    this.pageNow = page;
    if (page) this.pagesLoaded.pushBack(page);
    this.#emitBufferUpdated("reset", "none");
    return this.pageNow;
  }

  /**
   * 重置缓冲区
   * @description 该方法会清空当前缓冲区并把当前页设为 undefined。
   */
  resetBuffer() {
    const pages = this.pagesLoaded.toArray();
    for (const page of pages) {
      this.#emitUnloadRequest(page, "reset");
    }
    this.pagesLoaded.clear();
    this.pageNow = undefined;
    this.#emitBufferUpdated("reset", "none");
  }

  /**
   * 当前页缓冲区快照
   * @returns {PageManager[]}
   */
  getLoadedPages() {
    return this.pagesLoaded.toArray();
  }

  /**
   * 尝试移动当前页在缓冲区内的位置
   * @param {"right" | "left"} direction - 移动方向
   * @returns {boolean} 是否成功移动
   * @description
   * 该方法会尝试把当前页向指定方向移动一页。
   * 如果当前页在指定方向上没有页了，或者指定方向的页不在缓冲区中，则不进行任何操作。
   * @private
   */
  #moveCurrent(direction) {
    if (!this.pageNow) return false;
    const targetPage = this.#getNeighbor(this.pageNow, direction);
    if (!targetPage || !this.pagesLoaded.includes(targetPage)) {
      return false;
    }

    this.pageNow = targetPage;
    this.#emitBufferUpdated("move", direction);
    return true;
  }

  /**
   * 强制移动当前页在缓冲区内的位置
   * @param {"right" | "left"} direction - 移动方向
   * @param {"temp" | "full"} strategy - 加载策略
   * @returns {boolean} 是否成功移动
   * @description
   * 该方法会尝试把当前页向指定方向移动一页。
   * 如果当前页在指定方向上没有页了，则缓冲区会尝试加载指定方向的页。
   * 如果加载成功了，那么当前页会被移动到指定方向的页。
   * 否则不进行任何操作。
   * @private
   */
  #forceMoveCurrent(direction, strategy) {
    if (!this.pageNow) return false;
    const targetPage = this.#getNeighbor(this.pageNow, direction);
    if (!targetPage) return false;

    if (!this.pagesLoaded.includes(targetPage)) {
      this.pageNow = targetPage;
      this.#appendPageToBuffer(targetPage, direction, strategy, "force-move");
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
   * @param {"right" | "left"} direction - 扩展方向
   * @param {"temp" | "full"} strategy - 加载策略
   * @returns {boolean} 是否成功扩展
   * @description
   * 该方法会尝试把指定方向的页加载到缓冲区中。
   * 如果指定方向的页已经在缓冲区中了，或者没有页了，则不进行任何操作。
   * 否则会把指定方向的页加载到缓冲区中。
   * @private
   */
  #expandBuffer(direction, strategy) {
    if (this.pagesLoaded.empty()) return false;

    const edgePage =
      direction === "right"
        ? this.pagesLoaded.peekBack()
        : this.pagesLoaded.peekFront();
    const targetPage = this.#getNeighbor(edgePage, direction);
    if (!targetPage || this.pagesLoaded.includes(targetPage)) {
      return false;
    }

    this.#appendPageToBuffer(targetPage, direction, strategy, "expand-buffer");
    this.#emitBufferUpdated("expand", direction);
    return true;
  }

  /**
   * 把页加载到缓冲区中
   * @param {PageManager} page - 要加载的页
   * @param {"right" | "left"} direction - 加载方向
   * @param {"temp" | "full"} strategy - 加载策略
   * @param {"force-move" | "expand-buffer"} source - 加载来源
   * @description
   * 该方法会把页加载到缓冲区中，并根据加载结果更新缓冲区状态。
   * 如果加载成功了，那么页会被添加到缓冲区的指定方向上。
   * 否则不进行任何操作。
   * @private
   */
  #appendPageToBuffer(page, direction, strategy, source) {
    this.#emitLoadRequest(page, strategy, direction, source, false);

    if (direction === "right") {
      this.pagesLoaded.pushBack(page);
    } else {
      this.pagesLoaded.pushFront(page);
    }

    this.#trimBuffer(direction);
  }

  /**
   * 修剪缓冲区
   * @param {"right" | "left"} direction - 修剪方向
   * @description
   * 该方法会根据 `pagesLoadedLimit` 的设置修剪缓冲区。
   * 如果缓冲区中的页数超过了 `pagesLoadedLimit`，则会从指定方向上移除页，直到页数不超过 `pagesLoadedLimit`。
   * 被移除的页会被发出卸载请求。
   * @private
   */
  #trimBuffer(direction) {
    if (this.pagesLoadedLimit === 0) return;

    while (this.pagesLoaded.count() > this.pagesLoadedLimit) {
      const removeFromFront = direction === "right";
      const headPage = this.pagesLoaded.peekFront();
      const tailPage = this.pagesLoaded.peekBack();
      let removed;

      if (removeFromFront) {
        removed =
          headPage === this.pageNow
            ? this.pagesLoaded.popBack()
            : this.pagesLoaded.popFront();
      } else {
        removed =
          tailPage === this.pageNow
            ? this.pagesLoaded.popFront()
            : this.pagesLoaded.popBack();
      }

      if (removed === this.pageNow) {
        throw new Error("Current page can not be trimmed from buffer.");
      }
      this.#emitUnloadRequest(removed, "buffer-limit");
    }
  }

  /**
   * 获取指定页的邻居页
   * @param {PageManager} page - 当前页
   * @param {"right" | "left"} direction - 方向
   * @returns {PageManager | undefined} 邻居页
   * @private
   */
  #getNeighbor(page, direction) {
    if (!page) return undefined;
    return direction === "right" ? page.nextPage : page.prevPage;
  }

  /**
   * 发出加载请求
   * @param {PageManager} page - 要加载的页
   * @param {"temp" | "full"} strategy - 加载策略
   * @param {"right" | "left"} direction - 加载方向
   * @param {"force-move" | "expand-buffer"} source - 加载来源
   * @param {boolean} alreadyBuffered - 是否已经在缓冲区中
   * @private
   */
  #emitLoadRequest(page, strategy, direction, source, alreadyBuffered) {
    this.eventBus.emit(PAGE_LOAD_MANAGER_EVENTS.REQUEST_LOAD, {
      page,
      strategy,
      direction,
      source,
      alreadyBuffered,
    });
  }

  /**
   * 发出卸载请求
   * @param {PageManager} page - 要卸载的页
   * @param {"buffer-limit"} source - 卸载来源
   * @private
   */
  #emitUnloadRequest(page, source) {
    this.eventBus.emit(PAGE_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD, {
      page,
      source,
    });
  }

  /**
   * 发出缓冲区更新事件
   * @param {"expand" | "shrink"} action - 更新动作
   * @param {"right" | "left"} direction - 更新方向
   * @private
   */
  #emitBufferUpdated(action, direction) {
    this.eventBus.emit(PAGE_LOAD_MANAGER_EVENTS.BUFFER_UPDATED, {
      action,
      direction,
      pageNow: this.pageNow,
      pagesLoaded: this.pagesLoaded.toArray(),
    });
  }
}

module.exports = {
  PageLoadManager,
  PAGE_LOAD_MANAGER_EVENTS,
  PAGE_LOAD_STRATEGIES,
};
