# range 模块设计

## 概述

`range` 目录负责表达“二维范围”这一类基础几何对象。

当前设计分成三层：

- `Range`：抽象基类，只声明统一接口，不承载具体算法。
- `conversion`：负责点列归一化、克隆、包围盒、近似分段等“表示转换”能力。
- `geometry`：负责线段、点包含、范围相交等“几何判定”能力。

## 术语约定

- 点列：范围按顺序展开后的二维点序列，也是 `toPoints()` 的统一输出形式。对 `PolygonRange`、`RopeRange`、`PathRange` 都统一使用“点列”，不再混用“顶点列表”。
- 边界线段：由点列中相邻两点构成的线段；若范围闭合，还包括末点到首点的闭合线段。
- 包围盒：点列或范围在坐标轴对齐意义下的最小包围盒。在 `range` 子系统里，包围盒统一表示为 `RectangleRange`。文档与注释里统一使用“包围盒”，不再混用“最小外接矩形”。
- 矩形参数：`RectangleRange` 统一由 `left`、`top`、`width`、`height` 四个量确定；右边界与下边界由派生值 `left + width`、`top + height` 得到。
- 面积范围：具有内部区域的范围类型，当前包括 `RectangleRange`、`PolygonRange`、`RopeRange`、`EllipseRange`。
- 路径范围：只由边界线段构成、不默认携带内部区域的范围类型，当前对应 `PathRange`。
- 公共部分：两个范围共享的任意几何部分，可以是面积、边界线段或边界点；`intersectsRanges()` 以是否存在公共部分作为相交定义。
- 包含：点落在范围内部或边界上时，统一称为“被范围包含”。
- 绳钉值：`ropeNailIntersect()` 返回的有符号计数值。`PolygonRange` 使用其绝对值奇偶判定内部，`RopeRange` 使用其非零性判定内部。

这样拆分后，范围类型本身只描述数据结构和最小行为；算法模块负责跨类型复用逻辑；调用方也可以按需只引入转换或几何判断。

## 模块清单

- `range.js`：范围基类。
- `rectangle.js`：矩形范围。
- `polygon.js`：多边形范围。
- `rope.js`：绳子范围。
- `ellipse.js`：椭圆范围。
- `path.js`：路径范围。
- `conversion.js`：范围到点列、点列到 `RectangleRange` 包围盒等转换算法。
- `geometry.js`：点在线段、多边形包含、范围相交等几何算法。
- `bounds.js`：`RectangleRange` 包围盒的统一获取与快速排除共享辅助函数。
- `intersections.js`：15 组范围类型组合的相交特化算法，作为内部实现文件使用。

## 职责边界

### Range 基类

`Range` 只做抽象协议定义：

- `transform(matrix)`：返回变换后的同类或等价范围。
- `withPosition(position)`：返回平移后的范围。
- `toPoints(options)`：输出该范围的点列表示。
- `containsPoint(point, options)`：判断点是否落在范围内或边界上。
- `from(range)`：从另一个范围或点列构造本类实例。
- `isClosed()`：声明该范围是否闭合。

基类不再承担下面这些职责：

- 点对象克隆。
- 点列归一化。
- 包围盒计算。
- 线段相交。
- 多边形点包含。
- 两范围相交。

### conversion 模块

`conversion.js` 负责“表示层”问题：

- 把外部点对象规整成 `Vector`。
- 把 `Range` 或点列统一成可遍历点列。
- 从点列生成 `RectangleRange` 包围盒。
- 提供曲线近似的默认分段数。

这层不关心几何关系真假，只关心“如何把数据转成统一表示”。

### geometry 模块

`geometry.js` 负责“判定层”问题：

- 点是否在线段上。
- 点是否在多边形或绳子围成的区域内。
- 两线段是否相交。
- 一个范围如何展开成线段集合。
- 两个范围是否相交。

这层默认调用范围实例暴露的 `toPoints()`、`isClosed()`、`containsPoint()`，因此它依赖 `Range` 协议，但不关心具体子类内部存储。

## 关键设计点

### `from()` 只处理“本类构造”

各个 `Range` 子类的 `from()` 现在只做一件事：

- 先使用 `conversion` 统一输入。
- 再按自身数据结构构造实例。

这比把所有类型判断塞进每个 `from()` 更稳定，也更容易扩展新范围类型。

### 椭圆保留仿射表达

`EllipseRange` 使用“中心点 + 两条半轴向量”表示，而不是只存 `rx`、`ry`。

这样做的原因：

- 任意线性变换后仍可保持为椭圆表达。
- 不需要把旋转椭圆退化成多边形或包围盒。
- `containsPoint()` 可以直接在局部参数空间里判定。

### 路径与面积范围分离

`PathRange` 默认是折线路径，不天然具有面积。

因此：

- `PathRange.containsPoint()` 只判断点是否落在线段上。
- 闭合语义通过 `closed` 显式声明。
- 与面积范围相交时，仍通过 `geometry.intersectsRanges()` 统一入口，但内部会按具体 range 类型走特化算法。

### 相交判断留在算法层

“两范围是否相交”是跨类型逻辑，不属于某一个范围类的私有行为。

因此当前约束是：

- 子类实现自己的 `containsPoint()`。
- 通用相交由 `geometry.intersectsRanges()` 负责，但内部会按具体 range 类型分派到特化算法。
- 这些特化算法集中放在内部文件 `intersections.js` 中，不通过 `index.js` 暴露。
- 包围盒快速排除的共享实现集中放在内部文件 `bounds.js` 中，供 `geometry.js` 与 `intersections.js` 复用；`computeBounds()` 与 `getRangeBounds()` 都统一返回 `RectangleRange`。

### `PolygonRange` 与 `RopeRange` 的区域语义不同

`PolygonRange` 和 `RopeRange` 都是闭合区域，不同点只在“内部”的数学定义：

- `PolygonRange` 使用奇偶规则。绳钉值的绝对值为奇数时，判定在内部。
- `RopeRange` 使用非零缠绕规则。绳钉值不为 `0` 时，判定在内部。

这意味着对于重复绕圈或自交轮廓，两者的包含结果可能不同。

### 相交定义

`geometry.intersectsRanges()` 的定义是：

- 当且仅当两个范围存在公共部分时，判定相交。
- 公共部分可以是面积、边界线段，或单个边界点。
- `PathRange` 不围区域，因此它的公共部分只来自边界线段或边界点。
- 当前会先在 `geometry.intersectsRanges()` 入口做一次包围盒快速排除；若包围盒仍可能重叠，再进入 15 组无序组合的显式特化。其中特别地，矩形-矩形会先走包围盒判定，椭圆-线段会走解析二次方程，椭圆-椭圆会把边界相交化成四次方程求根，路径相关组合会优先按线段公共部分处理。

## 当前状态

- 已实现矩形、多边形、绳子、椭圆、路径五类范围。
- 已实现点列转换、`RectangleRange` 包围盒计算、点包含、线段相交、范围相交等算法。
- 在 `index.js` 里统一导出所有范围类型和算法入口。

## 后续建议

- 如果后续引入贝塞尔曲线范围，可先放在 `conversion` 层做折线近似，再复用 `geometry` 层。
