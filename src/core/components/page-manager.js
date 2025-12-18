/**
 * @module page-manager
 */

const { PageObjectManager } = require("./page-object-manager");

/**
 * 页管理器
 */
class PageManager {
  /**
   * 页面上的对象管理
   * @type {PageObjectManager}
   */
  objectTier;

  /**
   * 后一页
   * @type {PageManager}
   */
  nextPage;

  /**
   * 前一页
   * @type {PageManager}
   */
  prevPage;

  constructor() {
    this.objectTier = new PageObjectManager();
    this.nextPage = null;
    this.prevPage = null;
  }

  /**
   * 连接两页
   * @param {PageManager} first 前一页
   * @param {PageManager} second 后一页
   */
  static connectTwoPage(first, second) {
    first.nextPage = second;
    second.prevPage = first;
  }

  /**
   * 
   * @param {number} obj - 要添加的对象
   * @param {number[]} below - 应在该对象之下的对象
   * @param {number[]} above - 应在该对象之上的对象
   */
  addObject(obj, below, above) {}
}

module.exports = {
  PageManager,
};
