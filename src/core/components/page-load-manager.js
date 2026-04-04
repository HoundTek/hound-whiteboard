/**
 * @file 页面加载管理器
 * @module page-load-manager
 * @author Zhou Chenyu
 */

const { Deque } = require("../../utils/deque");
const { PageManager } = require("./page-manager");

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
   * @param {number} [limit = 0] - 可以加载的页数上限
   */
  constructor(limit = 0) {
    this.pagesLoadedLimit = limit;
    this.pagesLoaded = new Deque();
  }

  /**
   * 向右移动当前页在缓冲区内的位置
   * @description 如果当前页右边在缓冲区中没有页了，则不进行任何操作。
   */
  moveCurrentRight() {}

  /**
   * 强制向右移动当前页在缓冲区内的位置
   * @description
   * 如果当前页右边在缓冲区中没有页了，则缓冲区会尝试加载右页。
   * 加载策略为临时加载。
   */
  forceMoveCurrentRightTempLoad() {}

  /**
   * 强制向右移动当前页在缓冲区内的位置
   * @description
   * 如果当前页右边在缓冲区中没有页了，则缓冲区会尝试加载右页。
   * 加载策略为完整加载。
   */
  forceMoveCurrentRightFullLoad() {}

  /**
   * 向左移动当前页在缓冲区内的位置
   * @description 如果当前页左边在缓冲区中没有页了，则不进行任何操作。
   */
  moveCurrentLeft() {}

  /**
   * 强制向左移动当前页在缓冲区内的位置
   * @description
   * 如果当前页左边在缓冲区中没有页了，则缓冲区会尝试加载左页。
   * 加载策略为临时加载。
   */
  forceMoveCurrentLeftTempLoad() {}

  /**
   * 强制向左移动当前页在缓冲区内的位置
   * @description 如果当前页左边在缓冲区中没有页了，则缓冲区会尝试加载左页。
   * 加载策略为完整加载。
   */
  forceMoveCurrentLeftFullLoad() {}

  /**
   * 向右扩展缓冲区，加载策略为临时加载
   */
  expandBufferRightTempLoad() {}

  /**
   * 向右扩展缓冲区，加载策略为完整加载
   */
  expandBufferRightFullLoad() {}

  /**
   * 向左扩展缓冲区，加载策略为临时加载
   */
  expandBufferLeftTempLoad() {}

  /**
   * 向左扩展缓冲区，加载策略为完整加载
   */
  expandBufferLeftFullLoad() {}

  /**
   * 重置当前页
   * @param {number} pageId
   */
  resetCurrentPage(pageId) {}

  /**
   * 重置缓冲区
   */
  resetBuffer() {}
}

module.exports = {
  PageLoadManager,
};
