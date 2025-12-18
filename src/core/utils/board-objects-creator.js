/**
 * @file 白板对象生成器
 * @description
 * 提供一组对象生成函数
 * @author Zhou Chenyu
 */

const { Point } = require("../../utils/math");
const BoardClasses = require("../classes/board-classes");

/**
 * 生成一个新的多边形对象
 * @param {Point} p - 多边形逻辑左上角的绝对位置
 * @param {Point[]} points - 多边形各顶点相对其左上角的相对位置
 * @returns {BoardClasses.PolygonObject} 生成的多边形对象
 * @author Zhou Chenyu
 */
function generetePolygonObject(p, points) {
	return new BoardClasses.PolygonObject(p, 0, 0, points);
}

module.exports = {
	generetePolygonObject,
};