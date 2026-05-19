# 对象修改工具文档

本文档提供 `ObjectModifierTool` 的概述。

对象修改工具负责在对象已经存在的前提下，对其几何形态、样式或其它可编辑属性施加变更。它是“创建对象”之后的第二条核心运行时链路。

## 职责边界

`ObjectModifierTool` 是所有对象修改工具的抽象基类。当前它只定义统一接口：

- 输入一份修改上下文 `modificationContext`
- 在子类中实现具体修改逻辑 `modify(modificationContext)`

它本身不负责：

- 创建新对象
- 管理活动对象分层
- 直接持久化页数据

## 与平面式页管理的关系

在平面式页管理模型下，对象存在于世界坐标系中，页只是最小加载单元。因此对象修改工具不只是“改一改对象属性”这么简单。

只要某次修改可能改变对象的世界范围，后续就必须考虑页级索引同步问题：

- 对象几何变化后，`PageObjectManager.objectCoverPages` 可能需要重算。
- 覆盖页索引一旦变化，`ActiveObjectManager.pickup(...)` 和 `choose(...)` 的跨页结果也会随之变化。
- 如果修改工具链没有触发索引刷新，AOM 将继续读取旧覆盖范围。

## 当前实现状态

当前 `ObjectModifierTool` 仍是一个很薄的抽象层：

- 已实现：统一的 `modify(modificationContext)` 抽象接口。
- 未完成：把“对象修改完成后刷新覆盖页索引”统一接入修改工具链。

这意味着当前文档中的职责重点不是已有复杂逻辑，而是明确后续接线方向：

1. 找到对象几何真正落地变化的入口。
2. 在该入口刷新对应对象的覆盖页索引。
3. 必要时再同步 owner page 变化或相关页可见索引。

## API

| 名称                          | 描述                   | 类型          |
| ----------------------------- | ---------------------- | ------------- |
| `modify(modificationContext)` | 对已有对象应用一次修改 | `Object -> *` |

## 相关文档

- [active-object-manager-document.md](../../components/docs/active-object-manager-document.md)
- [page-object-manager-document.md](../../components/docs/page-object-manager-document.md)
