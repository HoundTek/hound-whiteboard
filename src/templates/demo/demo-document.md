# Demo 文档

## 概述

`src/templates/demo` 提供 demo 配置，用于演示白板输入、工具挂载、信号路由和视口控制等核心流程。

## 已实现内容

### 1. 画笔创建

- 鼠标左键创建黑色画笔路径
- 鼠标右键创建红色画笔路径

这两个画笔工具分别挂载在 monitor 的鼠标主按键和次按键通道下。

### 2. 随机圆对象创建

- 按下 `Space` 键触发随机圆对象创建工具
- 工具会在当前视口范围内生成随机位置的圆对象
- 随机圆具有随机颜色和固定半径区间

### 3. WASD 坐标工具

- `W`, `A`, `S`, `D` 键映射到方向位移工具
- 每次按键累加位移并打印当前坐标
- 该工具用于演示输入信号与工具处理链路

### 4. 视口控制

- `Arrow` 键控制视口平移
- `Equal` / `NumpadAdd` 放大
- `Minus` / `NumpadSubtract` 缩小
- `KeyR` 刷新视口

这些按键由 `MonitorViewportTool` 或相关处理器执行视口变换。

### 5. 调试命令

- `KeyC`：打印 chunk 加载状态
- `KeyO`：打印 object 加载状态
- `KeyM`：打印 ActiveObjectManager 状态
- `KeyB`：打印 board 状态
- `Digit1`-`Digit4`：打印指定 chunk 详情

## 工具链验证点

该 demo 主要验证：

- 工具挂载与卸载流程
- 设备信号在 Monitor / DevicesTree 中的路由
- creator / modifier 传递对象上下文的能力
- 视口控制与渲染刷新
- 调试信息打印是否正常

## 当前说明

目前 demo 侧重于信号路由和工具挂载验证，已经符合当前工具体系的设计约定：

- 工具通过 `mount` 事件运行时挂载
- 设备节点负责把硬件输入转成语义信号
- creator / chooser 与 modifier 的上下文共享以 `deviceContext` / `nodeContext` 为边界
- handoff 模式下，creator 可在自身下方自动挂载固定 modifier 子工具
- modifier 通过 `apply` 信号把 AOM 中的对象提交回静态图
- 屏幕坐标应在 Monitor 层转换为世界坐标后进入工具链

如果需要进一步丰富 demo，可增加 creator -> modifier 同一路径的协同场景，以及更多工具状态打印。
