# range 模块设计

本文档概述 `src/core/shared/range/` 下范围类型的职责、关系和相交算法。

## 术语约定

- **点列**：范围按顺序展开后的二维点序列，`toPoints()` 的统一输出形式。
- **边界线段**：由点列中相邻两点构成的线段；若范围闭合，还包括末点到首点的闭合线段。
- **包围盒**：坐标轴对齐的最小包围盒，统一表示为 `RectangleRange`。
- **矩形参数**：`RectangleRange` 由 `left`、`top`、`width`、`height` 四个量确定。
- **面积范围**：具有内部区域的范围类型，当前包括 `RectangleRange`、`PolygonRange`、`RopeRange`、`EllipseRange`。
- **路径范围**：只由边界线段构成、不携带内部区域的范围类型，当前对应 `PathRange`。
- **绳钉值**：`ropeNailIntersect()` 返回的有符号计数值。`PolygonRange` 使用其绝对值奇偶判定内部，`RopeRange` 使用其非零性判定内部。

## 模块清单

| 文件               | 职责                                        |
| ------------------ | ------------------------------------------- |
| `range.js`         | 范围基类，定义接口协议                      |
| `rectangle.js`     | 矩形范围                                    |
| `polygon.js`       | 多边形范围                                  |
| `rope.js`          | 绳子范围                                    |
| `ellipse.js`       | 椭圆范围                                    |
| `path.js`          | 路径范围                                    |
| `conversion.js`    | 点列归一化、克隆、包围盒计算                |
| `geometry.js`      | 点包含、线段相交、范围相交等公共入口        |
| `bounds.js`        | 包围盒快速排除辅助函数                      |
| `intersections.js` | 15 组范围类型组合的相交特化算法（内部文件） |

## 职责边界

### Range 基类

`Range` 定义接口协议：

- `transform(matrix)` — 返回变换后的范围
- `withPosition(position)` — 返回平移后的范围
- `toPoints(options)` — 输出点列
- `containsPoint(point, options)` — 点是否落在范围内或边界上
- `from(range)` — 从另一个范围或点列构造实例
- `isClosed()` — 是否闭合

基类不负责点对象克隆、点列归一化、包围盒计算、线段相交、多边形点包含、两范围相交等职责。

### conversion 模块

负责"表示层"问题：点对象规整、范围到点列的转换、包围盒生成。不关心几何关系真假。

### geometry 模块

负责"判定层"问题：点在线段上、点在多边形或绳子区域内、两线段相交、两范围相交。依赖 `Range` 协议，不关心子类内部存储。

## 相交算法

### 入口

`geometry.intersectsRanges(left, right)` 是判断两个范围是否存在公共部分的统一入口：

1. `rangesMayOverlap` — 包围盒快速排除，O(1)
2. `intersectsRangesByType` — 按具体类型组合分派

### 复杂度矩阵

| left \ right | `Rectangle` | `Polygon` | `Rope`   | `Ellipse` | `Path`         |
| ------------ | ----------- | --------- | -------- | --------- | -------------- |
| `Rectangle`  | O(1)        | O(P)      | O(R)     | O(1)      | O(S)           |
| `Polygon`    | O(P)        | O(P₁+P₂)  | O(P+R)   | O(P)      | O(P+S)         |
| `Rope`       | O(R)        | O(R+P)    | O(R₁+R₂) | O(R)      | O(R+S)         |
| `Ellipse`    | O(1)        | O(P)      | O(R)     | O(1)      | O(S)           |
| `Path`       | O(S)        | O(S+P)    | O(S+R)   | O(S)      | O(N log N + k) |

符号：P = 多边形顶点数，R = 绳圈控制点数，S = 路径采样点数，N = S₁ + S₂，k << S₁·S₂

### Sweep and Prune

`intersections.anySegmentIntersection` 使用 Sweep and Prune 替代朴素双循环：

- 朴素: O(L·R) — 所有左右线段两两配对
- S&P: O(N log N + k) — 按 minX 排序，只测 x 投影重叠的异源对

当任一侧线段数不超过 8 时回退朴素路径（常数开销更低）。

### Path × Path 跳过点包含

`intersectsPathWithPath` 跳过 `anyPointContained`。Path 是开放折线，路径点恰好落在另一条开放折线线段上的概率近乎为零，且 `segmentsIntersect` 在端点共线时（`pointOnSegment`）仍会捕获。因此前两步点包含检查是冗余的，直接走 `anySegmentIntersection`。

### 相交定义

`intersectsRanges` 的判定标准：

- 当两个范围存在公共部分时判定相交
- 公共部分可以是面积、边界线段或单个边界点
- `PathRange` 不围区域，公共部分只来自边界线段或边界点

### 关键设计点

**椭圆保留仿射表达。** `EllipseRange` 使用中心点 + 两条半轴向量表示，`containsPoint` 在局部参数空间做 O(1) 解析判定，`segmentIntersectsEllipse` 走二次方程求根。`Ellipse × Ellipse` 边界相交化为四次方程用 Durand-Kerner 迭代求实根。

**`PolygonRange` 与 `RopeRange` 的区域语义不同。** `PolygonRange` 使用奇偶规则（绳钉值绝对值为奇数时为内部），`RopeRange` 使用非零缠绕规则（绳钉值不为 0 时为内部）。自交轮廓下两者的包含结果可能不同。

**`intersectsRangesByType` 集中管理特化。** 15 组无序组合的显式分派集中在 `intersections.js`，不通过 `index.js` 暴露。包围盒快速排除的共享实现放在 `bounds.js`。

**单顶点探针。** `intersectsClosedRanges` 和 `intersectsPathWithArea` 中的点包含检测仅需测一个顶点：对于闭合形状，若完全在另一个形状内部，则所有顶点均在内部；对于路径，若全在面积内则所有顶点均在内部，若部分在内则必有边界穿越（由 `anySegmentIntersection` 覆盖）。因此将 O(L·R) 的 `anyPointContained` 替换为 O(R) 的单顶点 `containsPoint` 调用。
