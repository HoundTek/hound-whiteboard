/**
 * @file Graph3D
 * @description
 * 多边形对象 PolygonObject
 * 表示白板上的多边形对象类。
 * @module core/objects/graph/graph3d
 * @author Zhou Chenyu
 */

import { GraphObject } from "./graph.js";
import { Matrix, Vector } from "../../utils/math.js";
import { Matrix3D } from "../../utils/math3d.js";

/**
 * 三维图形类
 * @class
 * @extends GraphObject
 * @description
 * @abstract
 * 表示一个三维图形，是不可擦的有向对象。
 * @author Zhou Chenyu
 */
class Graph3DObject extends GraphObject {
  constructor(id, position, property = {}, data = {}) {
    super(id, position, property, data);
  }

  /**
   * 3D 变换矩阵
   * @type {Matrix3D}
   */
  transform3d;
}

export { Graph3DObject };
