/**
 * @file Graph3D
 * @description
 * 多边形对象 PolygonObject
 * 表示白板上的多边形对象类。
 * @module board/graph/graph3d
 * @author Zhou Chenyu
 */

const { GraphObject } = require("./graph");
const { Matrix, Point } = require("../../../utils/math");
const { Matrix3D } = require("../../../utils/math3d");

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
  constructor(p, id, pageId) {
    super(p, id, pageId, false, true);
  }

  /**
   * 3D 变换矩阵
   * @type {Matrix3D}
   */
  transform3d;
}

module.exports = {
  Graph3DObject,
};
