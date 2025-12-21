/**
 * @module page-object-manager
 */

const { DirectedGraph } = require("../utils/directed-graph");
const { BasicObject } = require("../classes/basic-classes");
const { Directory, File } = require("../../utils/io");

/**
 * 页静态对象管理器
 * @class
 * @author Zhou Chenyu
 */
class PageObjectManager {
  /**
   * 该页的静态图
   * @type {DirectedGraph}
   */
  staticGraph;

  /**
   * 跨页对象映射
   * @description 从对象 id 映射到页 id
   * @type {Map<number, number>}
   */
  coverOtherPage;

  /**
   * 该页的对象映射
   *
   * @description 从对象 id 映射到对象实例
   * @type {Map<number, BasicObject>}
   */
  pageObjects;

  constructor() {
    this.staticGraph = new DirectedGraph();
    this.coverOtherPage = new Map();
    this.pageObjects = new Map();
  }

  /**
   * 加载层叠图
   * @param {File} file - 从何处加载
   */
  loadTiermap(file) {
    this.staticGraph = DirectedGraph.parse(file.cat());
  }

  /**
   * 保存层叠图
   * @param {File} file - 保存至何方
   */
  saveTiermap(file) {}

  loadObjects(directory) {}

  saveObjects(directory) {}

  unload(file) {}
}

module.exports = {
  PageObjectManager,
};
