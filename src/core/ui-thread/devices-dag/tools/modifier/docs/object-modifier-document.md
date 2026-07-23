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

所有手势写入统一走 `applyGesturePatch(objectEntry, patch, interaction)` 入口：
patch 形状与 `modifyObject` 补丁契约一致（`{ position?, data?, transform? }`），
本地条目同步更新（position → 新 Vector、data 合并、transform 浅拷贝），
让后续 position/displacement 计算继续使用最新值。

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
`removeListItem`）在修改 AOM 对象后自动调用 `requestActiveRender` 触发输出层脏区失效，
并安排立即 flush 使帧回传与 UI overlay 保持同步。

modifier 的 `afterGeometryMutation` 在 boardApi 存在时仅负责 UI overlay 刷新，
live 层重绘由 Core 侧接管。

## 手势模型

modifier 采用与 creator 一致的「数据工具 + 手势 processor」拆分，分三层：

- `ObjectModifierTool` — 继承 `GestureTool`，承担对象语义：活动对象解析、
  `applyGesturePatch` 统一写入口（本地条目同步 + `boardApi.modifyObject` RPC）、
  提交/撤销生命周期适配
- `GestureBasedObjectModifierTool` — 继承 `ObjectModifierTool`，承担信号路由：
  cancel / success / orphan end / spatial 双通道的调度。手势钩子（begin / update /
  complete / cancel）与 displacement 处理全部委托给必传的 processor
- `DragGestureProcessor`（`gesture/drag-processor.js`）— 手势状态机：
  持有锚点、基准位置、初始位置全部手势运行时状态，把 position / displacement
  流编译为位置补丁并经宿主的 `applyGesturePatch` 应用

processor 为必传构造参数（无默认手势），缺失时构造抛错：

```js
new CommonObjectModifierTool({ processor: new DragGestureProcessor() });
```

### 双通道信号

modifier 同时接受：

- `position`
- `displacement`
- `end`
- `cancel`
- `success`

处理顺序（由 `GestureBasedObjectModifierTool.process()` 路由）：

1. `position` 驱动手势状态机（`processor.begin` / `processor.update`）
2. `displacement` 作为无状态增量追加（`processor.displace`）
3. `end` 结束当前手势（`processor.complete`）
4. `success` 提交到静态图，随后 `processor.reset()`
5. `cancel` 回退到初始位置（`processor.cancel`）

### `DragGestureProcessor`

它维护：

- `_anchor` — 手势起始光标位置，手势期间固定不动
- `_basePositions` — 当前手势开始时各对象的基准位置（供 update 计算位移）
- `_initialPositions` — 首次手势（或首次 displacement）时各对象的初始位置（仅供 cancel 回退，永不覆盖）

语义是：

- 首个 `position` 记录锚点与基准位置
- 后续 `position` 以锚点为基准计算位移
- `displacement` 直接叠加到当前位置，基准位置同步平移（锚点不动，保持光标-对象偏移）
- `end`（complete）清空锚点与基准位置，保留 `_initialPositions` 供后续 cancel 回退
- `cancel` 回退到首次手势前的初始位置并清空全部状态
- `success` 后由工具层调用 `reset()` 清空 `_initialPositions`

### `CommonObjectModifierTool`

当前 demo 的默认 modifier，纯数据侧工具：

- `canBeginGesture` — 合矩形准入检测（position 落在所有对象合矩形内才允许开始手势）
- 构造函数透传 `options`，装配必传的 `DragGestureProcessor`

不含任何手势状态——锚点、基准位置、初始位置全部由组合的 processor 承担。

## 权威数据来源

modifier 以私有字段 `_overlayModifiedObjects` 作为当前活动对象的唯一权威数据来源。
node state 仅作为非 handoff 场景的 fallback 来源。

### `resolveActiveModifiedObjects(context, objects)`

```js
resolveActiveModifiedObjects(context, objects) {
    if (this._overlayModifiedObjects.length > 0) {
      return this._overlayModifiedObjects;    // 私有字段优先
    }
    return this.resolveModifiedObjects(context, objects); // 非 handoff 场景 fallback
}
```

读取优先级：

1. `_overlayModifiedObjects`（私有字段，handoff 桥接或自身 process 写入）
2. `resolveContextObjects`（node state）

`_overlayModifiedObjects` 在以下时机写入：

- `process()` 中每次信号处理结束时：`this._overlayModifiedObjects = objects`
- `receiveHandoffObjects()` 中：handoff 从 first 切换时写入
- `clearOverlayState()` 中：清空

### `receiveHandoffObjects(objects, context)`

`GestureBasedObjectModifierTool` 上的方法，由 handoff 在 first 完成时立即调用。

```js
receiveHandoffObjects(objects, context = {}) {
    if (this._overlayModifiedObjects.length > 0) return;
    this._overlayModifiedObjects = this.normalizeObjectCollection(objects);
    this.syncUiOverlay(context);          // 注册 overlay provider
    this.requestUiOverlayRefresh(context); // 触发 UI 刷新
}
```

使用约束：

- 不写 node state——`process()` 执行时会通过 `setContextObjects` 写入正确的路径
- 重复调用时如果 `_overlayModifiedObjects` 已非空则跳过
- 同步完成后调用 `requestUiOverlayRefresh` 确保 overlay 立即显示

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

### 包装方式

`HandoffWrapperTool` 把 modifier 作为内部槽位托管：

- 构造期一次性订阅 modifier 的 `action:complete` 事件感知 `success`
- 构造期把实例属性 `autoUmountOnApply`（默认 `true`）置为 `false`，阻止提交后自卸载
- `cancel` 信号到达时由 wrapper 调用 `tool.discardAction()` 丢弃活动对象，并切回 first 阶段

### 对象同步协议

modifier 通过 `receiveHandoffObjects(objects, context)` 接收 handoff 桥接的对象：

1. first 完成时由 wrapper 的完成回调立即调用
2. 写入 `_overlayModifiedObjects` 私有字段
3. 调用 `syncUiOverlay(context)` 注册 overlay provider
4. 调用 `requestUiOverlayRefresh(context)` 刷新 UI

后续信号到达 modifier 的 `process()` 时，`resolveActiveModifiedObjects` 优先从私有字段读取。
wrapper 不修改 modifier 的 node state。

### 阶段切换

- first → second：`receiveHandoffObjects` 同步完成后切换
- second → first：modifier 的 `action:complete` 或 `cancel` 完成后切换。wrapper 不清理 modifier 的 node state，由 modifier 自己的 `clearOverlayState` 管理

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
- modifier 已完成「数据工具 + 手势 processor」拆分：拖拽手势状态机由 `DragGestureProcessor` 承担，`CommonObjectModifierTool` 只保留合矩形准入检测与 processor 装配

## 相关文档

- [object-creator-document.md](../../creator/docs/object-creator-document.md)
- [object-chooser-document.md](../../chooser/docs/object-chooser-document.md)
- [wrapper-document.md](../../wrapper/docs/wrapper-document.md)
- [active-object-manager-document.md](../../../../../engine/orchestration/docs/active-object-manager-document.md)
- [core-runtime-boundaries.md](../../../../../docs/core-runtime-boundaries.md)
