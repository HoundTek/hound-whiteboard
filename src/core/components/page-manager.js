/**
 * 页面管理器
 * @module page-manager
 * @author Zhou Chenyu
 */

import { BasicObject } from "../objects/basic-obj.js";
import { PageObjectManager } from "./page-object-manager.js";

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
    this.objectManager = undefined;
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
   * @param {string} boardRootPath - 白板根目录
   * @todo
   * @returns {Promise<boolean>} 是否成功
   */
  async loadFull(boardRootPath) {
    // 已完整加载
    if (this.isLoad && !this.isTempLoad) return false;

    // 未加载，升级为临时加载
    if (!this.isLoad) await this.loadTemp(boardRootPath);
    this.isTempLoad = false;

    // 升级为完整加载，加载对象
    // [todo] 加载 Objects
    await this.objectManager.loadObjects(boardRootPath);
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
    this.objectManager = undefined;
    this.isLoad = false;
    this.isTempLoad = false;
    return true;
  }

  /**
   * 从完整加载降级为临时加载
   * @returns {boolean} 是否成功降级
   * @description
   * 该方法会保留层叠图，只卸载完整加载阶段持有的对象内容。
   * 若当前页不是完整加载状态，则不进行任何操作。
   */
  downgradeToTemp() {
    if (!this.isLoad || this.isTempLoad) {
      return false;
    }
    if (this.objectManager) this.objectManager.unloadObjects();
    this.isTempLoad = true;
    return true;
  }

  /**
   * 临时加载该页
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<boolean>} 是否成功
   */
  async loadTemp(boardRootPath) {
    if (this.isLoad) {
      // 已加载，不管是完整加载还是临时加载，都不能重复加载
      return false;
    }
    this.isLoad = true;
    this.isTempLoad = true;
    if (!this.objectManager) {
      this.objectManager = new PageObjectManager(this.id);
    }
    await this.objectManager.loadTierGraph(boardRootPath);
    return true;
  }
}

export {
  PageManager,
};
