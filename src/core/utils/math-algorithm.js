const { Point } = require("../../utils/math");

/**
 * 计算点集的凸包
 * @description
 * 使用 Graham 扫描算法计算给定点集的凸包。
 * @param {Point[]} points
 * @returns {Point[]}
 */
function calculateConvexHull(points) {
  if (!points || points.length < 3) {
    return points ? [...points] : [];
  }

  let points_deplicate = [...points];
  points_deplicate.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  const lower = [];
  for (let p of points_deplicate) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = points_deplicate.length - 1; i >= 0; i--) {
    const p = points_deplicate[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  // 移除每一半的最后一个点，因为它在另一半的开头被重复了
  upper.pop();
  lower.pop();

  return lower.concat(upper);
}

/**
 * 在一个曲线里插点
 *
 * @param {Point[]} points - 要往里插点的曲线
 * @param {number} [countInside=1] - 要往两点间插几个点
 * @returns {Point[]} 插点后的新曲线
 * @description
 * 这个函数的目的是在给定的点集（通常是一个多边形或曲线）之间插入新的点，以使曲线更平滑。
 * 插入的点是通过 Catmull-Rom Spline 插值计算得出的，这是一种常用的平滑插值方法，可以生成自然的曲线。
 * 该函数对于需要平滑渲染的图形对象（如笔画）非常有用，可以提高视觉效果。
 */
function insertPoints(points, countInside = 1) {
  if (!points || points.length < 2 || countInside < 1) {
    return points ? [...points] : [];
  }
  const result = [];
  const n = points.length;

  result.push(points[0]);
  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    for (let j = 1; j <= countInside; j++) {
      const t = j / (countInside + 1);
      const p0 = i === 0 ? p1 : points[i - 1];
      const p3 = i + 2 < n ? points[i + 2] : p2;

      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t * t +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t * t * t);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t * t +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t * t * t);

      result.push(new Point(x, y));
    }
    result.push(p2);
  }
  return result;
}

/**
 * 判断收绳时绳子钉子会被绳子缠绕几圈
 * @description
 * 这个函数用于判断在一个闭合的曲线（绳子）中，某个点（钉子）被缠绕了多少圈。
 * 如果点在曲线的顶点上或边界上，则返回 NaN，表示无法确定缠绕情况。
 * 顺时针缠绕计数为正，逆时针缠绕计数为负。
 * @param {Point[]} rope - 绳子
 * @param {Point} nail - 钉子
 */
function ropeNailIntersect(rope, nail) {
  function check(first, second) {
    if (Math.abs(first.x - second.x) < 1e-5) {
      // 竖直线段特殊处理，避免除以零
      if (first.x <= nail.x && nail.x <= second.x) {
        if (first.y <= nail.y && nail.y <= second.y) {
          return NaN; // 在边上或在顶点上
        } else if (second.y <= nail.y && nail.y <= first.y) {
          return NaN; // 在边上或在顶点上
        }
      }
      return 0; // 够不到
    } else if (first.x < second.x) {
      if (nail.x < first.x || second.x < nail.x) {
        return 0; // 够不到
      }
    } else if (first.x > second.x) {
      if (nail.x < second.x || first.x < nail.x) {
        return 0; // 够不到
      }
    }
    let k = (second.y - first.y) / (second.x - first.x);
    let ly = first.y + k * (nail.x - first.x);
    if (nail.y > ly) {
      return first.x <= second.x ? 1 : -1;
    } else if (nail.y >= ly - 1e-5) {
      return NaN; // 在边上（允许一定误差）
    }
    return 0;
  }
  let count = check(rope[rope.length - 1], rope[0]);
  if (isNaN(count)) return NaN;
  for (let i = 1; i < rope.length; i++) {
    const first = rope[i - 1];
    const second = rope[i];
    const result = check(first, second);
    if (isNaN(result)) return NaN;
    count += result;
  }
  return count;
}

module.exports = {
  calculateConvexHull,
  insertPoints,
  ropeNailIntersect,
};
