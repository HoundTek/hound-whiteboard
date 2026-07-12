/**
 * @file 范围线段原语算法
 * @description 提供范围几何判定中共享的纯函数原语，供 geometry 与 intersections 复用。
 * @module core/shared/range/segment-math
 * @author Zhou Chenyu
 */

/**
 * 范围几何判定的浮点误差容忍值。
 * @type {number}
 */
const RANGE_EPSILON = 1e-8;

/**
 * 计算二维有向叉积
 * @description 返回从 origin 指向 first 与 second 两个向量的二维叉积结果。
 * @param {{x: number, y: number}} origin - 叉积原点
 * @param {{x: number, y: number}} first - 第一个点
 * @param {{x: number, y: number}} second - 第二个点
 * @returns {number} 叉积值
 */
function crossProduct(origin, first, second) {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  );
}

/**
 * 判断点是否在线段上
 * @description 先检查共线，再检查点是否落在线段端点之间。
 * @param {{x: number, y: number}} point - 待判断点
 * @param {{x: number, y: number}} start - 线段起点
 * @param {{x: number, y: number}} end - 线段终点
 * @param {number} [eps=RANGE_EPSILON] - 浮点误差容忍值
 * @returns {boolean} 是否在线段上
 */
function pointOnSegment(point, start, end, eps = RANGE_EPSILON) {
  const cross = crossProduct(start, end, point);
  if (Math.abs(cross) > eps) {
    return false;
  }
  const dot =
    (point.x - start.x) * (point.x - end.x) +
    (point.y - start.y) * (point.y - end.y);
  return dot <= eps;
}

/**
 * 将范围展开为线段列表
 * @description 对闭合范围会自动补上末点到首点的闭合边。
 * @param {import('./range.js').Range} range - 待展开的范围
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {Array<[object, object]>} 线段列表
 */
function getRangeSegments(range, options = {}) {
  const points = range.toPoints(options);
  const segments = [];
  for (let i = 1; i < points.length; i++) {
    segments.push([points[i - 1], points[i]]);
  }
  if (range.isClosed() && points.length > 2) {
    segments.push([points[points.length - 1], points[0]]);
  }
  return segments;
}

/**
 * 判断两线段是否相交
 * @description 相交定义包含正常穿越、端点接触与共线重叠。
 * @param {{x: number, y: number}} firstStart - 第一条线段起点
 * @param {{x: number, y: number}} firstEnd - 第一条线段终点
 * @param {{x: number, y: number}} secondStart - 第二条线段起点
 * @param {{x: number, y: number}} secondEnd - 第二条线段终点
 * @param {number} [eps=RANGE_EPSILON] - 浮点误差容忍值
 * @returns {boolean} 是否相交
 */
function segmentsIntersect(
  firstStart,
  firstEnd,
  secondStart,
  secondEnd,
  eps = RANGE_EPSILON,
) {
  const c1 = crossProduct(firstStart, firstEnd, secondStart);
  const c2 = crossProduct(firstStart, firstEnd, secondEnd);
  const c3 = crossProduct(secondStart, secondEnd, firstStart);
  const c4 = crossProduct(secondStart, secondEnd, firstEnd);

  if (
    ((c1 > eps && c2 < -eps) || (c1 < -eps && c2 > eps)) &&
    ((c3 > eps && c4 < -eps) || (c3 < -eps && c4 > eps))
  ) {
    return true;
  }

  return (
    pointOnSegment(secondStart, firstStart, firstEnd, eps) ||
    pointOnSegment(secondEnd, firstStart, firstEnd, eps) ||
    pointOnSegment(firstStart, secondStart, secondEnd, eps) ||
    pointOnSegment(firstEnd, secondStart, secondEnd, eps)
  );
}

/**
 * 判断一组点中是否存在被目标范围包含的点
 * @description 只要 sourcePoints 中任一点被 targetRange 包含，就返回 true。
 * @param {Array<object>} sourcePoints - 待检查点列
 * @param {import('./range.js').Range} targetRange - 目标范围
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {boolean} 是否存在被包含的点
 */
function anyPointContained(sourcePoints, targetRange, options = {}) {
  for (const point of sourcePoints) {
    if (targetRange.containsPoint(point, options)) {
      return true;
    }
  }
  return false;
}

/**
 * 判断两范围的边界线段是否存在交点
 * @description
 * 使用 Sweep and Prune，时间复杂度 O(N log N + k)，
 * 当任一侧线段数不超过 8 时回退朴素双循环（O(N^2)，但常数开销更低）。
 * @param {import('./range.js').Range} left - 左侧范围
 * @param {import('./range.js').Range} right - 右侧范围
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {boolean} 是否存在边界线段交点
 */
function anySegmentIntersection(left, right, options = {}) {
  const leftSegments = getRangeSegments(left, options);
  const rightSegments = getRangeSegments(right, options);

  const leftCount = leftSegments.length;
  const rightCount = rightSegments.length;

  // 任一侧线段数 ≤ 8 时，朴素双循环更快（避免排序和分配开销）
  if (leftCount <= 8 || rightCount <= 8) {
    for (const [leftStart, leftEnd] of leftSegments) {
      for (const [rightStart, rightEnd] of rightSegments) {
        if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) {
          return true;
        }
      }
    }
    return false;
  }

  // 合并线段并标记来源，同时计算 x 范围
  const tagged = new Array(leftCount + rightCount);
  let idx = 0;
  for (const [s, e] of leftSegments) {
    tagged[idx++] = {
      s, e,
      minX: s.x <= e.x ? s.x : e.x,
      maxX: s.x >= e.x ? s.x : e.x,
      src: 0,
    };
  }
  for (const [s, e] of rightSegments) {
    tagged[idx++] = {
      s, e,
      minX: s.x <= e.x ? s.x : e.x,
      maxX: s.x >= e.x ? s.x : e.x,
      src: 1,
    };
  }

  // 按 minX 升序排列
  tagged.sort((a, b) => a.minX - b.minX);

  const active = [];

  for (let ti = 0; ti < tagged.length; ti++) {
    const seg = tagged[ti];

    // 淘汰 maxX < seg.minX 的过期线段
    let writeIdx = 0;
    for (let ai = 0; ai < active.length; ai++) {
      if (active[ai].maxX >= seg.minX) {
        active[writeIdx++] = active[ai];
      }
    }
    active.length = writeIdx;

    // 仅检测异源线段
    for (let ai = 0; ai < active.length; ai++) {
      const other = active[ai];
      if (other.src === seg.src) continue;

      // Y 轴 AABB 快速排除
      if (
        (seg.s.y <= seg.e.y ? seg.s.y : seg.e.y) > (other.s.y >= other.e.y ? other.s.y : other.e.y) ||
        (seg.s.y >= seg.e.y ? seg.s.y : seg.e.y) < (other.s.y <= other.e.y ? other.s.y : other.e.y)
      ) {
        continue;
      }

      if (segmentsIntersect(seg.s, seg.e, other.s, other.e)) {
        return true;
      }
    }

    active.push(seg);
  }

  return false;
}

export {
  RANGE_EPSILON,
  crossProduct,
  pointOnSegment,
  getRangeSegments,
  segmentsIntersect,
  anyPointContained,
  anySegmentIntersection,
};
