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

手势写入统一走增量式分子：

- 首个 position/displacement 帧 `beginMol(objectIds, { supraKey })` 开启分子（`#ensureMol`）
- 逐帧 `amendMol(molId, { [objectId]: patch })` 施加增量修正
- 松手 `endMol(molId)` 把 amend 流折叠物化为分子记录上链
- 取消 `abortMol(molId)` 丢弃 amend 流，内核实例还原到手势 before

`boardApi.modifyObject(objectId, patch)` 仅是无分子能力时的回退直调
（`applyGesturePatch` 内部分支）。

所有手势写入统一走 `applyGesturePatch(objectEntry, patch, interaction)` 入口：
patch 形状与 `modifyObject` 补丁契约一致（`{ position?, data?, transform? }`），
本地条目同步更新（position → 新 Vector、data 合并、transform 浅拷贝），
让后续 position/displacement 计算继续使用最新值。

Worker 模式下 `beginMol` 经 RPC 往返异步确认 molId（`_molPending` 挂起）：
确认前补丁只落本地条目，确认后由 `#resolveMol` 补发最新绝对坐标
（幂等覆盖，中间帧由本地渲染承担）。

### 提交

```js
boardApi.commitObjects(objectIds, { supraKey: context?.services?.supraKey });
```

### 撤销当前活动对象

```js
boardApi.discardActiveObjects(objectIds, {
  supraKey: context?.services?.supraKey,
});
```

两个调用都携带 handoff 注入槽位上下文的 `supraKey`，把本次动作挂入会话超分子
（`performAction` / `discardAction` / `umount` 一致携带）。

success 路径先 `endMol` 物化在途分子再 `commitObjects`：
已物化对象由内核水位机制跳过重复 modify，`commitObjects` 只产取消选择分子。

这些调用都保持 fire-and-forget。

### 渲染失效

Core 侧的 mutation RPC handler（`modifyObject` / `appendListItem` / `replaceListItem` /
`removeListItem` / `amendMol`）在修改 AOM 对象后经 `#applyObjectPatch` 自动调用
`requestActiveRender` 触发输出层脏区失效，路由 flush 均为 `sync`（立即 flush），
使帧回传与 UI overlay 保持同步。

modifier 的 `afterGeometryMutation` 在 boardApi 存在时仅负责 UI overlay 刷新，
live 层重绘由 Core 侧接管。

## 手势模型

modifier 采用与 creator 一致的「数据工具 + 手势 processor」拆分，分四层：

- `ObjectModifierTool` — 继承 `GestureTool`，承担对象语义：活动对象解析、
  `applyGesturePatch` 统一写入口（本地条目同步 + amend 流 / 回退 `modifyObject` RPC）、
  提交/撤销生命周期适配
- `GestureBasedObjectModifierTool` — 继承 `ObjectModifierTool`，承担信号路由：
  cancel / success / orphan end / spatial 双通道的调度。手势钩子（begin / update /
  complete / cancel）与 displacement 处理全部委托给必传的 processor
- `DragGestureProcessor`（`gesture/drag-processor.js`）— 手势状态机：
  持有锚点、基准位置、初始位置全部手势运行时状态，把 position / displacement
  流编译为位置补丁并经宿主的 `applyGesturePatch` 应用
- `CommonObjectModifierTool`（`common-object-modifier.js`）— 继承
  `GestureBasedObjectModifierTool`，只剩合矩形准入检测与 processor 装配，
  demo 实例化的就是这个类

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
- `delete`
- `hit:changed`

处理顺序（由 `GestureBasedObjectModifierTool.process()` 路由）：

1. `hit:changed` 失效清理（`#pruneStaleObjects`，见下文「hit 变更失效清理」）
2. `delete`：手势在途时先 `abortMol` 丢弃 amend 流并复位手势状态，再
   `deleteObjects(objectIds, { supraKey })` 永久删除持有对象，随后 `completeAction`
   清空 `_overlayModifiedObjects` 并经 `afterAction` 发出 `action:complete`
   复位 wrapper 相位
3. `cancel`：分子在途（手势进行中取消）走 `abortMol`——内核全量还原到手势
   before（position/data/transform），本地条目回写手势起点；无在途分子走旧路径
   `processor.cancel` 回退到初始位置
4. `success`：先 `endMol` 物化在途分子（松手已闭合的幂等空操作），
   再 `commitObjects` 提交到静态图，随后 `processor.reset()`
5. orphan `end`（无位置信号的孤立 end）：结束当前手势并 `endMol` 物化
6. spatial：`position` 驱动手势状态机（`processor.begin` / `processor.update`），
   `displacement` 作为无状态增量追加（`processor.displace`）；
   首帧 position/displacement 经 `#ensureMol` 开启分子

### hit 变更失效清理

`process()` 收到 `hit:changed` 信号时先经 `#pruneStaleObjects` 做失效清理
（按 `queryObjects` 校验持有对象）：

- 对象不存在或已被移出活动层（如 choose 被撤销的幽灵选择）：中止在途分子
  （`abortMol`），手势进行中走 `discardAction` 回滚几何，无手势时走
  `completeAction` 让 wrapper 复位相位（对已失效对象 commitObjects 为幂等空操作）
- 信号 context 携带 `forcedEndMolIds`（内核 undo 自动闭合的在途分子）且命中
  当前手势分子：手势复位（清空 `_molId` / `_molPending`、
  `isGestureActive = false`、`processor.reset()`），本地条目按内核位置同步；
  对象仍在活动层则保持选中，继续拖动会开启新分子
- 非手势期间的 hit 变更（松手后 undo/redo、对端同步）：本地条目按内核对齐
  位置，防止选中框停留在手势终值与对象错位

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

modifier 以实例字段 `_overlayModifiedObjects` 作为当前活动对象的唯一真相源。
`node.state.objects` 只是 `process()` 经 `setContextObjects` 同步发布的只读投影，逻辑禁止读回。

### `resolveActiveModifiedObjects(context, objects)`

```js
resolveActiveModifiedObjects(context, objects) {
    if (objects != null) {
      return this.normalizeObjectCollection(objects); // 显式传入优先
    }
    return this._overlayModifiedObjects;              // 实例字段真相源
}
```

取值规则：

1. 显式传入的 `objects` 参数（如 `_handleSuccess` 提交路径）
2. `_overlayModifiedObjects`（实例字段，handoff 桥接或自身 process 写入）

不再回退读取 node state 投影。

`_overlayModifiedObjects` 在以下时机写入 / 清空：

- `receiveHandoffObjects()` 中：handoff 从 first 切换时写入
- `process()` 中每次信号处理时：`this._overlayModifiedObjects = objects`
- `discardAction()` 中：丢弃活动对象后清空
- `performAction()` 中：提交到静态图后清空
- `umount()` 中：卸载时清空

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

modifier 默认 overlay 入口直接调用 `ui-overlay-factory.js` 导出的纯函数：

```js
import { createCompatSelectionEntriesForSummaries } from "../../../components/renderer/ui-overlay-factory.js";

createCompatSelectionEntriesForSummaries(objects, "modifier", viewport);
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

### 阶段切换

- first → second：`receiveHandoffObjects` 同步完成后切换
- second → first：modifier 的 `action:complete` 或 `cancel` 完成后切换。wrapper 不清理 modifier 的 node state；`cancel` 路径由 wrapper 调用 `discardAction()` 丢弃活动对象并清空 `_overlayModifiedObjects`

## `applyModifiedObjects()`

`success` 信号经 `applyModifiedObjects(context, objects)` 进入 `GestureTool` 生命周期：

1. `beforeAction()`：`resolveActionObjects()` 取提交集合（内部回退到 `resolveActiveModifiedObjects()`）→ `beforeApplyModifiedObjects()` 可否决 → 取 `services.boardApi`
2. `performAction()`：`boardApi.commitObjects(objectIds, { supraKey: context?.services?.supraKey })`，随后清空 `_overlayModifiedObjects` 与 node state 投影，按 `autoUmountOnApply` 决定是否 `unmount`
3. `afterAction()`：`afterApplyModifiedObjects(context, objects, result)`

## 相关文档

- [object-creator-document.md](../../creator/docs/object-creator-document.md)
- [object-chooser-document.md](../../chooser/docs/object-chooser-document.md)
- [wrapper-document.md](../../wrapper/docs/wrapper-document.md)
- [active-object-manager-document.md](../../../../../kernel/board/docs/active-object-manager-document.md)
- [core-runtime-boundaries.md](../../../../../docs/core-runtime-boundaries.md)
