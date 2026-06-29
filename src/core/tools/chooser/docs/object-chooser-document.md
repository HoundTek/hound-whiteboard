# 对象选择工具文档

## 概述

对象选择工具负责从白板中挑选对象，并把它们加入 AOM 动态图，作为后续 modifier 的输入来源。

它不是直接修改对象的工具，而是"把哪些对象送进动态编辑态"的入口。

## BoardApi 双路径

与 Creator / Modifier 一致，ObjectChooserTool 支持两条写路径，通过 `context.acc.boardApi` 是否注入来决定：

**BoardApi 路径**：

- 生命周期选择 → `boardApi.addActiveObjects(objectIds)`
- 生命周期撤销 → `boardApi.discardActiveObjects(objectIds)`
- 读路径 → 通过 `resolveObjectSelectionWorldRange()` 等同步兼容层读取世界范围，不依赖 `queryObjects` / `hitTest`

**Legacy 路径**：

- 生命周期选择 → `AOM.choose(new Set(objects))`
- 生命周期撤销 → `AOM.discard(new Set(objects))`
- 读路径 → 直调 `objectEntry.getRange()` + `objectEntry.position`

### 子类接入点

| 方法                                                | 职责                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `resolveSelectedObjectId(entry)`                    | 从对象条目提取数字 objectId                                                                       |
| `resolveSelectedObjectIds(context, objects)`        | 批量提取去重 objectId 列表                                                                        |
| `resolveSelectedObjectReference(context, entry)`    | 若 entry 非 `BasicObject` 实例，尝试通过 `boardApi.getBoardCore().getObjectById()` 回填为真实实例 |
| `resolveSelectedObjectReferences(context, objects)` | 批量回填为真实实例                                                                                |
| `resolveObjectSelectionWorldRange(context, entry)`  | 解析对象在世界空间中的判定范围（兼容 `range` / `getRange()` / `boundingBox`）                     |

### P2 / P3 边界

- **P2 当前实现**：读路径通过同步兼容层直接从对象条目读取 position / range，保持 `process()` 同步。写路径 `addActiveObjects` / `discardActiveObjects` fire-and-forget。
- **P3 后续方向**：读路径可引入 `boardApi.hitTest(range, mode?)` 做命中查询、`boardApi.queryObjects(ids)` 获取摘要。写路径变为真正跨线程 RPC。

## 选择生命周期钩子

chooser 提供与 creator / modifier 一致的生命周期钩子，handoff 通过订阅钩子感知选择完成，无需外部信号检测：

### 通知型钩子

| 钩子                                      | 事件名           | 触发时机                                         |
| ----------------------------------------- | ---------------- | ------------------------------------------------ |
| `afterChoose(objects)`                    | `"afterChoose"`  | 每次成功选择对象后（`setContextObjects` 完成时） |
| `afterConfirmSelection(context, objects)` | `"afterConfirm"` | 手势结束时（子类调用 `confirmSelection`）        |

### 控制型钩子

| 钩子                              | 语义                      |
| --------------------------------- | ------------------------- |
| `beforeConfirmSelection(context)` | 返回 `false` 阻止确认通知 |

### confirmSelection 入口

```
confirmSelection(context, objects)
  │
  ├─ beforeConfirmSelection()   ← 控制型钩子
  └─ afterConfirmSelection()    ← 通知型钩子，handoff 订阅 "afterConfirm"
```

## 选择结果回填

`process()` 在选择完成后，通过 `resolveSelectedObjectReferences()` 尝试把选项中可能为 summary-like 的条目回填为真实 `BasicObject` 实例：

```js
const selectedObjects = this.resolveSelectedObjectReferences(
  selectionContext.context,
  this.choose(selectionContext),
);
```

这使得下游 handoff / modifier / overlay 在 P2 阶段仍能获取对象实例，不必立即适配 summary 格式。

## 为什么选择结果要进入 AOM

对象选择工具选中的不是"随便一组对象"，而是后续要进入动态编辑态的对象。

一旦对象被 `choose` / `addActiveObjects` 放进 AOM：

- 它就处于动态图中
- 后续 modifier 只修改这类对象
- 只要对象仍未 apply 回静态图，就不应再被重复选择

这保证了选择、编辑、提交三段语义是一致的。

## 与 modifier 的关系

chooser 和 modifier 的关系是父子关系，而不是并列关系：

- chooser 是 provider 节点
- modifier 是真正执行几何修改的节点
- chooser 负责把对象放到当前节点与子工具路径 state 中，并在需要时把信号继续转发给子 modifier

## 命中范围约束

对象选择工具在判断"对象是否命中 / 是否应被框选"时，应统一以对象的主判定范围 `getRange()` 为准，而不是直接使用 `boundingBox`。

但为了兼容 summary-like 条目（没有 `getRange` 方法），也支持 `range` 字段和 `boundingBox` 兜底。

## 与兼容 ui 选择框的关系

当前 chooser 基类声明兼容选择框 provider，默认从当前节点 state 中读取 `objects`。

当当前工具仍是 chooser 时，选择框会显示在这些对象各自的矩形范围上。
若 chooser 已切到下游 modifier，则兼容层会优先采用 modifier 节点状态，避免两套框重复绘制。
拖拽中的框选矩形由子类自己的 overlay 条目补充。

这里依旧只是兼容方案，不代表 chooser 节点 state 就是未来 overlay 系统的最终协议。

## 卸载清理

chooser 被 umount 时会执行清理：

- BoardApi 路径：`boardApi.discardActiveObjects(objectIds)`
- Legacy 路径：`AOM.discard(new Set(objects))`
- 清空当前节点上下文中的对象引用
- 执行工具自身的 reset()

## 当前状态

- ObjectChooserTool 基类已支持 BoardApi-first 双路径生命周期
- 基类同步兼容层：`resolveSelectedObjectId`、`resolveSelectedObjectReference`、`resolveObjectSelectionWorldRange`
- 具体命中规则仍由子类实现 `choose(selectionContext)` 决定
- P2 读路径保持同步；P3 可引入 `queryObjects` / `hitTest`
