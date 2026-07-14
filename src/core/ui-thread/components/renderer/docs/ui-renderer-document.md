# UI 覆盖层渲染器文档

本文档提供 `UiRenderer` 的概述。

## 概述

`UiRenderer` 运行在 UI 线程，负责把 overlay 绘制到 `uiCanvas`。

它处理的内容包括：

- chooser / modifier 的兼容选择框
- 拖拽中的矩形框选框
- 通过 provider 注册的自定义 overlay

`UiRenderer` 不参与 Worker 侧 base/live 渲染，只负责 UI 线程中的提示层。

## 运行边界

- **UI only**：`UiRenderer` 直接操作 `Viewport.uiCanvas`
- **不进入 Worker**：Worker 侧没有 `UiRenderer`
- **不持有 AOM**：`ActiveObjectManager` 是 Worker 侧模块，`UiRenderer` 不引用 AOM。overlay 所需的对象信息通过工具节点 state 或 provider 回调传入
- **输入来源**：工具节点 state、summary-like 条目、provider 回调

## 类层次

```
CanvasHost          — 画布生命周期 + 调度器（canvas-lifecycle.js）
  └─ UiRenderer     — overlay flush + provider 管理
```

`UiRenderer` 继承自 `CanvasHost`，获得 `_canvas` / `_scheduler` 字段、`invalidate()` / `invalidateViewport()` / `resize()` 方法。

## 当前职责

### Provider 注册

provider 签名：`(context: { viewport: Viewport, renderer: UiRenderer }) => any`。

- `registerOverlayProvider(provider)`：注册 provider
- `unregisterOverlayProvider(provider)`：注销 provider

### Overlay 条目收集

- `collectOverlayEntries()`：遍历所有 provider，收集并归一化 overlay 条目
- provider 返回的条目经过 `normalizeOverlayEntry`（委托给 `ui-overlay-factory.js`）归一化，确保 `draw` 函数可用

### 绘制

- `drawRectEntry(context, entry)`：绘制矩形 overlay 条目
- `drawPointEntry(context, entry)`：绘制填充圆点
- `drawPathEntry(context, entry)`：绘制折线/闭合路径

### 脏区刷新

`flush(dirtyRects)` 接收调度器合并后的脏区集合：仅清空脏区范围，跳过不与脏区相交的条目，对剩余条目通过 clip 限制绘制区域。无脏区时回退全量清空+全量绘制。

### 条目规整

条目归一化由 `ui-overlay-factory.js` 中的纯函数 `normalizeOverlayEntry` 处理。输入的条目必须含 `geometry` 字段，无 geometry 的条目被 normalize 丢弃。

归一化处理：

1. 将 `geometry` 中的 world 坐标（`worldRect`/`worldPoint`/`worldPoints`）转为 screen 坐标
2. 清理已转换的 world 字段
3. 为未提供 `draw` 的条目注入对应类型的默认绘制函数

`createCompatSelectionEntriesForSummaries` 负责从 Worker RPC 返回的 summary 构建 entry，外部无需手动转换。

### 选择框条目生成

选择框条目的生成由 `ui-overlay-factory.js` 中的 `createCompatSelectionEntriesForSummaries` 纯函数负责，不再挂在 `UiRenderer` 实例上。

## 当前默认 overlay 来源

### chooser

`ObjectChooserTool.collectUiOverlayEntries()` 调用 factory：

```js
import { createCompatSelectionEntriesForSummaries } from ".../ui-overlay-factory.js";
createCompatSelectionEntriesForSummaries(objects, "chooser", viewport);
```

### modifier

`ObjectModifierTool.collectUiOverlayEntries()` 同样调用 factory：

```js
createCompatSelectionEntriesForSummaries(objects, "modifier", viewport);
```

### rectangle chooser drag rect

`RectangleObjectChooserTool` 额外声明拖拽矩形 overlay：

- 半透明填充
- 矩形边框
- 独立于已选对象的兼容选择框

### circle creator point + path

`CircleCreatorTool.collectUiOverlayEntries()` 返回两个 overlay：

| source          | type    | 说明                 |
| --------------- | ------- | -------------------- |
| `circle-center` | `point` | 圆心蓝色圆点         |
| `circle-radius` | `path`  | 圆心到手指的虚线线段 |

这演示了如何用 `type: "point"` 和 `type: "path"` 为创建工具添加可视辅助。

## overlay 条目格式

条目分三层结构：

```javascript
{
  source: "circle-center",  // 来源标识
  type: "point",            // 判别器
  geometry: { worldPoint: center, radius: 4 },  // 坐标数据
  style: { fillStyle: "#33a1ff" },              // 画法属性
}
```

### type + geometry

| type    | geometry 字段                                    |
| ------- | ------------------------------------------------ |
| `rect`  | `screenRect` / `worldRect`                       |
| `point` | `screenPoint` / `worldPoint` + `radius`          |
| `path`  | `screenPoints[]` / `worldPoints[]` + `closePath` |

world 字段在归一化阶段由 `normalizeOverlayEntry` 转为 screen 字段后清空。

### style

| 字段          | 说明   |
| ------------- | ------ |
| `fillStyle`   | 填充色 |
| `strokeStyle` | 描边色 |
| `lineWidth`   | 线宽   |
| `lineDash`    | 虚线   |

## 与 Viewport 的关系

- `Viewport` 持有 `UiRenderer`
- `requestViewportUiRender()` 通过 `UiRenderer.invalidateViewport()` 请求刷新
- `resizeRenderLayers()` 时会同步调整 `uiCanvas` 尺寸

## 与 tools 的关系

`UiRenderer` 不持有 AOM（AOM 为纯 Worker 侧模块）。overlay 所需的对象信息通过以下渠道传入：

- tool 当前写入的 node state（通过 `deviceContext` 读取）
- tool 注册的 overlay provider

creator、chooser、modifier 都可能推动 ui 层刷新，但 `UiRenderer` 仅消费 provider 产出的条目，不关心数据来源。

## 实例方法一览

| 方法                                  | 职责                                 |
| ------------------------------------- | ------------------------------------ |
| `constructor(viewport, options)`      | 初始化 CanvasHost，创建调度器        |
| `registerOverlayProvider(provider)`   | 注册自定义 overlay provider          |
| `unregisterOverlayProvider(provider)` | 注销 provider                        |
| `collectProviderOverlayEntries()`     | 收集并归一化所有 provider 条目       |
| `collectOverlayEntries()`             | 收集当前应绘制的 overlay（调用上者） |
| `drawRectEntry(context, entry)`       | 绘制矩形条目                         |
| `drawPointEntry(context, entry)`      | 绘制点（填充圆点）条目               |
| `drawPathEntry(context, entry)`       | 绘制路径（折线/闭合路径）条目        |
| `flush(dirtyRects)`                   | 执行 UI 覆盖层刷新                   |

## 相关文档

- [canvas-lifecycle-document.md](../../../../engine/renderer/docs/canvas-lifecycle-document.md)
- [ui-overlay-factory-document.md](./ui-overlay-factory-document.md)
- [viewport-document.md](../../../../ui-thread/components/orchestration/docs/viewport-document.md)
- [object-chooser-document.md](../../../devices-dag/tools/chooser/docs/object-chooser-document.md)
- [object-modifier-document.md](../../../devices-dag/tools/modifier/docs/object-modifier-document.md)
- [core-runtime-boundaries.md](../../../../docs/core-runtime-boundaries.md)
