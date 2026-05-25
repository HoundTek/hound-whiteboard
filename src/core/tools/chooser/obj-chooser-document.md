# 对象选择工具文档

## 概述

对象选择工具负责从白板静态图中提取对象，并把它们加入 AOM 动态图，作为后续 modifier 的输入来源。

它不是直接修改对象的工具，而是“把哪些对象送进动态编辑态”的入口。

## 核心语义

- chooser 从静态图中命中对象
- chooser 调用 `AOM.choose(startFrom)` 把这些对象加入动态图
- chooser 将对象写回 `deviceContext.object(s)` 与 `nodeContext.object(s)`
- 如果该 chooser 配置了固定 modifier，它会自动在当前节点下挂载 modifier 子工具

因此，modifier 的父节点必须是一个能把对象放进上下文的节点。chooser 正是这种 provider 节点之一。

## 为什么选择结果要进入 AOM

对象选择工具选中的不是“随便一组对象”，而是后续要进入动态编辑态的对象。

一旦对象被 `choose(...)` 放进 AOM：

- 它就处于动态图中
- 后续 modifier 只修改这类对象
- 只要对象仍未 `apply` 回静态图，就不应再被重复选择

这保证了选择、编辑、提交三段语义是一致的。

## 与 modifier 的关系

chooser 和 modifier 的关系是父子关系，而不是并列关系：

- chooser 是 provider 节点
- modifier 是真正执行几何修改的节点
- chooser 负责把对象放到上下文，并在需要时把信号继续转发给子 modifier

## 卸载清理

chooser 被 `umount` 时会执行清理：

- 如果当前仍有已选对象停留在 AOM 中，则调用 `AOM.discard(...)`
- 清空 `deviceContext` / `nodeContext` 中的对象引用
- 执行工具自身的 `reset()`

这使得选择工作流可以和设备树的卸载语义保持一致。

## 当前状态

- `ObjectChooserTool` 基类已支持 `process(...)`、上下文写回和 `umount()` 清理
- 基类已支持挂载固定 modifier 子工具
- 具体命中规则仍由子类实现 `choose(selectionContext)` 决定