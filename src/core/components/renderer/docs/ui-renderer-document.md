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

- **UI only**：`UiRenderer` 直接操作 `Viewport.uiCanvas` 或 `ViewportProxy.uiCanvas`
- **不进入 Worker**：Worker 侧没有 `UiRenderer`
- **输入来源**：工具节点 state、summary-like 条目、provider 回调

## 当前职责

### 兼容选择框

`UiRenderer` 当前提供两类兼容入口：

- `createCompatSelectionEntriesForObjects(objects, role)`
- `createCompatSelectionEntriesForSummaries(summaries, role)`

其中 Worker mode 下的主入口是 `createCompatSelectionEntriesForSummaries()`。

### rect-like 规整

`UiRenderer` 当前可接受：

- `BasicObject` 实例
- summary-like 条目
- 纯 rect-like 对象（`{ left, top, width, height }` 或 `{ left, top, right, bottom }`）

所有 `worldRect` / `boundingBox` / `screenRect` 都通过 `RectangleRange.fromRectLike()` 统一规整。

这保证了：

- Worker RPC 返回的 plain `boundingBox` 可直接参与 overlay
- chooser / modifier 不需要真实 `BasicObject` 实例也能生成选框

### provider 扩展口

- `registerOverlayProvider(provider)`
- `unregisterOverlayProvider(provider)`

provider 可返回：

- `screenRect`
- `worldRect`
- `position + range`
- `position + boundingBox`
- 或自定义 `draw(context, runtime)`

## 当前默认 overlay 来源

### chooser

`ObjectChooserTool.collectUiOverlayEntries()` 会把当前上下文对象交给：

```js
renderer.createCompatSelectionEntriesForSummaries(objects, "chooser");
```

### modifier

`ObjectModifierTool.collectUiOverlayEntries()` 也走同一入口：

```js
renderer.createCompatSelectionEntriesForSummaries(objects, "modifier");
```

### rectangle chooser drag rect

`RectangleObjectChooserTool` 额外声明拖拽矩形 overlay：

- 半透明填充
- 矩形边框
- 独立于已选对象的兼容选择框

## 与 Viewport / ViewportProxy 的关系

- `Viewport` / `ViewportProxy` 持有 `UiRenderer`
- `requestViewportUiRender()` 通过 `UiRenderer.invalidateViewport()` 请求刷新
- `resizeRenderLayers()` 时会同步调整 `uiCanvas` 尺寸

## 与 AOM / tools 的关系

`UiRenderer` 自身不管理 AOM 状态，它只消费调用方提供的条目。

AOM、creator、chooser、modifier 当前都可能推动 ui 层刷新，但真正决定“画什么”的是：

- tool 当前写入的 node state
- tool 注册的 overlay provider
- `UiRenderer` 对 summary-like / rect-like 数据的规整逻辑

## 当前状态

- `UiRenderer` 已稳定作为 UI overlay 层运行
- Worker mode 下 chooser / modifier 选框已全面依赖 summary-like 路径
- plain `boundingBox` / `worldRect` 已可直接参与 overlay
- 更复杂的控制杆、激光笔等 overlay 仍属于后续扩展空间

## 相关文档

- [viewport-document.md](../../orchestration/docs/viewport-document.md)
- [object-chooser-document.md](../../../tools/chooser/docs/object-chooser-document.md)
- [object-modifier-document.md](../../../tools/modifier/docs/object-modifier-document.md)
- [core-runtime-boundaries.md](../../../docs/core-runtime-boundaries.md)
