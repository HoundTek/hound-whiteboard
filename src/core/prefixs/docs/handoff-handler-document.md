# Handoff 工作流文档

## 概述

`createHandoffSubDAG` 把 first → second 的两阶段工作流封装为一棵结构化子树。典型场景：

- **creator → modifier**：用户画一个笔画，创建完成后直接拖拽修改位置
- **chooser → modifier**：用户选中已有对象，然后拖拽修改位置
- **SubDAGDefinition → modifier**：任意子图作为 first，完成后交给 modifier

## 子树结构

```
/handoff                     ← root（multi-tool prefix 状态机）
  ├── "first" → /handoff/first   ← creator / chooser / 子图
  └── "second" → /handoff/second ← modifier
```

根节点是一个 multi-tool prefix，内部状态为 `{ phase, activeChild }`，通过 `resolveTransition` 回调决定下一跳路由。

## 三种 first 类型

### 1. Creator first

handoff 覆盖 creator 的 `beforeCommitCreatedObject` 返回 `false`，阻止对象提交到静态图，使其停留在 AOM 动态图中。订阅 `afterCreate` 事件，触发时执行对象桥接和状态切换。

### 2. Chooser first

包装为 `wrapChooserForHandoff`，订阅 `afterConfirm` 事件。chooser 确认选择后切入 second。

### 3. SubDAGDefinition first

包装为 `wrapSubDAGForHandoff`，在检测到 `end` 信号（或自定义 `shouldComplete` 条件）时执行桥接和切换。

## 对象桥接协议

first 完成时产生的对象通过以下路径到达 second：

```text
first tool 完成
  → 生命周期事件（afterCreate / afterConfirm / end）
  → handoff wrapper 调用 context.acc.setHandoffObjects(objects)
    → 写入 handoff 闭包变量（不写入 DAG state）
    → handoffExplicitlySet = true
  → onToolComplete()
    → createCompleteCallback 切换 activeChild = "second"
  → 下次 dispatch 进入 resolveTransition
    → 从闭包读取 handoffObjects
    → 注入 acc.objects / acc.handoffObjects
  → second 工具通过 resolveContextObjects 读取 context.acc.objects
```

对象存储闭包变量替代 DAG nodeState，原因：

- **路径无关**：SubDAGDefinition 的内部工具无需知道节点路径，写 `acc.objects` 即可
- **不污染 nodeState**：`dag.getNodeState("/handoff")` 形状不受影响，始终为 `{ phase, activeChild }`

### `acc` 注入字段

| 字段                | 类型       | 语义                                                               |
| ------------------- | ---------- | ------------------------------------------------------------------ |
| `onToolComplete`    | `Function` | first/second 完成通知，触发状态切换                                |
| `autoUmountOnApply` | `boolean`  | 固定为 `false`，阻止 modifier 自卸载                               |
| `objects`           | `Array`    | 当前桥接的对象集合，modifier 通过 `resolveContextObjects` 直接读取 |
| `handoffObjects`    | `Array`    | 同上，供显式读取                                                   |
| `setHandoffObjects` | `Function` | first wrapper 调用此回调将对象写入闭包变量                         |

### 切换判断

- first 完成时：若 `setHandoffObjects` 被显式调用且对象为空（如 creator 创建失败），**不切换**
- first 完成时：若 `setHandoffObjects` 从未被调用（直接调 `onToolComplete`），**始终切换**
- second 完成时：清空闭包变量，切回 first

## 生命周期钩子对照

| 步骤          | 独立模式                          | handoff 模式                                   |
| ------------- | --------------------------------- | ---------------------------------------------- |
| Creator 完成  | `beforeCommit → true` → AOM.apply | `beforeCommit → false` → 对象留在 AOM          |
| Creator 通知  | `afterCreate` 无人订阅            | handoff handler 订阅 `afterCreate`             |
| Chooser 确认  | `confirmSelection` 无人订阅       | handoff handler 订阅 `afterConfirm`            |
| Modifier 提交 | AOM.apply → 自卸载                | AOM.apply → `autoUmountOnApply:false` 阻止卸载 |
| Modifier 通知 | `afterApply` 无人订阅             | handoff handler 订阅 `afterApply`              |

## 辅助函数

### `wrapSubDAGForHandoff(subDAGDef, options)`

在子树根节点满足 `shouldComplete` 条件（默认检测 `end` 信号）时，从 `context.acc.objects` 读取对象并调用 `setHandoffObjects`，然后调用 `onToolComplete`。

### `wrapChooserForHandoff(tool)`

订阅 tool 的 `afterConfirm` 事件，从事件参数取得选中对象，调用 `setHandoffObjects` 后通知完成。

## 生命周期清理

handoff 保存 `beforeCommitCreatedObject` 的原始引用。通过 `subDAG.resetHandoff()` 暴露清理入口，卸载时恢复工具原始行为。

## 轻量对象条目协议

creator 产生的 `_entry` 和 chooser/modifier 流转的条目统一遵循 `LightweightObjectEntry` 协议（定义在 `shared/types.js`）：

```js
{
  id: number,
  type: string,
  position: Vector | { x, y },
  boundingBox?: { left, top, width, height },
  range?: Range,
  property: Record<string, any>,
  data: Record<string, any>,
}
```

两种场景：

| 场景   | 代表者                  | `boundingBox` / `range`                                             |
| ------ | ----------------------- | ------------------------------------------------------------------- |
| 创建态 | creator `_entry`        | 创建完成后通过 `resolveCreatedObjectBoundingBox` 回填 `boundingBox` |
| 摘要态 | chooser / modifier 条目 | 来自 Worker 侧 `queryObjects`，携带完整的 `boundingBox` / `range`   |

消费端通过 `Vector.parse()` 统一处理 `position` 的两种形态，通过 `RectangleRange.fromRectLike()` 统一处理 `boundingBox`。

## 相关文档

- [prefix-document.md](./prefix-document.md)
- [object-creator-document.md](../../tools/creator/docs/object-creator-document.md)
- [object-modifier-document.md](../../tools/modifier/docs/object-modifier-document.md)
- [object-chooser-document.md](../../tools/chooser/docs/object-chooser-document.md)
- [core-data-model.md](../../docs/core-data-model.md)
