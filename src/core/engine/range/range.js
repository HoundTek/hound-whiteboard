/**
 * @file 范围基类
 * @description 定义范围抽象基类及子类需实现的通用接口。
 * @module core/engine/range/range
 * @author Zhou Chenyu
 */

/**
 * 范围基类
 * @class
 * @virtual
 * @author Zhou Chenyu
 */
class Range {
  /**
   * 对范围进行矩阵变换
   * @abstract
   * @param {Matrix} matrix - 用于变换的矩阵
   * @returns {Range} 变换后的范围
   */
  transform(matrix) {
    throw new Error("Range.transform() must be implemented by subclass");
  }

  /**
   * 将范围移动到指定位置
   * @abstract
   * @param {Vector} position - 目标位置
   * @returns {Range} 移动后的范围
   */
  withPosition(position) {
    throw new Error("Range.withPosition() must be implemented by subclass");
  }

  /**
   * 将范围展开为点列表示
   * @abstract
   * @param {{approximationSegments?: number}} [options] - 近似参数
   * @returns {Vector[]} 范围的点列表示
   */
  toPoints(options = {}) {
    throw new Error("Range.toPoints() must be implemented by subclass");
  }

  /**
   * 当前范围是否闭合
   * @abstract
   * @returns {boolean} 是否闭合
   */
  isClosed() {
    return true;
  }

  /**
   * 判断点是否落在范围内或边界上
   * @abstract
   * @param {Vector} point - 待判断的点
   * @param {{approximationSegments?: number}} [options] - 近似参数
   * @returns {boolean} 是否包含该点
   */
  containsPoint(point, options = {}) {
    throw new Error("Range.containsPoint() must be implemented by subclass");
  }

  /**
   * 从另一个范围创建一个新的范围
   * @abstract
   * @param {Range} range - 用于创建新范围的原始范围
   * @returns {Range} 创建的新范围
   */
  static from(range) {
    throw new Error("Range.from() must be implemented by subclass");
  }
}

export { Range };
