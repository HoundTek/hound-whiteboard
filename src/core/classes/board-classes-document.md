# 白板对象文档

本文档提供白板中各种对象的概述。

## Container

Container 类是用来包装一、二维对象的容器类。派生于 [ZeroDimensionObject](./basic-classes-document.md#zero-dimension-object)。

### 功能

由于一、二维对象既可以调节变换矩阵，又可以调节对象原本的宽高的逻辑容易造成混乱，所以我们用 Container 包装之，并赋予了 Container 容器多种模式以适应不同的对象调节逻辑:
-  普通模式: 容器直接显示内部对象，可以认为这个容器不存在
-  拉伸模式: 内部对象以拉伸的方式填充容器，此模式与其它模式不一样的是，操纵杆可以直接调整其变换矩阵
-  窗口模式: 对二维对象，其表现与普通模式相同；对一维对象，若其非主轴被缩得过分小会被裁切
-  收缩模式: 不改变内部对象宽高比，而是将其收缩以适应容器

用户通过“进入”容器来修改内部对象的内容 (不是更改对象！)。

### 属性
- `child` - 被容器包装的一维对象或二维对象

## PolygonObject

PolygonObject 类是白板上的多边形对象类，是图形的一种，由多个顶点组成。派生于 [ZeroDimensionObject](./basic-classes-document.md#zero-dimension-object)。

### 属性
- `points` - 多边形对象的顶点集
- `transformedPoints` - 经变换后多边形对象的顶点集
- `color` - 多边形对象的颜色
