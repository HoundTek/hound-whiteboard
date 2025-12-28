# 最小渲染单元文档

本文档提供 Hound Whiteboard 中的最小渲染单元——Quark 的概述。

## 白板的渲染

众所周知，Web 应用使用 Canvas 来绘制图形等。一切的白板对象最终都是通过 Canvas 渲染到屏幕上的。为了使渲染的形式统一，我们使用 Quark 来序列化要渲染的对象，再通过 Quark 的逻辑统一管理渲染。

## Quark

Quark 类是 Hound Whiteboard 中的基础渲染单元，通过 [RenderManager](../components/render-manager.js) 与 canvas 交互。

### 属性

- `transform` - 变换矩阵
- `position` - 位置向量 (`Point` 类)
- `mixture` - 混合模式

### 方法

- `(static) parse(quark)` - 将序列化的 Quark 转化为 Quark 实例
- `serialize()` - 将 Quark 对象序列化

### 派生类

- [PolygonQuark](#polygon-quark)
- [TextQuark](#text-quark)
- [ImageQuark](#image-quark)

## Polygon Quark

PolygonQuark 类是 [Quark](#quark) 类的派生类，是多边形的基础渲染单元。

### 属性

- `outerPoints` - 多边形的外点集

## Text Quark

TextQuark 类是 [Quark](#quark) 类的派生类，是文字的基础渲染单元。

### 属性

- `text` - 文本框里的文字
- `font` - 文本的字体
- `color` - 文本的颜色
- `size` - 文本的字号

## Image Quark

ImageQuark 类是 [Quark](#quark) 类的派生类，是图像的基础渲染单元。

### 属性:

- `src` - 图片路径
- `width` - 图片宽度
- `height` - 图片高度

