# 对象修改工具文档

## 概述

对象修改工具负责对已有对象进行几何或属性编辑。它的核心关注点是“修改前后状态一致性”与“活动层局部刷新”。

## 关键能力

- `resolveModifiedObjects(modificationContext, objects)`：统一解析本次修改涉及的对象集合。
- `beforeGeometryMutation(modificationContext, objects)`：修改前捕获对象快照。
- `afterGeometryMutation(modificationContext, objects)`：修改后通知 `LiveRenderer.invalidateObjects(...)`。
- `withGeometryMutation(modificationContext, mutate, objects)`：把一次对象修改封装为“快照 -> 变更 -> 失效”的统一流程。
- `modify(modificationContext)`：具体子类实现的修改入口。

## 为什么这里有 `withGeometryMutation`

`ObjectModifierTool` 的典型场景是“某个已存在对象被一次性修改”。

因此它适合提供一个通用包装器：

- 在修改前自动抓取旧几何状态；
- 执行修改回调；
- 修改后自动触发活动层刷新；

这个封装器对于编辑工具来说非常便利，可以避免各个 modifier 子类重复写相同的刷新逻辑。

## 当前状态

- `ObjectModifierTool` 已经将几何刷新协议沉淀到基类。
- 具体 modifier 子类应优先复用基类提供的 `withGeometryMutation(...)`。
- 目前仓库内的修改工具尚未完全覆盖所有修改场景，但基类已经定义了统一刷新契约。
