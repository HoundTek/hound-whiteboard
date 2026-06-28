# 基础类型文档

本文档提供白板中基础类型对象的概述。

## Basic Object

抽象类 BasicObject 是白板上所有高级对象的基类。

BasicObject 是“零维的”，这意味着这个对象本身的宽度和高度都无法被调整，也意味着白板上的所有高级对象都是零维的。

### 属性

| 名称           | 描述                                                                                          | 类型                  |
| -------------- | --------------------------------------------------------------------------------------------- | --------------------- |
| `position`     | 对象的位置 (除特殊说明外，下文中的坐标默认相对于该位置)                                       | `Vector`              |
| `transform`    | 对象的变换矩阵 (除特殊说明外，下文中的坐标默认是在 $\begin{bmatrix}1&0\\0&1\end{bmatrix}$ 下) | `Matrix`              |
| `property`     | 渲染与行为属性字典，存放颜色、描边宽度、字体等                                                | `Object`              |
| `data`         | 对象类型专属的持久化数据，如圆的半径、多边形的顶点集等                                        | `Record<string, any>` |
| `rich`         | 运行时计算派生的富数据，如边界矩形、凸包、变换后的路径等                                      | `Record<string, any>` |
| `isErasable()` | 是否是可擦对象                                                                                | `() => boolean`       |
| `isDirected()` | 是否是有向对象                                                                                | `() => boolean`       |

> **可擦对象**是可以被[橡皮工具](../tools/eraser/obj-eraser-document.md)所擦除的对象。所以对于可擦对象，想删除它就有两个办法：一是在菜单中选择删除，二是用橡皮工具将其擦干净。
>
> **有向对象**是拥有旋转初相的对象。它可以自定义旋转中心、记录旋转角度以及归中。

### 方法

注意，以下的方法都是虚方法，具体实现请看派生类。

| 名称                                          | 描述                                 | 类型                                              |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------------- |
| `constructor(id, position, property?, data?)` | 创建对象实例                         | `(number, Vector, Object, Object) => BasicObject` |
| `setData(data)`                               | 批量更新持久化数据，自动触发派生重算 | `(Object) => Object`                              |
| `appendListItem(key, ...items)`               | 向列表型字段追加一项或多项           | `(string, ...any) => void`                        |
| `replaceListItem(key, index, item)`           | 替换列表型字段中指定索引的项         | `(string, number, any) => void`                   |
| `removeListItem(key, index)`                  | 移除列表型字段中指定索引的项         | `(string, number) => void`                        |
| `_onDataChange(keys)`                         | 数据变更回调，子类重写以触发派生重算 | `(string[]) => void`                              |
| `setTransform(matrix)`                        | 设置变换矩阵                         | `(Matrix) => void`                                |
| `applyTransform(matrix)`                      | 应用变换矩阵，即右乘一个新矩阵       | `(Matrix) => void`                                |
| `calculateConvexHull()`                       | 计算对象的凸包                       | `void`                                            |
| `calculateRectangle()`                        | 计算对象的矩形范围                   | `void`                                            |
| `getRange()`                                  | 获取对象的主判定范围                 | `() => Range`                                     |
| `setProperty(property)`                       | 合并对象属性                         | `(Object) => Object`                              |
| `getRenderPadding()`                          | 从对象属性动态推导渲染留白           | `() => number`                                    |
| `isErasable()`                                | 返回对象是否可擦                     | `() => boolean`                                   |
| `isDirected()`                                | 返回对象是否有向                     | `() => boolean`                                   |
| `render(ctx)`                                 | 在 `ctx` 上渲染该对象                | `(CanvasRenderingContext2D) => boolean`           |
| `serialize()`                                 | 将该对象转为一个 JSON 对象           | `() => Object`                                    |
| `static parse(obj)`                           | 将一个合法的 JSON 对象转为该类对象   | `(Object) => BasicObject`                         |

> [!WARNING]
>
> **不要直接修改 `this.data` 或 `this.rich` 的子字段。应使用 `setData()` 或列表操作方法写入数据，以确保派生富数据同步更新。**

### 序列化约定

所有可持久化对象的 `serialize()` 都应返回一个可直接转成 JSON 的普通对象，并包含以下字段：

| 名称        | 描述                                             |
| ----------- | ------------------------------------------------ |
| `type`      | 对象类型标识，用于统一反序列化分发               |
| `id`        | 对象 id                                          |
| `position`  | 对象位置，由 `Vector.serialize()` 生成           |
| `transform` | 对象变换矩阵，由 `Matrix.serialize()` 生成       |
| `property`  | 渲染与行为属性字典，如颜色、描边宽度、字体等     |
| `data`      | 对象类型专属几何/内容数据，如 `points`、`radius` |

第一层字段 `id`、`position`、`property`、`data` 是通用骨架，各对象类型通过 `type` 区分，并将自身的几何参数填充到 `data` 内。例如：

- `CircleObject` → `data: { radius }`
- `PolygonObject` → `data: { points }`
- `StrokeObject` → `data: { points }`

当前统一反序列化入口位于 [src/core/objects/object-deserializer.js](src/core/objects/object-deserializer.js)。

推荐做法是将持久化数据交给其中的 `deserialize()`，而不是在业务代码里手动根据 `type` 分支调用某个对象类的 `parse()`。

当前已接入统一入口的对象类型有：

- `PolygonObject`
- `StrokeObject`
- `CircleObject`

### 数据模型：`data` 与 `rich`

每个对象的数据分为两层：

- **`this.data`** — 持久化原始数据。存放对象类型专属的基础参数，如圆的半径 `{ radius }`、多边形的顶点 `{ points }`。此字段直接参与序列化，写入的值必须是可 JSON 序列化的普通类型。
- **`this.rich`** — 运行时派生富数据。存放从 `data` 和 `transform` 计算得出的几何结构，如 `boundingBox`、`convexHullRange`、`worldPolygonRange`。此字段不参与持久化，可在必要时重算。

两层的关系：`setData()` / 列表操作方法修改 `data` 后自动触发 `_onDataChange()`，由子类更新 `rich`。

### 数据变更 API

所有数据修改都应通过以下方法，不要直接操作 `this.data` 的子字段：

| 方法                                     | 用途                 | 示例                                                           |
| ---------------------------------------- | -------------------- | -------------------------------------------------------------- |
| `setData({ radius })`                    | 批量写入/覆盖字段    | `obj.setData({ radius: 10 })`                                  |
| `setProperty({ color })`                 | 批量写入/覆盖属性    | `obj.setProperty({ color: '#f00' })`                           |
| `appendListItem(key, ...items)`          | 列表追加（支持多项） | `obj.appendListItem('points', { x: 1, y: 2 }, { x: 3, y: 4 })` |
| `appendListItem(key, item)`              | 列表追加（单项）     | `obj.appendListItem('points', pt)`                             |
| `replaceListItem('points', i, { x, y })` | 列表替换             | `obj.replaceListItem('points', 2, pt)`                         |
| `removeListItem('points', i)`            | 列表删除             | `obj.removeListItem('points', 1)`                              |

子类通过重写 `_onDataChange(keys)` 监听关注的字段名，每次变更时批量重建 `rich` 中的派生结构。

### 属性模型约定

- 所有可调的渲染属性都应存放在 `property` 字段，而不是散落在独立字段里
- `property` 的具体键由对象类型自行定义，例如 `StrokeObject.property.width`、`CircleObject.property.strokeWidth`
- `getRenderPadding()` 默认会从 `property.strokeWidth`、`property.width`、`property.outlineWidth` 这类宽度字段动态推导额外留白
- renderer 不再依赖对象族各自硬编码的 padding 常量，而是依赖对象当前 `property` 的真实宽度配置

## One Dimension Object

抽象类 OneDimensionObject 是所有一维对象的基类。派生于 [BasicObject](#basic-object)。

OneDimensionObject 是“一维的”，这意味着它拥有一个主轴，且可以沿着主轴来变化它在这个方向上的大小分量。

### 属性

| 名称         | 描述                                                     | 类型     |
| ------------ | -------------------------------------------------------- | -------- |
| `ihatRotate` | 它的主轴对于 $\begin{bmatrix}1\\0\end{bmatrix}$ 的旋转角 | `number` |
| `ihatLength` | 它的主轴的长度（该对象在主轴方向上的大小分量）           | `number` |

## Two Dimension Object

抽象类 TwoDimensionObject 是所有二维对象的基类。派生于 [BasicObject](#basic-object)。

TwoDimensionObject 是“二维的”，这意味着它拥有一组轴（类似于线性代数里的基），它的大小可以沿轴的分量变化。一般的二维对象的基是正交的。
