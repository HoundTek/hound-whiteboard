/**
 * 页面管理器
 * @module page-manager
 * @author Zhou Chenyu
 */

const { File, Directory } = require("../../utils/io");
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
    this.isLoad = false;
    this.isTempLoad = false;
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
   * 完整加载该页
   * @description
   * @param {Directory} directory - 白板根目录
   * @todo
   * @returns {boolean} 是否成功
   */
  loadFull(directory) {
    // 已完整加载
    if (this.isLoad && !this.isTempLoad) return false;

    // 未加载，升级为临时加载
    if (!this.isLoad) this.loadTemp(directory);
    this.isTempLoad = false;

    // 升级为完整加载，加载对象
    // [todo] 加载 Objects
    this.objectManager.loadObjects(directory);
    return true;
  }

  /**
   * 完整卸载该页
   * @returns {boolean} 是否成功卸载
   * @description
   * 该方法会把该页变成未加载状态。
   * 无论该页之前是完整加载还是临时加载，调用后都会变成未加载状态。
   */
  unload() {
    if (this.objectManager) this.objectManager.unload();
    this.objectManager = new PageObjectManager();
    this.isLoad = false;
    this.isTempLoad = false;
    return true;
  }

  /**
   * 卸载该页，仅当该页被临时加载
   * @returns {boolean} 是否成功卸载
   * @description
   * 该方法只能在该页是临时加载状态时调用，调用后该页会变成未加载状态。
   */
  unloadTemp() {
    if (!this.isTempLoad) {
      // 要么是没加载，要么是完整加载，不能卸载
      return false;
    }
    if (this.objectManager) this.objectManager.unloadTierGraph();
    this.objectManager = new PageObjectManager();
    this.isLoad = false;
    this.isTempLoad = false;
    return true;
  }

  /**
   * 临时加载该页
   * @param {Directory} directory - 白板根目录
   * @returns {boolean} 是否成功
   */
  loadTemp(directory) {
    if (this.isLoad) {
      // 已加载，不管是完整加载还是临时加载，都不能重复加载
      return false;
    }
    const tierGraphFile = this.#resolveTierGraphFile(directory);
    this.isLoad = true;
    this.isTempLoad = true;
    if (!this.objectManager) this.objectManager = new PageObjectManager();
    this.objectManager.loadTierGraph(tierGraphFile);
    return true;
  }

  /**
   * 解析页层叠图文件位置
   * @param {Directory} directory - 白板根目录
   * @returns {File | undefined} 层叠图文件，若未找到，则为 undefined
   */
  #resolveTierGraphFile(directory) {
    if (!directory) return undefined;
    const file = directory.cd("page").peek(this.id.toString(), "json");
    if (file.exist()) return file;
    return undefined;
  }
}

module.exports = {
  PageManager,
};
