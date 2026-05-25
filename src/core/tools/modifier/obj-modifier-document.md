# 对象修改工具文档

## 概述

对象修改工具负责对已有对象进行几何或属性编辑。其核心目标是保证修改前后状态一致，并让活动层渲染正确刷新。

## 关键能力

- resolveModifiedObjects(modificationContext, objects)：规整本次修改涉及的对象集合
- resolveActiveModifiedObjects(modificationContext, objects)：仅保留当前仍在 AOM 动态图中的对象
- beforeGeometryMutation(modificationContext, objects)：修改前捕获对象快照
- afterGeometryMutation(modificationContext, objects)：修改后通知 LiveRenderer.invalidateObjects(...)
- withGeometryMutation(modificationContext, mutate, objects)：把一次对象修改封装为“快照 -> 变更 -> 失效”的统一流程
- applyModifiedObjects(modificationContext, objects)：将当前对象提交回静态图并结束本次修改流程

## 上下文解析规则

修改工具现在统一通过 Tool.resolveContextObjects() 读取对象集合。

也就是说，modifier 优先消费：

- 当前 modificationContext 上已经显式提供的 object 或 objects
- 当前节点 state 中的 object 或 objects

creator 和 chooser 若需要把对象交给 modifier，不再写 nodeContext，而是显式把对象同步到目标 modifier 节点路径的 state。

真正开始修改前，还会再做一层 AOM 过滤：

- 如果当前 board.activeObjectManager.activeObjectIndex 可用，则只保留仍在动态图里的对象
- 不在 AOM 中的对象不会被 modifier 继续修改

## 绝对修改信号语义

当前 position 和 transform 信号在 modifier 链路中的语义是“应用到目标值”，而不是“增量叠加”。

- position.context.value 应携带绝对目标位置 {x, y}
- transform.context.value 应携带目标矩阵 {a, b, c, d}

如果物理输入先产生相对量，应该由设备层先转换成绝对目标值再传入工具，以避免连续增量应用带来的误差累积。

另外，modifier 链路支持 apply 信号：

- apply 不表示几何修改，而表示“结束本次动态修改并提交回静态图”
- modifier 接收到该信号后会调用 AOM.apply(...)
- 提交完成后，modifier 会清理上下文并卸载自身

## 为什么使用 withGeometryMutation

ObjectModifierTool 的典型场景是“某个已存在对象的一次性修改”。

因此它适合提供统一包装器：

- 修改前自动抓取旧几何状态
- 执行修改回调
- 修改后自动触发活动层刷新

这避免了各个 modifier 子类重复写相同的刷新逻辑。

## 当前状态

- ObjectModifierTool 已经把几何刷新协议沉淀到基类
- 具体 modifier 应优先复用基类的 withGeometryMutation(...)
- modifier 当前只修改 AOM 中的动态对象，不直接编辑静态图对象
- apply 提交后 modifier 会卸载，umount 时也会执行清理
- 上下文共享仅限当前工作流涉及的节点路径，不应跨事件复用
