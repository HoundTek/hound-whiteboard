# 对象选择工具文档

## 概述

对象选择工具负责从白板中挑选对象，并把它们加入 AOM 动态图，作为后续 modifier 的输入来源。

chooser 本身不修改对象几何。它的职责是：

- 决定哪些对象被选中
- 把这些对象送入 AOM
- 在必要时把选择结果桥接给 handoff / modifier

## 运行边界

- chooser 运行在 UI 线程
- 真实命中与对象摘要读取可通过 `BoardApiRpc` 发往 Worker
- 选中对象进入 AOM 后，真实动态态仍由 Worker 侧 `ActiveObjectManager` 维护

## 当前数据形态

chooser 当前可处理两类条目：

1. `BasicObject` 实例（same-thread compat）
2. summary-like 纯数据条目（Worker mode）

基类通过以下 helper 兼容两类输入：

- `resolveSelectedObjectReference()`
- `resolveSelectedObjectReferences()`
- `resolveObjectSelectionWorldRange()`
- `resolveObjectIds()`

## 生命周期写路径

### 选中

```js
boardApi.addActiveObjects(objectIds);
```

### 清空当前选择

```js
boardApi.discardActiveObjects(objectIds);
```

这两条写路径保持 fire-and-forget。

## 读路径

基类本身只提供读路径抽象，不规定命中方式。

在当前实现中：

- `ObjectChooserTool` 保持同步基类语义
- `RectangleObjectChooserTool` 在 Worker mode 下会让 `process()` 返回 Promise
- Promise resolve 后再执行 `finalizeSelection()`

因此 chooser 是三大工具里唯一一个**正式拥有异步读路径**的族。

## 主要钩子

### `afterChoose(objects)`

每次成功选择对象后触发，handoff 可通过 `on("afterChoose", ...)` 订阅。

### `confirmSelection(context, objects)`

显式确认当前选择。子类在手势结束时调用它。

内部流程：

1. `beforeConfirmSelection(context)`
2. `afterConfirmSelection(context, objects)`

handoff 常通过 `afterConfirm` 事件切到 modifier 阶段。

## `resolveSelectedObjectReference()`

当前规则：

- 若条目本身是 `BasicObject`，直接返回
- 若是 summary-like 条目，则优先通过 `objectId` 回填
- 在 Worker mode 下禁止回退到本地 stale `board.getObjectById()`
- 若无法回填真实实例，则保留 summary-like 条目继续向下游传递

因此 modifier / overlay 不再依赖“必须拿到真实 `BasicObject` 实例”。

## overlay

chooser 基类的默认 overlay 路径是：

```js
renderer.createCompatSelectionEntriesForSummaries(objects, "chooser");
```

这条路径兼容：

- `BasicObject`
- summary-like 条目
- plain `boundingBox` / `worldRect`

## 卸载清理

`umount(context)` 会：

1. 丢弃当前活动对象（`discardActiveObjects` 或 `AOM.discard`）
2. 清空节点 context 中的对象集合
3. 调用 `super.umount()`

## 当前状态

- chooser 已接通 Worker mode 的异步读路径
- 选框 overlay 已统一走 summary-like 兼容路径
- 真实命中策略由具体子类实现

## 相关文档

- [rectangle-object-chooser-document.md](./rectangle-object-chooser-document.md)
- [object-modifier-document.md](../../modifier/docs/object-modifier-document.md)
- [ui-renderer-document.md](../../../components/renderer/docs/ui-renderer-document.md)
- [core-runtime-boundaries.md](../../../docs/core-runtime-boundaries.md)
