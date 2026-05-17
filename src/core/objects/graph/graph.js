/**
 * @file 图形对象定义
 * @module core/objects/graph/graph
 * @author Zhou Chenyu
 */

import { BasicObject } from "../basic-obj.js";

/**
 * 图形对象类
 * @class
 * @extends BasicObject
 * @description
 * 表示一个图形，图形是不可擦的有向对象。
 * @author Zhou Chenyu
 */
class GraphObject extends BasicObject {
  constructor(p, id, ownerPageId) {
    super(p, id, ownerPageId);
  }

  static isDirected = true;

  static isErasable = false;
}

export { GraphObject };
