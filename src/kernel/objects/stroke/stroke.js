/**
 * @file 笔画对象定义
 * @description 定义白板笔画对象的几何表示与渲染支持。
 * @module kernel/objects/stroke/stroke
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { Matrix, Vector } from "../../utils/math.js";
import {
  PathRange,
  RectangleRange,
  pointToPolylineDistance,
  pointToSegmentDistance,
  segmentSegmentDistance,
} from "../../range/index.js";
import { BasicObject } from "../basic-obj.js";

const DEFAULT_STROKE_PROPERTY = Object.freeze({
  /**
   * 笔画颜色
   */
  color: "#000000",

  /**
   * 笔画宽度
   */
  width: 1,

  /**
   * 线段连接处的样式
   */
  lineJoin: "round",

  /**
   * 线段端点的样式
   */
  lineCap: "round",
});

/**
 * 允许的线段连接样式
 * @description
 * miter 的尖角长度是 `miterLimit × width / 2`，默认 `miterLimit` 为 10，
 * 最坏可达 5 倍线宽，与包围盒没有比例关系：按包围盒加留白扩出的脏区仍会漏掉尖角。
 * 局部失效依赖「着墨范围 ⊆ 包围盒 ⊕ 留白」这条不变式（由绘制边界测试守住），
 * 因此只允许能守住它的取值。笔刷体系确定之前先只保留 round 与 bevel。
 * @type {ReadonlyArray<string>}
 */
const SUPPORTED_LINE_JOINS = Object.freeze(["round", "bevel"]);

/**
 * 允许的线段端点样式
 * @description
 * square 端点的方角斜向伸出 `width / 2 × √2`，超过按半线宽计算的留白；
 * 要支持它必须同时把留白放大到 `width / 2 × √2`。
 * @type {ReadonlyArray<string>}
 */
const SUPPORTED_LINE_CAPS = Object.freeze(["round", "butt"]);

/**
 * 归一化线段连接样式
 * @param {string} [value] - 原始取值
 * @returns {string} 可用取值
 */
function normalizeLineJoin(value) {
  return SUPPORTED_LINE_JOINS.includes(value)
    ? value
    : DEFAULT_STROKE_PROPERTY.lineJoin;
}

/**
 * 归一化线段端点样式
 * @param {string} [value] - 原始取值
 * @returns {string} 可用取值
 */
function normalizeLineCap(value) {
  return SUPPORTED_LINE_CAPS.includes(value)
    ? value
    : DEFAULT_STROKE_PROPERTY.lineCap;
}

/**
 * 计算点列的轴对齐包围盒
 * @description
 * 直接在原点上取极值，不复制点。
 * 这里不能走 `RectangleRange.from()`，因为那会先把整个点列克隆一遍；
 * 本函数在笔画逐点追加的热路径上被反复调用。
 * @param {Array<Vector>} points - 点列
 * @returns {RectangleRange} 包围盒，点列为空时返回零矩形
 */
function calculatePointBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  if (minX === Infinity) return new RectangleRange(0, 0, 0, 0);
  return new RectangleRange(minX, minY, maxX - minX, maxY - minY);
}

/**
 * 笔画类
 * @class
 * @todo 现在的这个笔画类的结构是不支持更换笔刷的。要想有这个功能，必须重构。
 * @author Zhou Chenyu
 */
class StrokeObject extends BasicObject {
  constructor(id, position, property = {}, data = {}) {
    super(id, position, property, data);
    this.property = { ...DEFAULT_STROKE_PROPERTY, ...this.property };
    this.property.lineJoin = normalizeLineJoin(this.property.lineJoin);
    this.property.lineCap = normalizeLineCap(this.property.lineCap);
    this.rich.localPathRange = new PathRange([]);
    /**
     * 世界坐标点列的惰性缓存
     * @type {{ version: number, pathRange: PathRange } | null}
     */
    this.rich.worldPathRangeCache = null;
    this._onDataChange(Object.keys(data));
  }

  isDirected() {
    return false;
  }

  isErasable() {
    return true;
  }

  calculateRichDatas() {
    const points = this.rich.localPathRange.points;
    this.rich.worldPathRangeCache = null;
    this.bumpGeometryVersion();

    if (points.length === 0) {
      this.rich.boundingBox = new RectangleRange(0, 0, 0, 0);
      return;
    }

    // 精确包围盒仍需逐点变换，但不再把世界点数组留在内存里
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      const world = Vector.mulMatrix(this.transform, point);
      if (world.x < minX) minX = world.x;
      if (world.y < minY) minY = world.y;
      if (world.x > maxX) maxX = world.x;
      if (world.y > maxY) maxY = world.y;
    }
    this.rich.boundingBox = new RectangleRange(minX, minY, maxX - minX, maxY - minY);
  }

  /**
   * 取世界坐标点列
   * @description
   * 首次调用时按当前变换物化并缓存，几何变更后由 `geometryVersion` 判定过期。
   * 派生数据只在这一步产生，不在构造期常驻。
   * @returns {PathRange} 世界坐标点列
   */
  getWorldPathRange() {
    const cached = this.rich.worldPathRangeCache;
    if (cached && cached.version === this.geometryVersion) {
      return cached.pathRange;
    }

    const points = this.rich.localPathRange.points.map((p) =>
      Vector.mulMatrix(this.transform, p),
    );
    const pathRange = new PathRange(points);
    this.rich.worldPathRangeCache = {
      version: this.geometryVersion,
      pathRange,
    };
    return pathRange;
  }

  _onDataChange(keys) {
    if (keys.includes("points") && Array.isArray(this.data.points)) {
      const vecs = this.data.points.map((p) => new Vector(p.x, p.y));
      this.rich.localPathRange = new PathRange(vecs);
      this.calculateRichDatas();
    }
  }

  setTransform(trans) {
    this.transform = trans;
    this.calculateRichDatas();
  }

  /**
   * 按橡皮轨迹擦除笔画点段
   * @description
   * 逐线段判定笔画是否与轨迹相交，阈值 = 橡皮半径 + 笔画世界宽度的一半
   * （宽度随 transform 缩放，按 sqrt(|det|) 折算到世界坐标）。
   * 被擦线段移除后，极大连续未擦线段链聚合为剩余点段返回；
   * 返回值为 data.points 的局部坐标切片，可直接写回。
   * @override
   * @param {Array<{x: number, y: number}>} trailPoints - 橡皮轨迹点列（世界坐标）
   * @param {number} radius - 橡皮半径（世界单位）
   * @returns {Array<Array<{x: number, y: number}>>|null} null 表示未命中；空数组表示整笔擦没；否则为剩余点段
   */
  eraseData(trailPoints, radius) {
    const localPoints = Array.isArray(this.data.points)
      ? this.data.points
      : [];
    const pointCount = localPoints.length;

    if (
      pointCount === 0 ||
      !Array.isArray(trailPoints) ||
      trailPoints.length === 0
    ) {
      return null;
    }

    const scale = Math.sqrt(Math.abs(this.transform.det()));
    const threshold = radius + (this.property.width * scale) / 2;

    // 逐点变换到世界坐标，与 data.points 保持索引对应：
    // 橡皮擦按相邻点线段判定并直接写回 data.points，点列不得增删
    const worldPoints = localPoints.map((point) => {
      const transformed = Vector.mulMatrix(this.transform, point);
      return new Vector(
        this.position.x + transformed.x,
        this.position.y + transformed.y,
      );
    });

    if (pointCount === 1) {
      return pointToPolylineDistance(worldPoints[0], trailPoints) <= threshold
        ? []
        : null;
    }

    const isSegmentErased = (start, end) => {
      if (trailPoints.length === 1) {
        return (
          pointToSegmentDistance(trailPoints[0], start, end) <= threshold
        );
      }
      for (let i = 1; i < trailPoints.length; i++) {
        if (
          segmentSegmentDistance(
            start,
            end,
            trailPoints[i - 1],
            trailPoints[i],
          ) <= threshold
        ) {
          return true;
        }
      }
      return false;
    };

    const segmentCount = pointCount - 1;
    const erasedSegments = new Array(segmentCount).fill(false);
    let hasErased = false;
    for (let i = 0; i < segmentCount; i++) {
      if (isSegmentErased(worldPoints[i], worldPoints[i + 1])) {
        erasedSegments[i] = true;
        hasErased = true;
      }
    }

    if (!hasErased) {
      return null;
    }

    // 孤立点（相邻线段全被擦）不属于任何链，自然被丢弃
    const runs = [];
    let runStart = -1;
    for (let i = 0; i < segmentCount; i++) {
      if (!erasedSegments[i]) {
        if (runStart === -1) runStart = i;
      } else if (runStart !== -1) {
        runs.push(localPoints.slice(runStart, i + 1));
        runStart = -1;
      }
    }
    if (runStart !== -1) {
      runs.push(localPoints.slice(runStart, segmentCount + 1));
    }

    return runs;
  }

  getRange() {
    return this.getWorldPathRange();
  }

  serialize() {
    return {
      ...super.serialize(),
      type: "StrokeObject",
      data: { ...this.data },
    };
  }

  static parse(serialized) {
    if (serialized.type !== "StrokeObject") {
      throw new TypeError("Invalid type for StrokeObject parsing");
    }

    const obj = new StrokeObject(
      serialized.id,
      Vector.parse(serialized.position),
      { ...DEFAULT_STROKE_PROPERTY, ...(serialized.property ?? {}) },
      serialized.data ?? {},
    );

    obj.setTransform(Matrix.parse(serialized.transform));
    return obj;
  }
}

export { DEFAULT_STROKE_PROPERTY, StrokeObject };
