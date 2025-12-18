/**
 * @module page-object-manager
 */

const { DirectedGraph } = require("../utils/directed-graph");
const { BasicObject } = require("../classes/basic-classes");

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

  /**
   * 跨页对象连接图
   * @description 这个里面的对象只能为属于当前页的跨页对象，两对象间连边表示在 staticGraph 中它们有路径连通
   * @type {DirectedGraph}
   */
  crossPageConnection;

  constructor() {
    this.staticGraph = new DirectedGraph();
    this.coverOtherPage = new Map();
    this.pageObjects = new Map();
    this.crossPageConnection = new DirectedGraph();
  }
}

module.exports = {
  PageObjectManager,
};
