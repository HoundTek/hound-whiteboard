# 矩形框选工具文档

## 概述

`RectangleObjectChooserTool` 是基于拖拽矩形范围的对象选择工具。

它当前提供了一条可工作的 chooser 实现：

- 收到第一帧位置输入后开始记录框选起点
- 拖拽过程中持续更新矩形范围
- 抬起时按矩形范围选择对象
- 新一轮框选会替换上一轮选择

## BoardApi 双路径

与基类一致，`RectangleObjectChooserTool` 在 BoardApi 路径下通过 `addActiveObjects / discardActiveObjects` 管理生命周期：

| 操作     | BoardApi 路径                                  | Legacy 路径                                |
| -------- | ---------------------------------------------- | ------------------------------------------ |
| 选择对象 | `boardApi.addActiveObjects(objectIds)`         | `AOM.choose(new Set(objects))`             |
| 清空选择 | `boardApi.discardActiveObjects(previousIds)`   | `AOM.discard(new Set(previousObjects))`    |
| 对象来源 | `boardCore.objectLoaded` + `activeObjectIndex` | `board.objectLoaded` + `activeObjectIndex` |

`replaceSelection()` 方法在 BoardApi 路径下：

1. 先 `discardActiveObjects(previousIds)` 清空上一轮
2. 再 `addActiveObjects(nextIds)` 添加新一轮
3. 通过 `resolveSelectedObjectReferences()` 回填真实实例后写回上下文

## 当前选择语义

矩形框选工具：

- 从 `objectLoaded` 与 `activeObjectIndex` 汇总候选对象（BoardApi 路径下优先从 `boardApi.getBoardCore()` 读取）
- 通过基类的 `resolveObjectSelectionWorldRange()` 解析对象主判定范围对应的世界范围
- 用对象主判定范围与框选矩形做相交判断
- 把命中的对象通过 `replaceSelection()` 替换当前选择

它当前不使用 `boardApi.hitTest()`，因为 P2 保持同步兼容层。

## 与 UiRenderer 的关系

`RectangleObjectChooserTool` 除了继承基类的选择框 provider，还会额外声明拖拽中的矩形 overlay。

因此在 `uiCanvas` 上当前可以同时看到两类内容：

- 已经选中对象的兼容选择框
- 正在拖拽时的半透明矩形框选框

其中默认样式：

- 单对象选择框使用实线
- 多对象组合大矩形使用虚线
- 拖拽中的矩形框选框使用独立样式（半透明蓝色）

## 当前状态

- 已用于 demo 的 mouse secondary 工具
- 已支持空框选清空上一轮选择
- 已支持 BoardApi 双路径
- P2 读路径保持同步；P3 可引入 `hitTest` 做命中查询
