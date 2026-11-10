# Demo 文档

## 概述

`src/demo/config` 提供 demo 配置，用于演示白板输入、工具挂载、信号路由、视口控制和调试链路等核心流程。

当前 demo 的重点不是视觉包装，而是验证这次输入系统重构后的三条边界：

- 输入先归属到 Viewport，再进入 Board.devicesDAG
- 键盘与鼠标链路都通过显式叶子工具消费信号
- 参数注入由修饰节点完成，顺序/互斥组合与对象桥接由 wrapper 完成

## 已实现内容

### 左键工具切换

- 鼠标左键进入 `/mouse/primary/default` → `/workflows/tool-switcher`
- tool-switcher 是单个 `ToolSwitcherWrapper` 实例，根据当前激活工具名称把信号转发到内部对应槽位
- 六个可选工具（均为 wrapper 内部槽位）：
  - **笔画**（`StrokeCreatorTool`）
  - **圆**（`CircleDataCreatorTool` + 圆心半径 processor）
  - **直径圆**（`CircleDataCreatorTool` + 直径 processor）
  - **椭圆**（`EllipseDataCreatorTool` + 外接矩形 processor，创建独立的 `EllipseObject`）
  - **选择+修改**（`HandoffWrapperTool`：`RectangleObjectChooserTool` → `CommonObjectModifierTool`）
  - **橡皮**（`DataObjectEraserTool`，FD 数据擦除，擦除笔画）
- 通过工具栏按钮（`.toolbar-btn`）或数字键 `1`-`9` 切换激活工具
- 按钮 `pointerdown` 事件发出 `button-press` 信号 → `toolbar/button-group` 设备 → 输出 `tool-switch` 信号，双输入汇聚到 tool-switcher 节点
- 数字键（keydown，非 repeat）经 `switchTool` 写入 `board.sharedState` 后，把 tool-switch 信号直接 emit 到 tool-switcher；该键信号同时正常流入 keyboard 设备
- 两条切换路径共用 `switchTool` 完成「校验 + 写 sharedState」，`board.sharedState`（键 `activeTool`）是唯一事实源，工具栏适配器订阅该键更新 DOM 按钮 `.active` 类，DOM 高亮自动联动
- 默认激活工具为笔画

### 触摸多指笔画

- 触摸事件（`touchstart`/`touchmove`/`touchend`/`touchcancel`）从 DOM canvas 捕获，`emitTouchPacket` 将每个 `changedTouch` 转为 `position`/`end`/`cancel` 信号
- 信号发送到 `/touchscreen`，touchscreen device 在 `rootHandler` 中完成 canvas→world 坐标转换后更新内部触点状态
- 每帧聚合输出一条 `touch-contacts` 信号到 `touchscreen/contacts`
- `MultiToolWrapper(StrokeCreatorTool)` 挂载在 `/workflows/touch-stroke`，edge 来自 `touchscreen/contacts`
- wrapper 为每个 `touchId` 创建一个独立 `StrokeCreatorTool` 实例，各自维护独立的 `isGestureActive`、`objectId` 和路径点列
- 多指同时拖动时各笔画互不干扰，同时落笔并行绘制
- 坐标转换：在 touchscreen device 内通过 `viewport.convertCanvasSignalsToWorld()` 完成，与 mouse device 共用同一方法

### 右键矩形框选

- 鼠标右键进入 `/mouse/secondary/default` → `/workflows/secondary-chooser`
- 末端工具为 `RectangleObjectChooserTool`
- 用于选择覆盖范围内的对象
- 框选完成后进入 handoff modifier 阶段，再次拖拽修改对象位置

### 随机圆对象创建

- 按下 `Space` 键触发随机圆 workflow
- 键盘 code 节点默认走边 `"default"`，通过边级 prefix 转发 `trigger` 信号
- 第一层 prefix 在当前视口范围内生成随机 `position`、`radius` 与颜色属性
- 第二层 prefix 把参数改写为 `CircleDataCreatorTool` 可消费的信号序列
- 末端圆工具只负责消费稳定信号并提交圆对象

当前该 workflow 路径：

- `/workflows/create-circle/`（prefix 入口）
- `/workflows/create-circle/params`
- `/workflows/create-circle/params/tool`

### Enter / Escape — 全局 modifier 确认/取消

- Enter 发 `success` 信号、Escape 发 `cancel` 信号
- 信号同时到达两条路径：
  - 键盘设备 → `code/Enter` / `code/Escape` → secondary-chooser（右键 handoff）
  - 直接 emit → `/workflows/tool-switcher` → 经 wrapper 转发到当前激活槽位（左键 handoff 也响应）
- 各 handoff 按当前 phase 路由：phase=first（chooser）忽略，phase=second（modifier）提交/丢弃修改

### WASD 位移 → handoff modifier

- `W`、`A`、`S`、`D` 键通过各自边级 prefix 将 trigger / trigger-repeat 转为 displacement 信号
- displacement 信号作为边级 prefix 注入到 handoff 工作流（`/workflows/secondary-chooser`）
- 当 handoff 处于 modifier 阶段时，displacement 信号由 GestureBasedObjectModifierTool 消费，无状态累加到选中对象位置
- 锚点跟随位移同步，后续鼠标拖拽不产生跳跃
- 长按触发系统 repeat 时，键盘设备发出 `trigger-repeat` 信号，WASD prefix 同样转为 displacement 持续移动对象

### 视口控制

- `Arrow` 键控制视口平移
- `Equal` / `NumpadAdd` 放大
- `Minus` / `NumpadSubtract` 缩小
- `KeyR` 触发视口全屏刷新

每个视口控制键通过各自边级 prefix 将 trigger 转为 position / scale / flush 信号，
全部汇聚到共享 workflow `/workflows/viewport`。

### 调试命令

- `KeyC` → `debug:chunkload`：打印 chunk 加载计数
- `Shift+C` → `debug:chunkdetails`（`ctx.ids`）：打印指定区块静态图，不传 ids 则输出全部
- `KeyO` → `debug:objectload`：打印 object 加载计数
- `Shift+O` → `debug:objectdetails`（`ctx.ids` / `ctx.chunks`）：打印指定对象详情，不传则输出全部
- `KeyM` → `debug:viewport`：打印视口摘要
- `KeyB` → `debug:board`：打印 board 摘要（Worker 侧）
- `Shift+B` → `debug:aom`：打印 ActiveObjectManager 分层状态
- `KeyT` → `debug:devices`（`ctx.mode="tree"`）：打印设备 DAG 树状结构
- `Shift+T` → `debug:devices`（`ctx.mode="mermaid"`）：打印 Mermaid 流程图

`Shift+T` 输出的 Mermaid 可直接粘贴查看，形如：

```mermaid
flowchart TD
  K("keyboard #1 [handler]") -->|"code"| Sp("code/Space #2 →default")
  M("mouse #3 [handler]") -->|"primary"| MP("primary #4 →default")
  Sp -->|"default"| P1[["Space/ #5 [prefix]"]]
  P1 -->|"default"| RC("/workflows/create-circle #6 [prefix]")
  MP -->|"default"| TS("/workflows/tool-switcher #7 [wrapper]")
```

## Web 模式（浏览器直连）

demo 可脱离 Tauri 在纯浏览器中运行，用于双开联调同步链路：

```bash
yarn relay      # 启动同步中继（ws）
yarn demo:web   # 静态伺服 src/demo，浏览器打开 whiteboard.html
```

连接参数按 URL 参数优先、localStorage 回退解析（`whiteboard.js`）：

| 参数       | URL        | localStorage 键 | 作用                                                       |
| ---------- | ---------- | --------------- | ---------------------------------------------------------- |
| 中继地址   | `?relay=`  | `hwb-relay`     | 同步中继 ws 地址（双开时第二窗口用 localStorage 设不同值） |
| 身份       | `?source=` | `hwb-source`    | 本端 idSource（同机双开需不同身份）                        |
| 板副本路径 | `?board=`  | `hwb-board`     | 板目录（双开时各自持久化副本；web 下失效）                 |

无 Tauri 环境（纯浏览器）无文件系统能力，自动降级为内存板 + relay 同步，落盘由持板 daemon 承担（relay 来源的记录由 daemon 落盘），`?board=` 随之失效。

Tauri 桌面端默认板目录为 `~/hound-whiteboard/demo-board`（首次运行自动创建）。持久化开板失败（目录不可创建、daemon 拉起超时等）时回退内存模式重试（`enable-worker-with-fallback.js`）：板面功能照常，数据仅存续于本会话。

## 同步控制台

`sync-console.js` 在页面加载时安装 `window.hwb` 控制台命令（`hwb.help()` 打印全部用法）：

- 同步配置：`hwb.setRelay(url)` / `hwb.setSource(source)` / `hwb.setBoard(board)`（设置后自动刷新）、`hwb.status()`（只读打印）、`hwb.off()`（清除回离线）
- 操作：`hwb.undo()` / `hwb.redo()`（经 BoardApi，完成后广播 hit 变更清理失效选中）
- 同步调试：`hwb.digest()`（stateHash / chainHash / openMols 摘要）、`hwb.tree()`（queryUndoTree 树结构）、`hwb.repair()`（手动 repairStateFromLog）、`hwb.reconnect()`（关闭并重建全部同步通道）
- 调试查询（与调试工具同能力，Worker 侧输出）：`hwb.chunkLoad()` / `hwb.chunks(ids?)` / `hwb.objectLoad()` / `hwb.objects(ids?, chunks?)` / `hwb.aom()` / `hwb.hit()` / `hwb.board()`；UI 侧直接打印：`hwb.viewport(ids?)` / `hwb.devices(mode?)`（`"mermaid"` 输出 Mermaid）

前三项设置后自动刷新页面生效。

## 协作感知装饰（AwarenessOverlay）

`AwarenessOverlay`（`ui/components/renderer/awareness-overlay.js`）提供远程协作的只画不存装饰层：

- 远程命名选择的按来源着色框与来源标签（经 `queryRemoteChoices` 拉取，worker 的 awareness 消息驱动刷新）
- 远程光标（本端 pointermove 节流上报，远程光标无更新超时消失）
- 远程手势中间帧预览（对象 id → 预览状态，peer-left 按来源清理）

远程文档变化经 `viewport.addAwarenessListener` 广播 `hit:changed` 信号到 tool-switcher 与 secondary-chooser，让工具清理失效选中（幽灵选择）。

## 撤销 / 重做按钮

工具栏的「撤销」「重做」按钮（`#undo-btn` / `#redo-btn`）由 `attachHistoryAdapter` 绑定：直接经 BoardApi 调用 `undo()` / `redo()`，不进入设备图；完成后向 tool-switcher 与 secondary-chooser 广播 `hit:changed` 信号，让工具按内核对齐本地条目。

## 删除选中对象

「操作」区的「删除」按钮（`#delete-btn`）由 `attachDeleteAdapter` 绑定：向 tool-switcher workflow 发送框架级 `delete` 信号，信号经 switcher 路由到当前激活工具——仅当切到「选择+修改」handoff 且 modifier 持有对象时生效。键盘 `Delete` / `Backspace` 则经 `secondary-handoff.js` 的边级 prefix（trigger → delete）发给右键 handoff workflow。两侧最终都由对象修改工具（`GestureBasedObjectModifierTool`）消费：经 `boardApi.deleteObjects` 删除持有对象（删除记录进入 handoff 会话 supra，可整体撤销），随后完成动作让 wrapper 复位相位。

## Worker 模式面板

demo 固定以 Worker 模式运行（`board.enableWorkerMode(worker)`），右侧面板由 `DemoLog` 输出运行状态：运行模式（Worker）、左键/右键/空格工具说明、视口快捷键与视口状态快照。

## 快捷键一览

| 按键          | 功能                                                |
| ------------- | --------------------------------------------------- |
| 触摸拖动      | 多指同时创建红色笔画（每指独立）                    |
| 鼠标左键      | 当前激活工具（笔画 / 圆 / 直径圆 / 椭圆 / 选择+修改 / 橡皮） |
| 1 - 9         | 切换激活工具（按工具栏顺序）                        |
| 橡皮（左键）  | 拖动擦除笔画（工具栏/数字键切换到橡皮后）           |
| 鼠标右键      | 首次框选对象 → 再次拖拽修改                         |
| Enter         | 提交修改（右键 handoff + 左键选择工具）             |
| Esc           | 取消修改（右键 handoff + 左键选择工具）             |
| Delete / Backspace | 删除选中对象（右键 handoff）                   |
| W / A / S / D | 移动选中对象（右键激活后）                          |
| ↑ / ↓ / ← / → | 平移视口                                            |
| + / −         | 放大 / 缩小视口                                     |
| R             | 刷新视口渲染                                        |
| Space         | 随机生成圆形                                        |
| C             | 调试：chunk 加载计数                                |
| Shift + C     | 调试：已加载区块静态图                              |
| O             | 调试：object 加载计数                               |
| Shift + O     | 调试：已加载对象完整摘要                            |
| M             | 调试：视口摘要                                      |
| B             | 调试：board 摘要                                    |
| Shift + B     | 调试：Active Object Manager 分层状态                |
| T             | 调试：设备 DAG（树状）                              |
| Shift + T     | 调试：设备 DAG（Mermaid 流程图）                    |

## 工具链验证点

该 demo 主要验证：

- 工具挂载流程
- 设备信号在 Viewport / DevicesDAG 中的逐层下传
- 边级 prefix 注入与信号转换
- append-only `context` 与节点 `state` 的协作边界
- 视口控制与渲染刷新
- 触摸输入信号转触点聚合状态（touchscreen device）
- 多工具并发包装器（`MultiToolWrapper`）为每指创建独立工具实例
- 调试信息打印是否正常

## 当前说明

目前 demo 侧重于信号路由和 workflow 验证，已经符合当前工具体系的设计约定：

- 所有 workflow 通过 `mount` 事件统一挂载到 `/<viewportId>/workflows/` 下
- 随机圆 workflow 挂载到 `/workflows/create-circle`；`code/Space` 通过边级 prefix 接入
- 设备节点只负责信号产出（trigger / release / cancel）；信号转换由边级 `prefix` 完成
- 修饰节点（`createEdgePrefix`）插在设备节点与 workflow 之间的 `"default"` 边上
- creator / chooser 与 modifier 的上下文共享以工具的私有字段为权威来源，`HandoffWrapperTool` 通过 `action:complete` 订阅和对象桥接完成两阶段流转
- 视口、调试各 workflow 通过 `edge.prefix` 多前驱模式汇聚；WASD 通过 `edge.prefix` 注入到 handoff 工作流
- 触摸设备通过 `viewport.convertCanvasSignalsToWorld()` 完成 canvas→world 坐标转换

## 相关文档

- [Core 输入流](../../../docs/core-input-flow.md)
- [设备图](../../../ui/devices-dag/docs/devices-dag-document.md)
- [多工具并发包装器](../../../ui/devices-dag/tools/wrapper/docs/multi-tool-wrapper-document.md)
- [同步层](../../../host/sync/docs/sync-document.md)
