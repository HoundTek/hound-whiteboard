/**
 * @file 图形对象定义
 * @module board/graph/graph
 * @author Zhou Chenyu
 */

const { ZeroDimensionObject } = require("../../basic-classes");

/**
 * 图形对象类
 * @class
 * @extends ZeroDimensionObject
 * @description
 * 表示一个图形，图形是不可擦的有向对象。
 * @author Zhou Chenyu
 */
class GraphObject extends ZeroDimensionObject {
  constructor(p, id, pageId) {
    super(p, id, pageId, false, true);
  }
}

module.exports = {
  GraphObject,
};
