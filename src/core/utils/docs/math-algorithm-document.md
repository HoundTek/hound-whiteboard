# math-algorithm 文档

本文档提供 `src/core/utils/math-algorithm.js` 的概述。

## 模块职责

`math-algorithm.js` 在 `math.js` 的基础向量和矩阵能力之上，提供更贴近白板交互的几何算法。

它主要负责凸包计算、曲线插点、缠绕判断，以及双指和三指手势的几何变换估算。

## API

| 名称                                                                                                                                  | 描述                       | 类型                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| `calcConvexHull(points)`                                                                                                              | 计算点集凸包               | `Vector[] -> Vector[]`                                                             |
| `insertPoints(points, countInside = 1)`                                                                                               | 对折线做 Catmull-Rom 插点  | `Vector[] -> number -> Vector[]`                                                   |
| `ropeNailIntersect(rope, nail)`                                                                                                       | 计算闭合曲线对点的缠绕圈数 | `Vector[] -> Vector -> number`                                                     |
| `getDualFingerResult(originPoint1, originPoint2, transformedPoint1, transformedPoint2, originCenter)`                                 | 估算双指缩放旋转和平移结果 | `Vector -> Vector -> Vector -> Vector -> Vector -> {mat, vec}`                     |
| `getTriFingerResult(originPoint1, originPoint2, originPoint3, transformedPoint1, transformedPoint2, transformedPoint3, originCenter)` | 估算三指仿射变换结果       | `Vector -> Vector -> Vector -> Vector -> Vector -> Vector -> Vector -> {mat, vec}` |

## 关键设计点

### 凸包计算

`calcConvexHull()` 使用 Graham 扫描思想，先按坐标排序，再分别构造上下壳。

当点数不足 3 个时，函数直接返回输入拷贝，不强行构造凸包。

### 曲线插点

`insertPoints()` 使用 Catmull-Rom 样条在相邻点之间补点，结果会保留原始端点。

它更适合用于笔画平滑，不负责曲线重采样或误差控制。

### 缠绕判断

`ropeNailIntersect()` 会遍历闭合折线相对目标点的穿越情况，返回正负圈数。

如果点落在边上或顶点附近，函数返回 `NaN`，表示当前状态无法稳定判断。

### 多指变换估算

- 双指版本假定主要变换由旋转、等比缩放和平移组成。
- 三指版本通过协方差矩阵和 SVD 估算旋转，再计算整体缩放和平移。
- 两个接口都返回 `{ mat, vec }`，其中 `mat` 表示线性部分，`vec` 表示平移结果。

## 在仓库中的典型用途

- 多边形或笔画的几何预处理
- 触控手势变换求解
- 需要从点集推导轮廓或平滑结果的编辑逻辑

## 当前状态

- 该模块已经覆盖当前白板编辑里的主要几何算法。
- 文档基于现有实现描述，不假定后续一定会加入更通用的拓扑或拟合算法。

## 相关文档

- [utils-document.md](./utils-document.md)
- [math-document.md](./math-document.md)
- [math3d-document.md](./math3d-document.md)
