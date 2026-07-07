# 图形对象文档

本文档提供各种图形对象的概述。

## Graph Object

GraphObject 类是白板上的所有二维图形对象的基类。它不可擦，是有向对象。派生于 [ZeroDimensionObject](../../basic-classes-document.md#zero-dimension-object)

## Graph3D Object

## Polygon Object

PolygonObject 类是白板上的多边形对象类，是图形的一种，由多个顶点组成。派生于 [GraphObject](#graph-object)。

### 属性

| 名称                     | 描述                   | 类型                         |
| ------------------------ | ---------------------- | ---------------------------- |
| `data.points`            | 多边形顶点集           | `{ x: number, y: number }[]` |
| `rich.localPolygonRange` | 多边形对象的局部主范围 | `PolygonRange`               |
| `rich.worldPolygonRange` | 多边形对象的世界主范围 | `PolygonRange`               |
| `rich.convexHullRange`   | 多边形对象的凸包范围   | `PolygonRange`               |
| `rich.boundingBox`       | 多边形对象的包围盒     | `RectangleRange`             |
| `property.fillColor`     | 填充色                 | `string`                     |
| `property.strokeColor`   | 描边色                 | `string`                     |
| `property.strokeWidth`   | 描边宽度               | `number`                     |
