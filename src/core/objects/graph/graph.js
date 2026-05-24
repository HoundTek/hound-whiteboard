/**
 * @file 图形对象定义
 * @description 定义图形对象的基础抽象与通用行为。
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
  constructor(p, id, ownerChunkId) {
    super(p, id, ownerChunkId);
  }

  isDirected() {
    return true;
  }

  isErasable() {
    return false;
  }
}

export { GraphObject };
