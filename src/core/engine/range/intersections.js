/**
 * @file 范围相交特化算法
 * @description 提供不同类型范围之间的相交检测与交点计算。
 * @module core/engine/range/intersections
 * @author Zhou Chenyu
 */

import { boundsIntersect, getRangeBounds, rangesMayOverlap } from "./bounds.js";
import { EllipseRange } from "./ellipse.js";
import { PathRange } from "./path.js";
import { PolygonRange } from "./polygon.js";
import { RectangleRange } from "./rectangle.js";
import { RopeRange } from "./rope.js";
import {
  RANGE_EPSILON,
  anyPointContained,
  anySegmentIntersection,
  getRangeSegments,
  segmentsIntersect,
} from "./segment-math.js";

/**
 * 判断两个闭合范围是否相交
 * @description 先做包围盒快速排除，再检查点包含与边界线段相交。
 * @param {import('./range.js').Range} left - 左侧闭合范围
 * @param {import('./range.js').Range} right - 右侧闭合范围
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {boolean} 是否相交
 */
function intersectsClosedRanges(left, right, options = {}) {
  if (!rangesMayOverlap(left, right, options)) {
    return false;
  }

  // 闭合形状仅需测一个顶点：要么全在内，要么有边界穿越（由 anySegmentIntersection 覆盖）
  const leftPoints = left.toPoints(options);
  if (leftPoints.length > 0 && right.containsPoint(leftPoints[0], options)) {
    return true;
  }
  const rightPoints = right.toPoints(options);
  if (rightPoints.length > 0 && left.containsPoint(rightPoints[0], options)) {
    return true;
  }

  return anySegmentIntersection(left, right, options);
}

/**
 * 判断路径与面积范围是否相交
 * @description
 * Path 始终视为 1D 曲线（即使闭合也不填充内部），只检查自身点列与边界线段，
 * 不把其围成的区域视为面积。路径全在面积内 → 首顶点在内；
 * 局部在内 → 边界穿越由 anySegmentIntersection 覆盖。
 * @param {PathRange} path - 路径范围
 * @param {import('./range.js').Range} area - 面积范围
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {boolean} 是否相交
 */
function intersectsPathWithArea(path, area, options = {}) {
  if (!rangesMayOverlap(path, area, options)) {
    return false;
  }

  // 路径全在面积内 → 所有顶点在内；局部在内 → 边界穿越由 anySegmentIntersection 覆盖
  const pathPoints = path.toPoints(options);
  if (pathPoints.length > 0 && area.containsPoint(pathPoints[0], options)) {
    return true;
  }

  return anySegmentIntersection(path, area, options);
}

/**
 * 判断两条路径是否相交
 * @description
 * Path 始终视为 1D 曲线（即使闭合也不填充内部），两条路径相交当且仅当存在边界线段交点。
 * 路径顶点落在另一条路径线段上的情形会被 anySegmentIntersection 的端点接触判定覆盖，
 * 因此无需单独做点包含检测。
 * @param {PathRange} left - 左侧路径
 * @param {PathRange} right - 右侧路径
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {boolean} 是否相交
 */
function intersectsPathWithPath(left, right, options = {}) {
  if (!rangesMayOverlap(left, right, options)) {
    return false;
  }
  return anySegmentIntersection(left, right, options);
}

/**
 * 将点在椭圆局部基底中表示为参数因子
 * @description 返回点在 axisX 与 axisY 张成坐标系下的系数，退化椭圆时返回 null。
 * @param {EllipseRange} ellipse - 目标椭圆
 * @param {number} x - 相对椭圆中心的 x 分量
 * @param {number} y - 相对椭圆中心的 y 分量
 * @returns {{factorX: number, factorY: number}|null} 局部参数因子
 */
function solveEllipseFactors(ellipse, x, y) {
  const determinant =
    ellipse.axisX.x * ellipse.axisY.y - ellipse.axisX.y * ellipse.axisY.x;
  if (Math.abs(determinant) <= RANGE_EPSILON) {
    return null;
  }
  return {
    factorX: (x * ellipse.axisY.y - y * ellipse.axisY.x) / determinant,
    factorY: (ellipse.axisX.x * y - ellipse.axisX.y * x) / determinant,
  };
}

/**
 * 计算点代入椭圆隐式方程后的值
 * @description 返回值小于零表示在内部，等于零表示在边界上，大于零表示在外部。
 * @param {EllipseRange} ellipse - 目标椭圆
 * @param {{x: number, y: number}} point - 待评估点
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {number} 隐式方程值
 */
function evaluateEllipseImplicit(ellipse, point, options = {}) {
  const relativeX = point.x - ellipse.center.x;
  const relativeY = point.y - ellipse.center.y;
  const factors = solveEllipseFactors(ellipse, relativeX, relativeY);
  if (!factors) {
    return ellipse.containsPoint(point, options) ? 0 : 1;
  }
  return (
    factors.factorX * factors.factorX + factors.factorY * factors.factorY - 1
  );
}

/**
 * 判断线段与椭圆是否相交
 * @description 非退化椭圆走解析二次方程，退化椭圆回退到边界线段判定。
 * @param {{x: number, y: number}} start - 线段起点
 * @param {{x: number, y: number}} end - 线段终点
 * @param {EllipseRange} ellipse - 目标椭圆
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function segmentIntersectsEllipse(start, end, ellipse, options = {}) {
  if (
    ellipse.containsPoint(start, options) ||
    ellipse.containsPoint(end, options)
  ) {
    return true;
  }

  const startFactors = solveEllipseFactors(
    ellipse,
    start.x - ellipse.center.x,
    start.y - ellipse.center.y,
  );
  const directionFactors = solveEllipseFactors(
    ellipse,
    end.x - start.x,
    end.y - start.y,
  );

  if (!startFactors || !directionFactors) {
    const ellipseSegments = getRangeSegments(ellipse, options);
    return ellipseSegments.some(([ellipseStart, ellipseEnd]) =>
      segmentsIntersect(start, end, ellipseStart, ellipseEnd),
    );
  }

  const a =
    directionFactors.factorX * directionFactors.factorX +
    directionFactors.factorY * directionFactors.factorY;
  const b =
    2 *
    (startFactors.factorX * directionFactors.factorX +
      startFactors.factorY * directionFactors.factorY);
  const c =
    startFactors.factorX * startFactors.factorX +
    startFactors.factorY * startFactors.factorY -
    1;

  if (Math.abs(a) <= RANGE_EPSILON) {
    if (Math.abs(b) <= RANGE_EPSILON) {
      return Math.abs(c) <= RANGE_EPSILON;
    }
    const root = -c / b;
    return root >= -RANGE_EPSILON && root <= 1 + RANGE_EPSILON;
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < -RANGE_EPSILON) {
    return false;
  }
  if (Math.abs(discriminant) <= RANGE_EPSILON) {
    const root = -b / (2 * a);
    return root >= -RANGE_EPSILON && root <= 1 + RANGE_EPSILON;
  }

  const sqrtDiscriminant = Math.sqrt(Math.max(discriminant, 0));
  const root1 = (-b - sqrtDiscriminant) / (2 * a);
  const root2 = (-b + sqrtDiscriminant) / (2 * a);
  return (
    (root1 >= -RANGE_EPSILON && root1 <= 1 + RANGE_EPSILON) ||
    (root2 >= -RANGE_EPSILON && root2 <= 1 + RANGE_EPSILON)
  );
}

/**
 * 判断某范围的任一边界线段是否与椭圆相交
 * @description 会将 range 展开成线段并逐段调用线段-椭圆判定。
 * @param {import('./range.js').Range} range - 待检查范围
 * @param {EllipseRange} ellipse - 目标椭圆
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否存在相交线段
 */
function anySegmentEllipseIntersection(range, ellipse, options = {}) {
  return getRangeSegments(range, options).some(([start, end]) =>
    segmentIntersectsEllipse(start, end, ellipse, options),
  );
}

/**
 * 获取椭圆边界在指定参数角度上的点
 * @description 该函数使用椭圆的仿射表达直接生成边界采样点。
 * @param {EllipseRange} ellipse - 目标椭圆
 * @param {number} angle - 参数角度
 * @returns {{x: number, y: number}} 边界点
 */
function sampleEllipsePoint(ellipse, angle) {
  return ellipse.center
    .add(ellipse.axisX.scale(Math.cos(angle)))
    .add(ellipse.axisY.scale(Math.sin(angle)));
}

/**
 * 去掉多项式首部的零系数
 * @description 该函数用于在求根前恢复正确的多项式次数。
 * @param {number[]} coefficients - 按降幂排列的系数数组
 * @returns {number[]} 去掉首部零系数后的数组
 */
function trimPolynomialLeadingZeros(coefficients) {
  let start = 0;
  while (
    start < coefficients.length - 1 &&
    Math.abs(coefficients[start]) <= RANGE_EPSILON
  ) {
    start += 1;
  }
  return coefficients.slice(start);
}

/**
 * 创建复数对象
 * @description 复数在椭圆四次方程求根时作为内部数值表示使用。
 * @param {number} [re=0] - 实部
 * @param {number} [im=0] - 虚部
 * @returns {{re: number, im: number}} 复数对象
 */
function createComplex(re = 0, im = 0) {
  return { re, im };
}

/**
 * 计算复数加法
 * @description 返回 left 与 right 的和。
 * @param {{re: number, im: number}} left - 左侧复数
 * @param {{re: number, im: number}} right - 右侧复数
 * @returns {{re: number, im: number}} 复数和
 */
function complexAdd(left, right) {
  return createComplex(left.re + right.re, left.im + right.im);
}

/**
 * 计算复数减法
 * @description 返回 left 减去 right 的结果。
 * @param {{re: number, im: number}} left - 左侧复数
 * @param {{re: number, im: number}} right - 右侧复数
 * @returns {{re: number, im: number}} 复数差
 */
function complexSub(left, right) {
  return createComplex(left.re - right.re, left.im - right.im);
}

/**
 * 计算复数乘法
 * @description 返回两个复数的乘积。
 * @param {{re: number, im: number}} left - 左侧复数
 * @param {{re: number, im: number}} right - 右侧复数
 * @returns {{re: number, im: number}} 复数积
 */
function complexMul(left, right) {
  return createComplex(
    left.re * right.re - left.im * right.im,
    left.re * right.im + left.im * right.re,
  );
}

/**
 * 计算复数除法
 * @description 当分母过小无法稳定相除时，返回 Infinity 占位值。
 * @param {{re: number, im: number}} left - 被除数
 * @param {{re: number, im: number}} right - 除数
 * @returns {{re: number, im: number}} 商
 */
function complexDiv(left, right) {
  const denominator = right.re * right.re + right.im * right.im;
  if (denominator <= RANGE_EPSILON * RANGE_EPSILON) {
    return createComplex(Infinity, Infinity);
  }
  return createComplex(
    (left.re * right.re + left.im * right.im) / denominator,
    (left.im * right.re - left.re * right.im) / denominator,
  );
}

/**
 * 计算复数模长
 * @description 返回复数到原点的欧氏距离。
 * @param {{re: number, im: number}} value - 复数
 * @returns {number} 模长
 */
function complexAbs(value) {
  return Math.hypot(value.re, value.im);
}

/**
 * 在复数点上评估多项式值
 * @description 系数数组要求按降幂顺序排列。
 * @param {number[]} coefficients - 多项式系数
 * @param {{re: number, im: number}} value - 代入点
 * @returns {{re: number, im: number}} 复数结果
 */
function evaluatePolynomialComplex(coefficients, value) {
  let result = createComplex(coefficients[0], 0);
  for (let index = 1; index < coefficients.length; index++) {
    result = complexAdd(
      complexMul(result, value),
      createComplex(coefficients[index], 0),
    );
  }
  return result;
}

/**
 * 求多项式的实根近似
 * @description 当前使用 Durand-Kerner 迭代，再筛出虚部足够小的根作为实根。
 * @param {number[]} coefficients - 按降幂排列的多项式系数
 * @returns {number[]} 实根数组
 */
function solvePolynomialRealRoots(coefficients) {
  const trimmed = trimPolynomialLeadingZeros(coefficients);
  const degree = trimmed.length - 1;
  if (degree <= 0) {
    return [];
  }
  if (degree === 1) {
    return [-trimmed[1] / trimmed[0]];
  }

  const normalized = trimmed.map((value) => value / trimmed[0]);
  const roots = [];
  const radius =
    1 + Math.max(...normalized.slice(1).map((value) => Math.abs(value)));
  for (let index = 0; index < degree; index++) {
    const angle = (Math.PI * 2 * index) / degree;
    roots.push(
      createComplex(radius * Math.cos(angle), radius * Math.sin(angle)),
    );
  }

  for (let iteration = 0; iteration < 80; iteration++) {
    let maxDelta = 0;
    for (let index = 0; index < degree; index++) {
      let denominator = createComplex(1, 0);
      for (let otherIndex = 0; otherIndex < degree; otherIndex++) {
        if (index === otherIndex) {
          continue;
        }
        denominator = complexMul(
          denominator,
          complexSub(roots[index], roots[otherIndex]),
        );
      }
      const delta = complexDiv(
        evaluatePolynomialComplex(normalized, roots[index]),
        denominator,
      );
      roots[index] = complexSub(roots[index], delta);
      maxDelta = Math.max(maxDelta, complexAbs(delta));
    }
    if (maxDelta <= 1e-10) {
      break;
    }
  }

  const realRoots = [];
  for (const root of roots) {
    if (!Number.isFinite(root.re) || !Number.isFinite(root.im)) {
      continue;
    }
    if (Math.abs(root.im) > 1e-7) {
      continue;
    }
    const alreadyIncluded = realRoots.some(
      (existingRoot) => Math.abs(existingRoot - root.re) <= 1e-6,
    );
    if (!alreadyIncluded) {
      realRoots.push(root.re);
    }
  }
  return realRoots;
}

/**
 * 在实数点上评估多项式值
 * @description 系数数组要求按降幂顺序排列。
 * @param {number[]} coefficients - 多项式系数
 * @param {number} value - 代入点
 * @returns {number} 多项式值
 */
function evaluatePolynomialReal(coefficients, value) {
  let result = coefficients[0];
  for (let index = 1; index < coefficients.length; index++) {
    result = result * value + coefficients[index];
  }
  return result;
}

/**
 * 计算多项式的一阶导数系数
 * @description 系数数组要求按降幂顺序排列。
 * @param {number[]} coefficients - 原多项式系数
 * @returns {number[]} 导函数系数
 */
function derivePolynomial(coefficients) {
  const degree = coefficients.length - 1;
  if (degree <= 0) {
    return [0];
  }
  return coefficients
    .slice(0, -1)
    .map((coefficient, index) => coefficient * (degree - index));
}

/**
 * 构造两椭圆边界相交对应的四次方程
 * @description 方程变量是左椭圆参数化后代入右椭圆隐式方程得到的半角代换结果。
 * @param {EllipseRange} left - 左侧椭圆
 * @param {EllipseRange} right - 右侧椭圆
 * @returns {number[]|null} 四次方程系数，退化时返回 null
 */
function buildEllipseIntersectionPolynomial(left, right) {
  const columnX = solveEllipseFactors(right, left.axisX.x, left.axisX.y);
  const columnY = solveEllipseFactors(right, left.axisY.x, left.axisY.y);
  const offset = solveEllipseFactors(
    right,
    left.center.x - right.center.x,
    left.center.y - right.center.y,
  );

  if (!columnX || !columnY || !offset) {
    return null;
  }

  const q11 =
    columnX.factorX * columnX.factorX + columnX.factorY * columnX.factorY;
  const q12 =
    columnX.factorX * columnY.factorX + columnX.factorY * columnY.factorY;
  const q22 =
    columnY.factorX * columnY.factorX + columnY.factorY * columnY.factorY;
  const l1 =
    columnX.factorX * offset.factorX + columnX.factorY * offset.factorY;
  const l2 =
    columnY.factorX * offset.factorX + columnY.factorY * offset.factorY;
  const constant =
    offset.factorX * offset.factorX + offset.factorY * offset.factorY - 1;

  return [
    q11 - 2 * l1 + constant,
    -4 * q12 + 4 * l2,
    -2 * q11 + 4 * q22 + 2 * constant,
    4 * q12 + 4 * l2,
    q11 + 2 * l1 + constant,
  ];
}

/**
 * 判断两个椭圆边界是否相交或外切
 * @description 先检查四次方程实根，再用导函数临界点补偿重根切触。
 * @param {EllipseRange} left - 左侧椭圆
 * @param {EllipseRange} right - 右侧椭圆
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否存在边界公共点
 */
function ellipseBoundaryTouchesEllipse(left, right, options = {}) {
  const polynomial = buildEllipseIntersectionPolynomial(left, right);
  if (!polynomial) {
    return anySegmentIntersection(left, right, options);
  }

  const roots = solvePolynomialRealRoots(polynomial);
  if (roots.length > 0) {
    return true;
  }

  const derivativeRoots = solvePolynomialRealRoots(
    derivePolynomial(polynomial),
  );
  for (const root of derivativeRoots) {
    if (Math.abs(evaluatePolynomialReal(polynomial, root)) <= 1e-6) {
      return true;
    }
  }

  return (
    Math.abs(
      evaluateEllipseImplicit(right, sampleEllipsePoint(left, 0), options),
    ) <= RANGE_EPSILON ||
    Math.abs(
      evaluateEllipseImplicit(
        right,
        sampleEllipsePoint(left, Math.PI),
        options,
      ),
    ) <= RANGE_EPSILON
  );
}

/**
 * 判断两个矩形范围是否相交
 * @description 该组合直接退化为包围盒重叠判定。
 * @param {RectangleRange} left - 左侧矩形
 * @param {RectangleRange} right - 右侧矩形
 * @returns {boolean} 是否相交
 */
function intersectsRectangleWithRectangle(left, right) {
  return boundsIntersect(getRangeBounds(left), getRangeBounds(right));
}

/**
 * 判断矩形与多边形是否相交
 * @description 该组合走闭合面积范围的通用判定。
 * @param {RectangleRange} left - 左侧矩形
 * @param {PolygonRange} right - 右侧多边形
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsRectangleWithPolygon(left, right, options = {}) {
  return intersectsClosedRanges(left, right, options);
}

/**
 * 判断矩形与绳子范围是否相交
 * @description 该组合走闭合面积范围的通用判定。
 * @param {RectangleRange} left - 左侧矩形
 * @param {RopeRange} right - 右侧绳子范围
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsRectangleWithRope(left, right, options = {}) {
  return intersectsClosedRanges(left, right, options);
}

/**
 * 判断矩形与椭圆是否相交
 * @description 该组合会结合点包含、椭圆中心包含与边界线段-椭圆相交判定。
 * @param {RectangleRange} left - 左侧矩形
 * @param {EllipseRange} right - 右侧椭圆
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsRectangleWithEllipse(left, right, options = {}) {
  if (!rangesMayOverlap(left, right, options)) {
    return false;
  }
  if (anyPointContained(left.toPoints(options), right, options)) {
    return true;
  }
  if (left.containsPoint(right.center)) {
    return true;
  }
  return anySegmentEllipseIntersection(left, right, options);
}

/**
 * 判断矩形与路径是否相交
 * @description 该组合复用路径与面积范围的通用判定。
 * @param {RectangleRange} left - 左侧矩形
 * @param {PathRange} right - 右侧路径
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsRectangleWithPath(left, right, options = {}) {
  return intersectsPathWithArea(right, left, options);
}

/**
 * 判断两个多边形是否相交
 * @description 该组合走闭合面积范围的通用判定。
 * @param {PolygonRange} left - 左侧多边形
 * @param {PolygonRange} right - 右侧多边形
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsPolygonWithPolygon(left, right, options = {}) {
  return intersectsClosedRanges(left, right, options);
}

/**
 * 判断多边形与绳子范围是否相交
 * @description 该组合走闭合面积范围的通用判定。
 * @param {PolygonRange} left - 左侧多边形
 * @param {RopeRange} right - 右侧绳子范围
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsPolygonWithRope(left, right, options = {}) {
  return intersectsClosedRanges(left, right, options);
}

/**
 * 判断多边形与椭圆是否相交
 * @description 该组合会结合点包含、多边形对椭圆中心的包含与边界线段-椭圆相交判定。
 * @param {PolygonRange} left - 左侧多边形
 * @param {EllipseRange} right - 右侧椭圆
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsPolygonWithEllipse(left, right, options = {}) {
  if (!rangesMayOverlap(left, right, options)) {
    return false;
  }
  if (anyPointContained(left.toPoints(options), right, options)) {
    return true;
  }
  if (left.containsPoint(right.center, options)) {
    return true;
  }
  return anySegmentEllipseIntersection(left, right, options);
}

/**
 * 判断多边形与路径是否相交
 * @description 该组合复用路径与面积范围的通用判定。
 * @param {PolygonRange} left - 左侧多边形
 * @param {PathRange} right - 右侧路径
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsPolygonWithPath(left, right, options = {}) {
  return intersectsPathWithArea(right, left, options);
}

/**
 * 判断两个绳子范围是否相交
 * @description 该组合走闭合面积范围的通用判定。
 * @param {RopeRange} left - 左侧绳子范围
 * @param {RopeRange} right - 右侧绳子范围
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsRopeWithRope(left, right, options = {}) {
  return intersectsClosedRanges(left, right, options);
}

/**
 * 判断绳子范围与椭圆是否相交
 * @description 该组合会结合点包含、绳子对椭圆中心的包含与边界线段-椭圆相交判定。
 * @param {RopeRange} left - 左侧绳子范围
 * @param {EllipseRange} right - 右侧椭圆
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsRopeWithEllipse(left, right, options = {}) {
  if (!rangesMayOverlap(left, right, options)) {
    return false;
  }
  if (anyPointContained(left.toPoints(options), right, options)) {
    return true;
  }
  if (left.containsPoint(right.center, options)) {
    return true;
  }
  return anySegmentEllipseIntersection(left, right, options);
}

/**
 * 判断绳子范围与路径是否相交
 * @description 该组合复用路径与面积范围的通用判定。
 * @param {RopeRange} left - 左侧绳子范围
 * @param {PathRange} right - 右侧路径
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsRopeWithPath(left, right, options = {}) {
  return intersectsPathWithArea(right, left, options);
}

/**
 * 判断两个椭圆是否相交
 * @description 该组合会先检查中心包含，再检查两侧边界是否存在交点或外切点。
 * @param {EllipseRange} left - 左侧椭圆
 * @param {EllipseRange} right - 右侧椭圆
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsEllipseWithEllipse(left, right, options = {}) {
  if (!rangesMayOverlap(left, right, options)) {
    return false;
  }
  if (
    left.containsPoint(right.center, options) ||
    right.containsPoint(left.center, options)
  ) {
    return true;
  }
  return (
    ellipseBoundaryTouchesEllipse(left, right, options) ||
    ellipseBoundaryTouchesEllipse(right, left, options)
  );
}

/**
 * 判断椭圆与路径是否相交
 * @description 该组合会结合路径点包含与边界线段-椭圆相交判定。
 * @param {EllipseRange} left - 左侧椭圆
 * @param {PathRange} right - 右侧路径
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean} 是否相交
 */
function intersectsEllipseWithPath(left, right, options = {}) {
  if (!rangesMayOverlap(left, right, options)) {
    return false;
  }
  if (anyPointContained(right.toPoints(options), left, options)) {
    return true;
  }
  return anySegmentEllipseIntersection(right, left, options);
}

/**
 * 按具体范围类型分派到特化的相交算法
 * @description 当前覆盖矩形、多边形、绳子、椭圆、路径五类范围的 15 组无序组合。
 * @param {import('./range.js').Range} left - 左侧范围
 * @param {import('./range.js').Range} right - 右侧范围
 * @param {{approximationSegments?: number}} [options] - 近似参数
 * @returns {boolean|null} 若存在特化算法则返回判定结果，否则返回 null
 */
function intersectsRangesByType(left, right, options = {}) {
  if (left instanceof RectangleRange) {
    if (right instanceof RectangleRange)
      return intersectsRectangleWithRectangle(left, right);
    if (right instanceof PolygonRange)
      return intersectsRectangleWithPolygon(left, right, options);
    if (right instanceof RopeRange)
      return intersectsRectangleWithRope(left, right, options);
    if (right instanceof EllipseRange)
      return intersectsRectangleWithEllipse(left, right, options);
    if (right instanceof PathRange)
      return intersectsRectangleWithPath(left, right, options);
  }

  if (left instanceof PolygonRange) {
    if (right instanceof RectangleRange)
      return intersectsRectangleWithPolygon(right, left, options);
    if (right instanceof PolygonRange)
      return intersectsPolygonWithPolygon(left, right, options);
    if (right instanceof RopeRange)
      return intersectsPolygonWithRope(left, right, options);
    if (right instanceof EllipseRange)
      return intersectsPolygonWithEllipse(left, right, options);
    if (right instanceof PathRange)
      return intersectsPolygonWithPath(left, right, options);
  }

  if (left instanceof RopeRange) {
    if (right instanceof RectangleRange)
      return intersectsRectangleWithRope(right, left, options);
    if (right instanceof PolygonRange)
      return intersectsPolygonWithRope(right, left, options);
    if (right instanceof RopeRange)
      return intersectsRopeWithRope(left, right, options);
    if (right instanceof EllipseRange)
      return intersectsRopeWithEllipse(left, right, options);
    if (right instanceof PathRange)
      return intersectsRopeWithPath(left, right, options);
  }

  if (left instanceof EllipseRange) {
    if (right instanceof RectangleRange)
      return intersectsRectangleWithEllipse(right, left, options);
    if (right instanceof PolygonRange)
      return intersectsPolygonWithEllipse(right, left, options);
    if (right instanceof RopeRange)
      return intersectsRopeWithEllipse(right, left, options);
    if (right instanceof EllipseRange)
      return intersectsEllipseWithEllipse(left, right, options);
    if (right instanceof PathRange)
      return intersectsEllipseWithPath(left, right, options);
  }

  if (left instanceof PathRange) {
    if (right instanceof RectangleRange)
      return intersectsRectangleWithPath(right, left, options);
    if (right instanceof PolygonRange)
      return intersectsPolygonWithPath(right, left, options);
    if (right instanceof RopeRange)
      return intersectsRopeWithPath(right, left, options);
    if (right instanceof EllipseRange)
      return intersectsEllipseWithPath(right, left, options);
    if (right instanceof PathRange)
      return intersectsPathWithPath(left, right, options);
  }

  return null;
}

export { intersectsRangesByType };
