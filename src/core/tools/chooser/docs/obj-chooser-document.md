# 对象选择工具文档

## 概述

对象选择工具负责从白板静态图中提取对象，并把它们加入 AOM 动态图，作为后续 modifier 的输入来源。

它不是直接修改对象的工具，而是“把哪些对象送进动态编辑态”的入口。

## 核心语义

- chooser 从静态图中命中对象
- chooser 调用 AOM.choose(...) 把这些对象加入动态图
- chooser 通过 setContextObjects() 把对象写回当前节点上下文
- chooser 通过 syncModifierContext() 把对象显式写入下游 modifier 节点 state
- 如果该 chooser 配置了固定 modifier，它会自动在当前节点下挂载 modifier 子工具

因此，modifier 的父节点必须是一个能把对象放进上下文的节点。chooser 正是这种 provider 节点之一。

## 为什么选择结果要进入 AOM

对象选择工具选中的不是“随便一组对象”，而是后续要进入动态编辑态的对象。

一旦对象被 choose(...) 放进 AOM：

- 它就处于动态图中
- 后续 modifier 只修改这类对象
- 只要对象仍未 apply 回静态图，就不应再被重复选择

这保证了选择、编辑、提交三段语义是一致的。

## 与 modifier 的关系

chooser 和 modifier 的关系是父子关系，而不是并列关系：

- chooser 是 provider 节点
- modifier 是真正执行几何修改的节点
- chooser 负责把对象放到当前节点与子工具路径 state 中，并在需要时把信号继续转发给子 modifier

当 modifier 已存在时，chooser 会复用当前上下文对象并通过 continueToDefaultPath() 把输入继续送下去。

## 命中范围约束

对象选择工具在判断“对象是否命中 / 是否应被框选”时，应统一以对象的主判定范围 `getRange()` 为准，而不是直接使用 `boundingBox`。

这意味着：

- `boundingBox` 可以继续服务于局部刷新、快速裁剪等场景
- 但 chooser 的命中和框选语义应优先尊重对象真正的主判定范围
- 当前基类已提供主判定范围到世界空间的辅助解析接口，供子类复用

## 与兼容 ui 选择框的关系

当前 chooser 基类会自己声明兼容选择框 provider，并默认从 chooser 节点当前 state 中读取 `object/objects`。

这意味着：

- 当当前工具仍是 chooser 时，选择框会显示在这些对象各自的矩形范围上
- 若当前是多对象选择，除了各自矩形框，还会显示这些矩形的最小外接大矩形
- 若 chooser 已切到下游 modifier，则兼容层会优先采用 modifier 节点状态，避免 chooser 和 modifier 两套框重复绘制
- 若某个 chooser 子类还需要自己的交互 overlay，例如矩形框选拖拽框，它可以在自己的 provider 条目里继续补充

这里依旧只是兼容方案，不代表 chooser 节点 state 就是未来 overlay 系统的最终协议；当前只是 chooser 自己先把这份上下文声明给 `UiRenderer`。

## 卸载清理

chooser 被 umount 时会执行清理：

- 如果当前仍有已选对象停留在 AOM 中，则调用 AOM.discard(...)
- 清空当前节点上下文中的对象引用
- 执行工具自身的 reset()

这使得选择工作流可以和设备树的卸载语义保持一致。

## 当前状态

- ObjectChooserTool 基类已支持 process(...)、上下文写回和 umount() 清理
- 基类已支持挂载固定 modifier 子工具
- 具体命中规则仍由子类实现 choose(selectionContext) 决定
