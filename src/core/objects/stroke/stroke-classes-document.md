# 笔画对象文档

本文档提供各种笔画对象的概述。

## Stroke Object

StrokeObject 类是白板上的所有笔画对象的基类。故名思义，笔画对象就像现实里的一笔一划一样，是用笔工具“画”出来的。

它是可擦的无向对象。派生于 [BasicObject](../basic-classes-document.md#basic-object)

### 属性

|名称|描述|类型|
|:--|:--|:--|
|`innerPoints`|笔画对象的内点集|`Point[]`|
|`points`|笔画对象的外点集|`Point[]`|
|`transformedPoints`|经变换后笔画对象的外点集|`Point[]`|
|`color`|笔画对象的颜色|`string`|

> **内点**是决定笔画位置和走向的点，类似于你写字时笔头中心描的点。
>
> **外点**是决定笔画渲染的点，类似于你写字时这一笔轮廓上的点。
