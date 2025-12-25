# 基础类型文档

本文档提供白板中基础类型对象的概述。

## Basic Object

抽象类 BasicObject 是白板上所有高级对象的基类。

### 属性
- `position` - 对象的位置 (下文中的坐标默认相对于该位置)
- `transform` - 对象的变换矩阵 (下文中的坐标默认是在 $\begin{bmatrix}1&0\\0&1\end{bmatrix}$ 下)
- `rectangle` - 对象的矩形范围
- `center` - 对象的几何中心
- `convexHull` - 对象的凸包
- `isDirection` - 是否是有向对象
- `rotateCenter` - 对象的旋转中心

### 方法
- `setTransform(matrix)` - 设置变换矩阵 **⚠ [warning] 你应该使用此方法而不是直接修改 transform ⚠**
- `applyTransform(matrix)` - 应用变换矩阵，即右乘一个新矩阵
- `getQuarks()` - 获取该对象下的 Quark 对象用于渲染

### 派生类
- [ZeroDimensionObject](#zero-dimension-object)
- [OneDimensionObject](#one-dimension-object)
- [TwoDimensionObject](#two-dimension-object)

## Zero Dimension Object

抽象类 ZeroDimensionObject 是所有零维对象的基类。派生于 [BasicObject](#basic-object)。

### 零维对象

零维对象是指无法调节其宽度和高度的对象。欲达到类似调节宽高的效果，请使用变换矩阵。

### 派生类
- [Container](./board-classes-document.md#container)
- [PolygonObject](./board-classes-document.md#polygonobject)

## One Dimension Object

抽象类 OneDimensionObject 是所有一维对象的基类。派生于 [BasicObject](#basic-object)。

### 一维对象

一维对象是指高度和宽度只能调节其一的对象。欲达到类似调节另一维长的效果，请使用变换矩阵。

### 属性
- `isMainAxisX` - 对象的主轴是否是 x 轴，即是否只可调节宽度而不可调节高度

## Two Dimension Object

抽象类 TwoDimensionObject 是所有二维对象的基类。派生于 [BasicObject](#basic-object)。
