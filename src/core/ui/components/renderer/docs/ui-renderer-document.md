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
- `flush(dirtyRects)`：清理脏区，裁剪后逐条目执行 `draw`

### 条目规整

条目归一化由 `ui-overlay-factory.js` 中的纯函数 `normalizeOverlayEntry` 处理。可接受：

- `BasicObject` 实例
- summary-like 条目（含 `position + range`、`position + boundingBox`、`worldRect`）
- 纯 rect-like 对象（`{ left, top, width, height }` 或 `{ left, top, right, bottom }`）

所有 `worldRect` / `boundingBox` / `screenRect` 通过 `RectangleRange.fromRectLike()` 统一规整。

这保证了：

- Worker RPC 返回的 plain `boundingBox` 可直接参与 overlay
- chooser / modifier 不需要真实 `BasicObject` 实例也能生成选框

### 选择框条目生成

选择框条目的生成由 `ui-overlay-factory.js` 中的 `createCompatSelectionEntriesForSummaries` 纯函数负责，不再挂在 `UiRenderer` 实例上。

## 当前默认 overlay 来源

### chooser

`ObjectChooserTool.collectUiOverlayEntries()` 调用 factory：

```js
import { createCompatSelectionEntriesForSummaries } from ".../ui-overlay-factory.js";
createCompatSelectionEntriesForSummaries(
  objects,
  "chooser",
  viewport,
  drawRectEntry,
);
```

### modifier

`ObjectModifierTool.collectUiOverlayEntries()` 同样调用 factory：

```js
createCompatSelectionEntriesForSummaries(
  objects,
  "modifier",
  viewport,
  drawRectEntry,
);
```

### rectangle chooser drag rect

`RectangleObjectChooserTool` 额外声明拖拽矩形 overlay：

- 半透明填充
- 矩形边框
- 独立于已选对象的兼容选择框

## 与 Viewport 的关系

- `Viewport` 持有 `UiRenderer`
- `requestViewportUiRender()` 通过 `UiRenderer.invalidateViewport()` 请求刷新
- `resizeRenderLayers()` 时会同步调整 `uiCanvas` 尺寸

## 与 tools 的关系

`UiRenderer` 不持有 AOM（AOM 为纯 Worker 侧模块）。overlay 所需的对象信息通过以下渠道传入：

- tool 当前写入的 node state（通过 `deviceContext` 读取）
- tool 注册的 overlay provider
- `ui-overlay-factory.js` 对 summary-like / rect-like 数据的规整逻辑

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
| `flush(dirtyRects)`                   | 执行 UI 覆盖层刷新                   |

## 相关文档

- [canvas-lifecycle-document.md](../../../../shared/components/renderer/docs/canvas-lifecycle-document.md)
- [ui-overlay-factory-document.md](../../../../shared/components/renderer/docs/ui-overlay-factory-document.md)
- [viewport-document.md](../../orchestration/docs/viewport-document.md)
- [object-chooser-document.md](../../../tools/chooser/docs/object-chooser-document.md)
- [object-modifier-document.md](../../../tools/modifier/docs/object-modifier-document.md)
- [core-runtime-boundaries.md](../../../../docs/core-runtime-boundaries.md)
