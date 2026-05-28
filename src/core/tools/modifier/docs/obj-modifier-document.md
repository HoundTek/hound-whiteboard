# 对象修改工具文档

## 概述

对象修改工具负责对已有对象进行几何或属性编辑。其核心目标是保证修改前后状态一致，并让活动层渲染正确刷新。

## 关键能力

- resolveModifiedObjects(modificationContext, objects)：规整本次修改涉及的对象集合
- resolveActiveModifiedObjects(modificationContext, objects)：仅保留当前仍在 AOM 动态图中的对象
- beforeGeometryMutation(modificationContext, objects)：修改前捕获对象快照
- afterGeometryMutation(modificationContext, objects)：修改后通知 LiveRenderer.invalidateObjects(...)，并同步推动 ui 层兼容 overlay 刷新
- withGeometryMutation(modificationContext, mutate, objects)：把一次对象修改封装为“快照 -> 变更 -> 失效”的统一流程
- applyModifiedObjects(modificationContext, objects)：将当前对象提交回静态图并结束本次修改流程

## 上下文解析规则

修改工具现在统一通过 Tool.resolveContextObjects() 读取对象集合。

也就是说，modifier 优先消费：

- 当前 modificationContext 上已经显式提供的 object 或 objects
- 当前节点 state 中的 object 或 objects

creator 和 chooser 若需要把对象交给 modifier，不再写 nodeContext，而是显式把对象同步到目标 modifier 节点路径的 state。

当前 `UiRenderer` 的兼容选择框实现也会读取这份 modifier 节点 state。

这意味着：

- 当当前工具是 modifier 时，选择框显示在当前被修改对象各自的矩形范围上
- 若当前修改的是多个对象，除了各自矩形框，还会额外显示这些矩形的最小外接大矩形

真正开始修改前，还会再做一层 AOM 过滤：

- 如果当前 board.activeObjectManager.activeObjectIndex 可用，则只保留仍在动态图里的对象
- 不在 AOM 中的对象不会被 modifier 继续修改

## 手势驱动的修改语义

CommonObjectModifierTool 采用与 creator 一致的手势模型，不再依赖绝对坐标。

### 信号类型

| 信号类型 | 常量                                   | 语义                                                   |
| -------- | -------------------------------------- | ------------------------------------------------------ |
| 位移更新 | `"displacement"`                       | 携带 `{ x, y }` 从手势锚点出发的累计位移               |
| 手势结束 | `"end"`                                | 结束当前手势，对象保留在动态图中，后续可开始新一轮手势 |
| 提交修改 | `OBJECT_MODIFIER_SIGNAL_TYPES.SUCCESS` | 将修改完毕的对象 apply 到静态图，结束修改流程          |

### 手势生命周期

```mermaid
flowchart LR
    A[displacement 信号] --> B{手势激活?}
    B -->|否| C[记录初始位置]
    C --> D[对象位置 = initPos + {x,y}]
    B -->|是| D
    D --> E[等待下一信号]
    E -->|displacement| B
    E -->|end 信号| F[手势结束]
    F -->|新一轮 displacement| B
    E -->|success 信号| G[apply 到静态图]
    G --> H[卸载 modifier]
```

### 与 drag-anchor 的协作

`createDragAnchorPrefixHandler` 输出累计 `{ x, y }` 位移信号，modifier 直接应用：

```js
// drag-anchor 输出 "displacement" 信号
const subTree = createSubTree("/mouse/primary/handoff")
  .node("")
  .prefix(createDragAnchorPrefixHandler())
  .defaultChild("tool")
  .node("tool")
  .tool(new CommonObjectModifierTool())
  .end()
  .end()
  .build();
```

### 信号路径

```mermaid
flowchart LR
    Mouse[鼠标世界坐标] --> Anchor[createDragAnchorPrefixHandler]
    Anchor --> Disp["displacement {x,y} 累计位移"]
    Disp --> Modifier[CommonObjectModifierTool]
    Modifier -->|initPos + {x,y}| Obj["obj.position 更新"]
```

### 设计要点

- **锚点在 drag-anchor 中**：modifier 无需关心世界坐标，只消费已转换好的累计位移
- **无内部累加**：drag-anchor 输出累计值，modifier 直接 `initPos + {x, y}`，无浮点累积误差
- **手势语义清晰**：与 creator 的 `begin/update/completeCreationGesture` 模型一致

## 为什么使用 withGeometryMutation

ObjectModifierTool 的典型场景是“某个已存在对象的一次性修改”。

因此它适合提供统一包装器：

- 修改前自动抓取旧几何状态
- 执行修改回调
- 修改后自动触发活动层刷新，并让选中框等兼容 ui overlay 跟上对象变化

这避免了各个 modifier 子类重复写相同的刷新逻辑。

## 当前状态

- ObjectModifierTool 已经把几何刷新协议沉淀到基类
- 具体 modifier 应优先复用基类的 withGeometryMutation(...)
- modifier 当前只修改 AOM 中的动态对象，不直接编辑静态图对象
- success 提交后 modifier 会卸载，umount 时也会执行清理
- 上下文共享仅限当前工作流涉及的节点路径，不应跨事件复用
- 这条 ui 刷新链当前仍属于 Core 兼容行为，不代表 ui overlay 的最终归属已经定案
