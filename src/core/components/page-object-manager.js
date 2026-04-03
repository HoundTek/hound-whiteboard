/**
 * 页静态对象管理器
 * @module page-object-manager
 * @author Zhou Chenyu
 */

const { DirectedGraph } = require("../utils/directed-graph");
const { BasicObject } = require("../objects/basic-obj");
const { Directory, File } = require("../../utils/io");

/**
 * 页静态对象管理器
 * @class
 * @author Zhou Chenyu
 */
class PageObjectManager {
  /**
   * 该页的静态图
   * @description 见 [tier-graph-document.md](./tier-graph-document.md)。
   * 内部存储所有对象的层叠关系，只包含该页内的对象。存储对象 id，不拥有对象实例的所有权。
   * @type {DirectedGraph}
   */
  staticGraph;

  /**
   * 向左跨页对象集合
   * @type {Set<number>}
   */
  coverLeftPage;

  /**
   * 向右跨页对象集合
   * @type {Set<number>}
   */
  coverRightPage;

  /**
   * 该页的对象映射
   * @description 从对象 id 映射到对象实例。
   * 只包含该页内的对象，拥有对象实例的所有权。
   * @type {Map<number, BasicObject>}
   */
  pageObjects;

  constructor() {
    this.staticGraph = new DirectedGraph();
    this.coverLeftPage = new Set();
    this.coverRightPage = new Set();
    this.pageObjects = new Map();
  }

  /**
   * 加载层叠图
   * @param {File} file - 从何处加载
   * @todo
   */
  loadTierGraph(file) {
    if (file) this.staticGraph = DirectedGraph.parse(file.cat());
  }

  /**
   * 保存层叠图
   * @param {File} file - 保存至何方
   * @todo
   */
  saveTierGraph(file) {}

  /**
   * 卸载层叠图
   * @todo
   */
  unloadTierGraph() {
    this.staticGraph = null;
  }

  /**
   * 加载该页的所有对象
   * @param {Directory} directory - 白板根目录
   * @todo
   */
  loadObjects(directory) {}

  /**
   * 保存该页的所有对象
   * @param {Directory} directory - 白板根目录
   * @todo
   */
  saveObjects(directory) {}

  /**
   * 卸载该页的所有对象
   * @todo
   */
  unloadObjects() {}

  /**
   * 卸载该页的所有对象
   * @todo
   */
  unload() {}
}

module.exports = {
  PageObjectManager,
};
