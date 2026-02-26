# 基础类型文档

本文档提供白板中基础类型对象的概述。

## Basic Object

抽象类 BasicObject 是白板上所有高级对象的基类。

BasicObject 是“零维的”，这意味着这个对象本身的宽度和高度都无法被调整，也意味着白板上的所有高级对象都是零维的。

### 属性

|名称|描述|类型|
|:-:|:-:|:-:|
|`position`|对象的位置 (除特殊说明外，下文中的坐标默认相对于该位置)|`Point`|
|`transform`|对象的变换矩阵 (除特殊说明外，下文中的坐标默认是在 $\begin{bmatrix}1&0\\0&1\end{bmatrix}$ 下)|`Matrix`|
|`rectangle`|对象的矩形范围|`Matrix`|
|`center`|对象的几何中心|`Point`|
|`convexHull`|对象的凸包|`Point[]`|
|`rotateCenter`|对象的旋转中心|`Point`|
|`static isErasable`|是否是可擦对象|`boolean`|
|`static isDirection`|是否是有向对象|`boolean`|

> **可擦对象**是可以被[橡皮工具](../tools/eraser/obj-eraser-document.md)所擦除的对象。所以对于可擦对象，想删除它就有两个办法：一是在菜单中选择删除，二是用橡皮工具将其擦干净。
>
> **有向对象**是拥有旋转初相的对象。它可以自定义旋转中心、记录旋转角度以及归中。

### 方法

注意，以下的方法都是虚方法，具体实现请看派生类。

|名称|描述|类型|
|:-:|:-:|:-:|
|`setTransform(matrix)`|设置变换矩阵|`Matrix -> void`|
|`applyTransform(matrix)`|应用变换矩阵，即右乘一个新矩阵|`Matrix -> void`|
|`calculateConvexHull()`|计算对象的凸包|`void`|
|`isPointIntersect(p)`|判断某点是否在这个对象内部|`Point[] -> boolean`|
|`render(ctx)`|在 `ctx` 上渲染该对象|`CanvasRenderingContext2D -> boolean`|
|`serialize()`|将该对象转为一个 JSON 对象|`void -> Object`|
|`static parse(obj)`|将一个合法的 JSON 对象转为该类对象|`Object -> BasicObject`|

> [!WARNING]
> 
> **你应该使用该对象提供的 setter 方法而不是直接修改它的某个属性。**

## One Dimension Object

抽象类 OneDimensionObject 是所有一维对象的基类。派生于 [BasicObject](#basic-object)。

OneDimensionObject 是“一维的”，这意味着它拥有一个主轴，且可以沿着主轴来变化它在这个方向上的大小分量。

### 属性

|名称|描述|类型|
|:-:|:-:|:-:|
|`ihatRotate`|它的主轴对于 $\begin{bmatrix}1\\0\end{bmatrix}$ 的旋转角|`number`|
|`ihatLength`|它的主轴的长度（该对象在主轴方向上的大小分量）|`number`|

## Two Dimension Object

抽象类 TwoDimensionObject 是所有二维对象的基类。派生于 [BasicObject](#basic-object)。

TwoDimensionObject 是“二维的”，这意味着它拥有一组轴（类似于线性代数里的基），它的大小可以沿轴的分量变化。一般的二维对象的基是正交的。
