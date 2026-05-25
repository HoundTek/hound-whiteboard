# Demo 文档

## 概述

当前 `src/templates/demo` 包含一个用于演示白板输入和工具交互的 demo 配置。它将鼠标、键盘等设备信号映射到多个工具，并提供可观察的视口、坐标、对象创建和调试功能。

## 已实现内容

### 1. 画笔创建

- 左键画笔：通过 `StrokeCreatorTool` 创建黑色画笔路径。
- 右键画笔：通过 `StrokeCreatorTool` 创建红色画笔路径。

这两个画笔工具分别挂载在 monitor 的鼠标主按键和次按键设备路径上。

### 2. 随机圆对象创建

- 按下 `Space` 键触发 `RandomCircleCreatorTool`。
- 工具会在当前视口可见范围内生成一个随机位置的圆对象。
- 随机圆具有随机描边颜色和固定半径区间。

### 3. WASD 坐标工具

- `W`, `A`, `S`, `D` 键通过键盘设备路由到 `WasdCoordinateTool`。
- 每次按键会累加一个方向位移并打印当前坐标。
- 该工具可作为 demo 中输入位置变化的示例处理器。

### 4. 视口控制

- `ArrowUp`、`ArrowDown`、`ArrowLeft`、`ArrowRight` 键控制视口平移。
- `Equal` / `NumpadAdd` 键执行缩放放大操作。
- `Minus` / `NumpadSubtract` 键执行缩放缩小操作。
- `KeyR` 键触发视口刷新（flush）。

这些按键通过 `MonitorViewportTool` 控制 monitor 的视口位置和缩放。

### 5. 调试命令

- `KeyC`：打印 chunk load 概览。
- `KeyO`：打印 object load 概览。
- `KeyM`：打印 ActiveObjectManager 状态。
- `KeyB`：打印 board 状态。
- `Digit1`、`Digit2`、`Digit3`、`Digit4`：打印指定 chunk 详情。

调试命令由 `DebuggerTool` 处理，用于观察当前 board / chunk / 对象加载与活动对象管理器状态。

## 配置函数

`configureWhiteboardDemo(board, monitor, options)` 是 demo 的入口：

- 必须传入 `board` 和 `monitor`。
- 会挂载鼠标、键盘设备和各类工具。
- 会将键盘按键映射到具体的工具路径。
- 返回 demo 中创建的工具实例对象集合。

## 当前适用场景

- 验证工具挂载与设备路由流程。
- 验证鼠标与键盘信号的处理链路。
- 验证 monitor 视口控制与刷新逻辑。
- 验证 board 调试信息打印是否正常。

## 备注

- 该 demo 主要面向核心工具和信号管线的快速验证，不包含完整 UI 交互指引。
- 如果需要补充，可在 `configureWhiteboardDemo` 中增加更多键盘快捷键和 demo 工具配置。