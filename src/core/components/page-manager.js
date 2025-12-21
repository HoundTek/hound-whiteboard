/**
 * @module page-manager
 */

const { Directory } = require("../../utils/io");
const { PageObjectManager } = require("./page-object-manager");

/**
 * 页管理器
 */
class PageManager {
  /**
   * 页面上的对象管理
   * @description 包括页对象和层级关系
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

  /**
   * 页 id
   * @type {number}
   */
  id;

  /**
   * 页是否已被加载到内存中
   * @type {boolean}
   */
  isLoad;

  /**
   * 页是否是临时被加载
   * @description
   * 若是临时被加载，那么它应只加载对象层叠关系。
   * 若不是临时被加载，那它还会加载页上所有对象。
   * @type {boolean}
   */
  isTempLoad;

  /**
   *
   * @param {number} pageId - 页 id
   */
  constructor(pageId) {
    this.objectTier = new PageObjectManager();
    this.nextPage = null;
    this.prevPage = null;
    this.id = pageId;
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
  addObject(obj, below, above) {
    const graph = this.objectTier.staticGraph;
    for (const from of below) {
      if (!graph.hasNode(from)) continue; // 在其它页，不管
      graph.addEdgeUnsafe(from, obj);
    }
    for (const to of above) {
      if (!graph.hasNode(to)) continue; // 在其它页，不管
      graph.addEdgeUnsafe(obj, to);
    }
  }

  /**
   * 加载该页
   * @description
   * @param {Directory} directory - 白板文件夹
   * @todo
   * @returns {boolean} 是否成功
   */
  load(directory) {
    // 处理三种情况中的两种：已加载和未加载
    if (this.isLoad && !this.isTempLoad) return false;
    if (/* !this.isLoad && */ !this.isTempLoad) this.loadTemp(directory);
    this.isTempLoad = false;

    // 剩下的情况就是未完全加载
    // [todo] 加载 Objects
    return false;
  }

  unload(file) {
    this.objectTier.unload(file);
    this.objectTier = null; // 垃圾回收
    this.isLoad = false;
    this.isTempLoad = false;
    // [todo]
  }

  /**
   * 临时加载该页
   * @param {Directory} directory - 白板文件夹
   * @returns {boolean} 是否成功
   */
  loadTemp(directory) {
    if (this.isLoad) {
      return false;
    }
    this.isLoad = true;
    this.isTempLoad = true;
    this.objectTier.loadTiermap(
      directory.cd("pages").peek(this.id.toString(), "json")
    );
    return true;
  }
}

module.exports = {
  PageManager,
};
