/**
 * @file 图形对象定义
 * @module board/graph/graph
 * @author Zhou Chenyu
 */

const { BasicObject } = require("../basic-obj");

/**
 * 图形对象类
 * @class
 * @extends BasicObject
 * @description
 * 表示一个图形，图形是不可擦的有向对象。
 * @author Zhou Chenyu
 */
class GraphObject extends BasicObject {
  constructor(p, id, pageId) {
    super(p, id, pageId);
  }

  static isDirected = true;

  static isErasable = false;
}

module.exports = {
  GraphObject,
};
