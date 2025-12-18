/**
 * 白板管理模块
 *
 * @author Zhou Chenyu
 */

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
   * @type {ActiveObjectManager}
   */
  activeObjectManager;

  /**
   * @type {Map<number, PageManager>}
   */
  pages;

  /**
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
   * 创建新的白板管理器实例
   * @param {number} height - 白板的高度
   * @param {number} width - 白板的宽度
   */
  constructor(height, width) {
    this.height = height;
    this.width = width;
    this.undoTree = new UndoTree();
    this.activeObjectManager = new ActiveObjectManager();
    this.pages = new Array();
  }

  appendPage() {
    let page = new PageManager();
    this.pages.push(page);
    return page;
  }
}

module.exports = {
  BoardManager,
};
