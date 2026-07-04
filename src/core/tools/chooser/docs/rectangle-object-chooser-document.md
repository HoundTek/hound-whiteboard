# 矩形框选工具文档

## 概述

`RectangleObjectChooserTool` 是当前 demo 默认使用的 chooser 实现。

它提供一条完整链路：

1. 按下后记录拖拽起点
2. 拖拽过程中持续维护当前框选矩形
3. 抬起时按矩形范围命中对象
4. 用新结果替换上一轮选择

## 拖拽状态

工具通过节点 state 维护：

- `isSelecting`
- `selectionStart`
- `selectionCurrent`
- `selectionWorldRect`

这些状态用于：

- 驱动 end/cancel 时的行为
- 声明拖拽中的矩形 overlay

## 命中读取

### 拖拽中

拖拽中只有本地 state 更新，不发 RPC。

### 抬起时

读路径：

```js
boardApi.hitTest(selectionWorldRect, "intersect")
  -> objectIds[]
  -> boardApi.queryObjects(objectIds)
  -> summaries[]
```

因此 `process()` 可能返回 Promise，`finalizeSelection()` 会在 Promise resolve 后执行。

## `replaceSelection()` 语义

`replaceSelection()` 用于替换当前选择：

1. 丢弃上一轮选择
2. 清空当前 context objects
3. 解析新选择条目
4. 将新选择加入 AOM
5. 把新条目写回 context

Worker mode 下：

- 丢弃：`boardApi.discardActiveObjects(previousIds)`
- 选择：`boardApi.addActiveObjects(nextIds)`

## overlay

`RectangleObjectChooserTool.collectUiOverlayEntries()` 会在基类默认选择框之外，再附加一条矩形 overlay：

- `type: "rect"`
- `worldRect: dragState.worldRect`
- 半透明蓝色填充 + 边框

## handoff 协作

`finalizeSelection()` 内部会：

1. `replaceSelection()`
2. `clearSelectionDragState()`
3. `afterChoose()`
4. `confirmSelection()`
5. `requestUiOverlayRefresh()`

handoff 通常通过 `afterConfirm` 事件切到 modifier。

## 当前状态

- Worker mode 下已接通 `hitTest + queryObjects` 异步读路径
- 选择替换仍是 fire-and-forget 写路径
- 拖拽框与选中框都已接通 `UiRenderer`

## 相关文档

- [object-chooser-document.md](./object-chooser-document.md)
- [ui-renderer-document.md](../../../components/renderer/docs/ui-renderer-document.md)
- [core-input-flow.md](../../../docs/core-input-flow.md)
