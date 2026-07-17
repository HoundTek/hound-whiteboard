# Core 输入流

## 概述

当前 Core 输入系统已经收敛为一条**白板级单 DAG 链路**：`Board` 持有唯一的 `DevicesDAG`，`Viewport` 只负责把设备子图、workflow 和边关系挂到这张图上。

输入在 Core 内的最短路径是：

- 宿主识别目标 `Viewport`
- 宿主把原始输入编码为 `SignalPacket`
- `Board.signalsEventBus.emit("input", packet)`
- `Board.devicesDAG.dispatch()` 从根节点逐段向下路由
- device 节点规整输入
- prefix 节点执行参数注入、状态机、handoff 或局部路由
- tool 叶子消费最终信号

本文涉及的线程边界见 [core-runtime-boundaries.md](./core-runtime-boundaries.md)。

## 关系图

```mermaid
flowchart LR
    Host[Host Input] --> Bus[Board.signalsEventBus]
    Bus --> DAG[Board.devicesDAG]
    DAG --> ViewportRoot[/viewportId]
    ViewportRoot --> Device[Device SubDAG]
    Device --> Prefix[Prefix / Handoff]
    Prefix --> Tool[Tool Leaf]
    Tool --> RPC[BoardApiRpc / Viewport]
```

## 当前主链路

### 1. 宿主编码输入

宿主先完成两件事：

- 判断输入属于哪个 viewport
- 决定当前输入应该进入哪个设备路径

只有完成这一步后，输入才会以 `SignalPacket` 进入 Core。

最小形态：

```js
{
  to: "/viewport-id/mouse",
  signals: [
    {
      type: "position",
      context: {
        value: { x: 10, y: 20 },
      },
    },
  ],
}
```

### 2. `Board` 作为唯一 DAG 入口

`Board.signalsEventBus` 当前处理一类输入相关事件：

- `input`

其中 `input` 的稳定语义是：

1. 从 `to` 中解析 `viewportId`
2. 找到对应 `Viewport`
3. 调用 `devicesDAG.dispatch(packet, { board, boardApi })`

`Board` 自己不做设备语义判断，只负责把已经归属的信号送进唯一的白板级设备图。

### 3. viewport 根节点声明 services

`Board.createViewport()` 会为 `/${viewportId}` 配置节点，通过 `services` 声明式注入基础设施：

```
configureNode("/${viewportId}", {
  services: { board, boardApi, viewport },
  semantics: { viewport: true },
})
```

因此下游设备、prefix、tool 都能从 `ctx.services` 中读取：

- `board`（含 `allocateObjectId` 等方法）
- `boardApi`（RPC 代理）
- `viewport`

### 4. 设备阶段

设备以 `SubDAGDefinition` 的形式挂在某个 viewport 子树下，例如：

- `viewport.mountSubDAG("/mouse", createMouseDevice())`
- `viewport.mountSubDAG("/keyboard", createKeyboardDevice())`
- `viewport.mountSubDAG("/touchscreen", createTouchscreenDevice())`

设备的职责是：

- 维护设备级状态，如 `activeKeys`、按钮状态、多触点状态
- 把宿主原始输入规整成稳定设备信号
- 决定信号应进入哪个设备子节点

当前常见的设备层信号包括：

- mouse：`position`、`end`、按钮分流后的 primary / secondary 路径
- keyboard：从原始 `keydown` / `keyup` 规整为 `trigger` / `trigger-repeat` / `release` / `cancel`
- touchscreen：多触点摘要或 contact 类信号

### 5. prefix / handoff 阶段

prefix 是链路中的前置处理层。当前主要承担：

- 记录或观察信号
- 生成派生参数
- 改写信号形态
- 维护局部状态机
- 在多个子节点之间切换活动链路
- 将动态路由参数通过 `ctx.acc` 传给下游，只读基础设施通过 `ctx.services` 共享

`handoff-handler` 则负责 chooser → modifier 这类两阶段工作流的控制权转移。

### 6. tool 阶段

Tool 是设备图末端的消费型处理器，只负责：

- 接收稳定设备信号
- 修改白板对象、视口或局部状态
- 需要时通过 `BoardApiRpc` 读写 Worker 权威数据

当前创建、选择、修改类工具都遵循这个模型。

## Viewport 与挂载边界

### `Board` 负责

- 拥有唯一 `DevicesDAG`
- 监听 `input`
- 将 `{ board, boardApi }` 作为 dispatch 初始上下文
- 为 `/${viewportId}` 节点补上 `viewport`

### `Viewport` 负责

- 作为挂载代理，把子图和 workflow 注册到白板级 DAG
- 提供 `mountSubDAG()` / `mountWorkflow()` / `unmountWorkflow()` / `addEdge()` 等便捷入口
- 不再持有独立设备图实例

## workflow 挂载约定

当前项目中的主约定是：

- workflow 统一挂到 `/<viewportId>/workflows/` 下
- 设备节点通过 `addEdge` 与 workflow 入口连接
- 如需前置转换，可在边上注入 `edge.prefix`

例如 demo 中常见的路径：

- `/<viewportId>/workflows/primary-stroke`
- `/<viewportId>/workflows/secondary-chooser`
- `/<viewportId>/workflows/random-circle`
- `/<viewportId>/workflows/viewport`

需要注意：

- 这是 **Board / Viewport 层的推荐约定**
- `DevicesDAG.mountWorkflow(path, workflow)` 本身并不强制要求必须使用 `/workflows/`

## 状态与上下文约定

### `ctx.services` — 静态服务上下文

`ctx.services` 是沿 DAG 路径由节点声明式注入的基础设施依赖，handler 只读不可写。

适合放：

- `board`（含 `allocateObjectId` 等方法）
- `boardApi`（RPC 代理）
- `viewport`

### `ctx.acc` — 累积上下文

`ctx.acc` 是沿命中路径由上游 handler 返回值逐层追加的运行时控制参数。

适合放：

- `autoCommit`（handoff prefix 注入，控制是否提交）
- `autoUmountOnApply`（handoff prefix 注入，控制是否自卸载）
- `objectId`（创建工具链路传递）
- `objects`（handoff 对象桥接）
- 一次性回调

> `ctx.acc` 不包含 `services` 中的静态基础设施依赖；基础设施请通过 `ctx.services` 读取。

### 节点 `state`

节点 `state` 适合放：

- 锚点
- 状态机相位
- 活动 child
- 需要被测试或调试读取的局部可变数据

### 当前约束

- `services` 由节点定义注入，handler 返回值无法写入
- `acc` 只能追加，不应覆盖已有键
- 跨节点可变共享优先走 `state`
- Tool 不应承担 prefix 的路由职责
- 路由始终逐层向下，不支持向上冒泡到兄弟节点

## 当前实践中的两个重点

### modifier 双通道

当前修改工具链允许同一帧同时处理：

- `position`：绝对坐标，驱动手势状态机
- `displacement`：相对位移，做无状态增量更新

这是 modifier 交互的重要约束，测试与文档都应按这个模型理解。

### workflow 通过边连接设备叶子

当前推荐做法不是把业务逻辑写回设备内部，而是：

1. 设备只负责产出稳定信号
2. workflow 作为独立入口挂在 `/<viewportId>/workflows/`
3. 设备叶子通过边把信号引到 workflow
4. 需要时用 prefix 做边级转换

## 相关文档

- [设备图](../ui-thread/devices-dag/docs/devices-dag-document.md)
- [设备定义](../ui-thread/devices-dag/devices/docs/device-document.md)
- [对象创建工具](../ui-thread/devices-dag/tools/creator/docs/object-creator-document.md)
- [对象选择工具](../ui-thread/devices-dag/tools/chooser/docs/object-chooser-document.md)
- [对象修改工具](../ui-thread/devices-dag/tools/modifier/docs/object-modifier-document.md)
- [阶段性稳定接口](./core-stable-interfaces.md)
