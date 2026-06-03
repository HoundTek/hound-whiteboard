# Demo 文档

## 概述

`src/templates/demo` 提供 demo 配置，用于演示白板输入、工具挂载、信号路由、视口控制和调试链路等核心流程。

当前 demo 的重点不是视觉包装，而是验证这次输入系统重构后的三条边界：

- 输入先归属到 Monitor，再进入 Board.devicesDAG
- 键盘与鼠标链路都通过显式叶子工具消费信号
- 参数注入、状态切换和对象桥接优先由修饰节点与节点 state 完成

## 已实现内容

### 1. 左键笔画创建

- 鼠标左键进入 `/mouse/primary/default` → `/workflows/primary-stroke`
- 末端工具为 `StrokeCreatorTool`
- 创建结果写入白板并参与渲染

### 2. 右键矩形框选

- 鼠标右键进入 `/mouse/secondary/default` → `/workflows/secondary-chooser`
- 末端工具为 `RectangleObjectChooserTool`
- 用于选择覆盖范围内的对象

### 3. 随机圆对象创建

- 按下 `Space` 键触发随机圆 workflow
- 键盘 code 节点默认走边 `"default"`，通过边级 prefix 转发 `trigger` 信号
- 第一层 prefix 在当前视口范围内生成随机 `position`、`radius` 与颜色属性
- 第二层 prefix 把参数改写为 `CircleCreatorTool` 可消费的信号序列
- 末端圆工具只负责消费稳定信号并提交圆对象

当前该 workflow 路径：

- `/workflows/create-circle/`（prefix 入口）
- `/workflows/create-circle/params`
- `/workflows/create-circle/params/tool`

### 4. WASD 坐标工具

- `W`、`A`、`S`、`D` 键通过各自边级 prefix 将 trigger 转为 position 信号
- 所有 prefix 汇聚到同一共享 workflow `/workflows/wasd-move`
- 每次按键累加位移并打印当前坐标

### 5. 视口控制

- `Arrow` 键控制视口平移
- `Equal` / `NumpadAdd` 放大
- `Minus` / `NumpadSubtract` 缩小
- `KeyR` 触发视口全屏刷新

每个视口控制键通过各自边级 prefix 将 trigger 转为 position / scale / flush 信号，
全部汇聚到共享 workflow `/workflows/viewport`。

### 6. 调试命令

- `KeyC`：打印 chunk 加载状态
- `KeyO`：打印 object 加载状态
- `KeyM`：打印 ActiveObjectManager 状态
- `KeyB`：打印 board 状态
- `KeyT`：打印 devices DAG 相关状态
- `Digit1`-`Digit4`：打印指定 chunk 详情

## 工具链验证点

该 demo 主要验证：

- 工具挂载与卸载流程
- 设备信号在 Monitor / DevicesDAG 中的逐层下传
- 边级 prefix 注入与信号转换
- append-only `context` 与节点 `state` 的协作边界
- 视口控制与渲染刷新
- 调试信息打印是否正常

## 当前说明

目前 demo 侧重于信号路由和 workflow 验证，已经符合当前工具体系的设计约定：

- 所有 workflow 通过 `mount` 事件统一挂载到 `/<monitorId>/workflows/` 下
- 随机圆 workflow 挂载到 `/workflows/create-circle`；`code/Space` 通过边级 prefix 接入
- 设备节点只负责信号产出（trigger / release / cancel）；信号转换由边级 `prefix` 完成
- 修饰节点（`createEdgePrefix`）插在设备节点与 workflow 之间的 `"default"` 边上
- creator / chooser 与 modifier 的上下文共享以当前节点 `state` 为边界，handoff 通过回调和对象桥接完成
- 视口、调试、WASD 各 workflow 通过 `edge.prefix` 多前驱模式汇聚
- 屏幕坐标在 Monitor 层转换为世界坐标后进入工具链

如果需要进一步丰富 demo，可继续增加更多 workflow 观测输出，以及 creator → modifier 同一路径的协同示例。
