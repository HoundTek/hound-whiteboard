/**
 * 页面管理器
 * @module page-manager
 * @author Zhou Chenyu
 */

const { Directory } = require("../../utils/io");
const { BasicObject } = require("../objects/basic-obj");
const { PageObjectManager } = require("./page-object-manager");

/**
 * 页管理器
 * @class
 * @description 管理一页
 * @author Zhou Chenyu
 */
class PageManager {
  /**
   * 页面上的对象管理
   * @description 包括页对象和层级关系
   * @type {PageObjectManager}
   */
  objectManager;

  /**
   * 后一页
   * @type {PageManager | undefined}
   */
  nextPage;

  /**
   * 前一页
   * @type {PageManager | undefined}
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
    this.objectManager = new PageObjectManager();
    this.nextPage = undefined;
    this.prevPage = undefined;
    this.id = pageId;
  }

  /**
   * 连接两页
   * @param {PageManager | undefined} first 前一页
   * @param {PageManager | undefined} second 后一页
   */
  static connectTwoPage(first, second) {
    if (first) first.nextPage = second;
    if (second) second.prevPage = first;
  }

  /**
   * 添加对象并更新层叠图
   *
   * @param {number} obj - 要添加的对象
   * @param {number[]} below - 应在该对象之下的对象
   * @param {number[]} above - 应在该对象之上的对象
   */
  addObject(obj, below, above) {
    const graph = this.objectManager.staticGraph;
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
   * 
   * @param {BasicObject} obj - 要添加的对象
   */
  addNewObject(obj) {
    // [todo] 计算新对象是否与现有对象交集
    

    // [todo] 更新层叠图
    this.objectManager.staticGraph.addNode(obj.id);
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

  unload() {
    this.objectManager.unload();
    this.objectManager = null; // 垃圾回收
    this.isLoad = false;
    this.isTempLoad = false;
    // [todo]
  }

  unloadTemp() {
    if (!this.isTempLoad) {
      // 要么是没加载，要么是完整加载，不能卸载
      return false;
    }
    this.objectManager.unloadTierGraph();
    this.isLoad = false;
    this.isTempLoad = false;
    return true;
  }

  /**
   * 临时加载该页
   * @param {Directory} directory - 白板文件夹
   * @returns {boolean} 是否成功
   */
  loadTemp(directory) {
    if (this.isLoad) {
      // 已加载，不管是完整加载还是临时加载，都不能重复加载
      return false;
    }
    this.isLoad = true;
    this.isTempLoad = true;
    this.objectManager.loadTierGraph(
      directory.cd("pages").peek(this.id.toString(), "json")
    );
    return true;
  }
}

module.exports = {
  PageManager,
};
