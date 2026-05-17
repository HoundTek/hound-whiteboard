# 图形对象文档

本文档提供各种图形对象的概述。

## Graph Object

GraphObject 类是白板上的所有二维图形对象的基类。它不可擦，是有向对象。派生于 [ZeroDimensionObject](../../basic-classes-document.md#zero-dimension-object)

## Graph3D Object

## Polygon Object

PolygonObject 类是白板上的多边形对象类，是图形的一种，由多个顶点组成。派生于 [GraphObject](#graph-object)。

### 属性

| 名称                | 描述                   | 类型             |
| ------------------- | ---------------------- | ---------------- |
| `localPolygonRange` | 多边形对象的局部主范围 | `PolygonRange`   |
| `worldPolygonRange` | 多边形对象的世界主范围 | `PolygonRange`   |
| `convexHullRange`   | 多边形对象的凸包范围   | `PolygonRange`   |
| `boundingBox`       | 多边形对象的包围盒     | `RectangleRange` |
| `color`             | 多边形对象的颜色       | `string`         |
