# 对象修改工具文档

## 概述

对象修改工具负责编辑已经进入 AOM 动态图的对象。

当前 demo 中，modifier 主要承担：

- 拖拽移动对象
- 处理 `success` / `cancel`
- 在 handoff 中承接 creator / chooser 的输出

## 运行边界

- modifier 运行在 UI 线程
- 真实对象位置写入通过 `BoardApi` / `BoardApiRpc` 发往 Core
- Worker mode 下，真实 AOM 位于 Worker 的 `BoardCore` 中

## 当前数据形态

modifier 接收 summary-like 纯数据条目（通常来自 chooser / creator handoff），通过以下 helper 读取：

- `resolveModifiedObjectPosition()`
- `resolveModifiedObjectRange()`
- `resolveModifiedObjectWorldRect()`
- `resolveActiveModifiedObjects()`

## 写路径

### 高频位置更新

```js
boardApi.modifyObject(objectId, {
  position: { x, y },
});
```

modifier 本地也会同步更新当前条目的 `position`，让后续 position/displacement 计算继续使用最新值。

### 提交

```js
boardApi.commitObjects(objectIds);
```

### 撤销当前活动对象

```js
boardApi.discardActiveObjects(objectIds);
```

这些调用都保持 fire-and-forget。

### 渲染失效

Core 侧的 mutation RPC handler（`modifyObject` / `appendListItem` / `replaceListItem` /
`removeListItem`）在修改 AOM 对象后自动调用 `requestLiveRender` 触发 live 层脏区失效，
并安排立即 flush 使帧回传与 UI overlay 保持同步。

modifier 的 `afterGeometryMutation` 在 boardApi 存在时仅负责 UI overlay 刷新，
live 层重绘由 Core 侧接管。

## 手势模型

当前 modifier 主实现是：

- `ObjectModifierTool` — 继承 `GestureTool`，提供动作生命周期适配
- `GestureBasedObjectModifierTool` — 继承 `ObjectModifierTool`，内置手势生命周期 + displacement 双通道
- `CommonObjectModifierTool` — 继承 `GestureBasedObjectModifierTool`，拖拽移动的默认实现

### 双通道信号

modifier 同时接受：

- `position`
- `displacement`
- `end`
- `cancel`
- `success`

处理顺序：

1. `position` 驱动手势状态机
2. `displacement` 作为无状态增量追加
3. `end` 结束当前手势
4. `success` 提交到静态图
5. `cancel` 回退到初始位置

### `CommonObjectModifierTool`

当前 demo 的默认 modifier。

它维护：

- `_anchorPosition` — 手势起始光标位置
- `_gestureBasePositions` — 当前手势开始时各对象的基准位置
- `_initialPositions` — 首次手势开始时各对象的初始位置（仅供 cancel 回退，永不覆盖）

语义是：

- 首个 `position` 记录锚点
- 后续 `position` 以锚点为基准计算位移
- `displacement` 直接叠加到当前位置，基准位置同步平移
- `end` 结束手势，保留 `_initialPositions` 供后续 cancel 回退
- `cancel` 回退到首次手势前的初始位置
- `success` 提交后清空 `_initialPositions`

## `resolveActiveModifiedObjects()`

modifier 通过 `boardApi` 的 `commitObjects` / `discardActiveObjects` 与 Worker 侧 AOM 交互。
summary-like 条目本身即作为有效输入继续向下流转。

## overlay

modifier 默认 overlay 入口：

```js
renderer.createCompatSelectionEntriesForSummaries(objects, "modifier");
```

因此即使 handoff 桥接过来的是 summary-like 条目，也可以继续显示选择框。

## handoff 协作

modifier 在 handoff 中通常作为 second 阶段：

- creator → modifier
- chooser → modifier

handoff 通过 `wrapToolForHandoff(second, { completeOnCancel: true })` 包装：

- 订阅 `action:complete` 事件感知 `success`
- `cancel` 信号到达时调用 `tool.discardAction()` 后通知完成

完成后切回 first 阶段。

## `applyModifiedObjects()`

`success` 信号最终会触发：

1. `resolveActiveModifiedObjects()`
2. `beforeApplyModifiedObjects()`
3. `boardApi.commitObjects(objectIds)`
4. `afterApplyModifiedObjects()`

## 当前状态

- modifier 已完全适配 Worker mode
- 本地不要求持有真实 `BasicObject` 实例
- 高频修改仍保持同步本地更新 + fire-and-forget RPC
- 选中对象的 overlay 已统一走 summary-like 路径

## 相关文档

- [object-creator-document.md](../../creator/docs/object-creator-document.md)
- [object-chooser-document.md](../../chooser/docs/object-chooser-document.md)
- [active-object-manager-document.md](../../../components/orchestration/docs/active-object-manager-document.md)
- [core-runtime-boundaries.md](../../../docs/core-runtime-boundaries.md)
