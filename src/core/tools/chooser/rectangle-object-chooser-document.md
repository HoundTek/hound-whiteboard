# 矩形框选工具文档

## 概述

`RectangleObjectChooserTool` 是一个简单的拖拽矩形框选工具。

它的目标不是定义最终的高性能框选协议，而是先提供一条可工作的 chooser 实现：

- 收到第一帧位置输入后开始记录框选起点
- 拖拽过程中持续更新矩形范围
- 抬起时按矩形范围选择对象
- 新一轮框选会替换上一轮选择

## 当前选择语义

当前实现里，矩形框选工具会：

- 从 `Board.objectLoaded` 与 `ActiveObjectManager.activeObjectIndex` 汇总候选对象
- 通过 chooser 基类的辅助方法解析对象主判定范围 `getRange()` 对应的世界范围
- 用对象主判定范围与框选矩形做相交判断
- 把命中的对象交给 `AOM.choose(...)`

这意味着它当前不再使用对象的包围盒作为框选命中依据。

它还不是：

- 基于几何轮廓的精细命中
- 基于区块索引的高性能大范围筛选
- 最终版宿主 UI 框选协议

## 与 UiRenderer 的关系

`RectangleObjectChooserTool` 除了继承 chooser 基类已有的选择框 provider，还会额外声明一层拖拽中的矩形 overlay。

因此在 `uiCanvas` 上，当前可以同时看到两类内容：

- 已经选中对象的兼容选择框
- 正在拖拽时的半透明矩形框选框

其中默认样式当前约定为：

- 单对象选择框使用实线
- 多对象组合大矩形使用虚线
- 拖拽中的矩形框选框继续使用独立的拖拽样式

这里仍然遵循当前兼容层边界：

- 由工具主动声明自己要画什么
- `UiRenderer` 只消费 provider 条目并负责统一补绘

## 当前状态

- 已用于 demo 的 mouse secondary 工具，替换了原先的 secondary stroke tool
- 已支持空框选清空上一轮选择
- 已补工具级测试与 demo 接入测试

后续若需要更复杂的命中规则，应优先增强工具自己的筛选策略，而不是把这套选择逻辑重新塞回 `UiRenderer`。