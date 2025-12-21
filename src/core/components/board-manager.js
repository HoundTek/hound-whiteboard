/**
 * 白板管理模块
 *
 * @author Zhou Chenyu
 */

const { Directory } = require("../../utils/io");
const { DirectedGraph } = require("../utils/directed-graph");
const { UndoTree } = require("../utils/undo-tree-core");
const { ActiveObjectManager } = require("./active-object-manager");
const { PageManager } = require("./page-manager");
const { PageObjectManager } = require("./page-object-manager");

/**
 * 白板管理器
 * @description 一个白板只能被一个白板管理器实例管辖
 * @class
 * @author Zhou Chenyu
 */
class BoardManager {
  /**
   * 时间回溯树
   * @type {UndoTree}
   */
  undoTree;

  /**
   * 活动对象管理器
   * @type {ActiveObjectManager}
   */
  activeObjectManager;

  /**
   * 页 id -> 页实例映射
   * @description 拥有页实例的所有权
   * @type {Map<number, PageManager>}
   */
  pages;

  /**
   * 页顺序（使用 id）
   * @type {number[]}
   */
  pageOrder;

  /**
   * 白板的高度
   * @type {number}
   */
  height;

  /**
   * 白板的宽度
   * @type {number}
   */
  width;

  /**
   * 白板的文件路径
   * @type {Directory}
   */
  Directory;

  constructor() {
    this.undoTree = new UndoTree();
    this.activeObjectManager = new ActiveObjectManager();
    this.pages = new Array();
  }

  appendPage() {
    let page = new PageManager();
    this.pages.push(page);
    return page;
  }

  /**
   * 加载白板
   * @param {Directory} directory - 白板根目录
   */
  load(directory) {
    const metaFile = directory.peek("meta", "json");
    const configFile = directory.peek("config", "json");
    if (!metaFile.exist()) {
      console.log("meta does not exist.");
    }
    if (!configFile.exist()) {
      console.log("config does not exist.");
    }

    const meta = metaFile.catJSON();
    const config = configFile.catJSON();
    this.width = config.width;
    this.height = config.height;
  }
}

module.exports = {
  BoardManager,
};
