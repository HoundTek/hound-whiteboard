# 工具基类

## 概述

Tool 是设备图末端的消费型处理器，只做叶子节点。

### 职责边界

| 层面       | 做什么                                 | 谁做                 |
| ---------- | -------------------------------------- | -------------------- |
| 信号预处理 | 锚点、参数注入、局部路由、状态机       | 修饰节点             |
| 对象编排   | first → second 切换、对象桥接          | `HandoffWrapperTool` |
| 末端消费   | 创建对象、修改对象、选择对象、更新视口 | Tool                 |

### Tool 只做三件事

1. 接收信号：`process(signalPacket, deviceContext)`
2. 消费信号：修改白板对象或状态
3. 默认不继续转发：它不是新的路由层

编排职责已经上移到 prefix 层与 wrapper 层。新的稳定模型优先使用：

- 修饰节点路由（边级转换、参数注入）
- wrapper 组合（顺序流、互斥选择）
- 节点 `state`

仓库中仍有少量旧工具保留兼容型完成信号输出，但那不再是新的首选设计。

## 实例归属规则

一个 Tool 实例只属于一个设备图节点。

这保证了：

- hook `completeCreatedObject()` 这类包装操作不会污染其他链路
- 工具内部状态不会跨节点串扰
- `umount()` 时的清理边界明确

## 上下文模型

`Tool.createProcessor(toolContext)` 会生成一个可直接挂到 DevicesDAG 节点上的 handler。这个 handler 会把 `DevicesDAGHandlerContext` 规整成 `deviceContext`。

当前推荐直接依赖的顶层字段有：

- `path`
- `services`
- `getNodeState`
- `setNodeState`

这里的 `services` 来自 DevicesDAG 的声明式服务上下文，通常会携带：

- `board`（含 `allocateObjectId` 等方法）
- `boardApi`（RPC 代理）
- `viewport`

基础设施依赖（`board`、`boardApi`、`viewport`）统一通过 `context.services` 读取。

## 对象上下文辅助方法

Tool 现在提供一组围绕节点 `state` 的对象上下文工具：

- `resolveContextObjects(deviceContext)`
- `setContextObjects(deviceContext, objects)`
- `clearContextObjects(deviceContext)`
- `resolveObjectId(objectEntry)` — 从对象条目提取数字 id
- `resolveObjectIds(deviceContext, objects)` — 批量提取去重 id 列表
- `resolveNodeState(deviceContext, statePath)`
- `writeNodeState(deviceContext, nextState, statePath)`

这些方法的设计意图是：

- 优先复用当前节点 `state`
- 避免 creator、chooser、modifier 依赖同一个可变上下文对象
- 让父节点到子节点的共享变成显式路径状态同步

## 默认链路继续

`continueToDefaultPath(signalPacket, deviceContext)` 会在满足以下条件时返回一个新的相对转发包：

- 当前节点声明了 `defaultRoute`
- 已经解析出 `resolvedDefaultRoutePath`
- 对应子节点真实存在

如果条件不满足，则返回 `undefined`。

它适合那种“工具先消费一部分信号，再把同一包继续交给默认后继节点”的局部链路。

## 与 prefix 的边界

Tool 与 prefix 可以在同一条链路上协作，但边界不同：

- prefix 可以决定信号去哪个 child
- prefix 可以把一个输入包拆成多个下游包
- Tool 不负责维护子节点路由表
- Tool 不负责决定自己之上的状态机切换规则

当前随机圆 demo 已经采用这条分层：

- 前置 prefix 负责生成随机 `position`、`radius` 和颜色属性
- 参数 prefix 负责把随机参数改写为圆工具可消费的信号序列
- `CircleCreatorTool` 只负责消费这些稳定信号并创建对象

对应路径是：

- `/keyboard/code/Space/create-circle`
- `/keyboard/code/Space/create-circle/params`
- `/keyboard/code/Space/create-circle/params/tool`

## 挂载方式

当前推荐把工具作为 workflow 入口挂在 `/<viewportId>/workflows/` 下，再通过设备节点的出边连接过去，例如：

```js
viewport.mountWorkflow("/workflows/pointer", pointerTool);
viewport.mountWorkflow("/workflows/move", moveTool);

viewport.addEdge("/mouse/pointer", "tool", "/workflows/pointer");
viewport.addEdge("/keyboard/code/KeyW", "tool", "/workflows/move");
```

或直接对 DevicesDAG 调用：

```js
dag.mountWorkflow("/viewport/main/workflows/pointer", pointerTool, {
  board,
  viewport,
});
dag.addEdge(
  "/viewport/main/mouse/pointer",
  "tool",
  "/viewport/main/workflows/pointer",
);
```

`mountWorkflow()` 在挂载单个 Tool 时，内部会使用 `tool.createProcessor()` 作为 handler，并在卸载时调用 `tool.umount()`。

## 生命周期钩子系统

Tool 基类提供了一套发布-订阅式生命周期钩子，允许外部观察者（如 handoff 工作流）在不修改工具方法的前提下感知工具的关键生命周期事件。

### 钩子 API

| 方法                       | 用途                                  |
| -------------------------- | ------------------------------------- |
| `on(hookName, listener)`   | 注册钩子监听器，返回取消订阅函数      |
| `off(hookName, listener)`  | 取消注册                              |
| `_emit(hookName, ...args)` | 触发通知型钩子（protected，子类调用） |

### 设计原则

- **通知型钩子**通过 `_emit` 触发，不参与控制流
- **控制型钩子**是可覆盖的实例方法，返回 `bool` 决定流程是否继续
- 钩子名称约定为语义化字符串：`"afterCreate"`、`"afterApply"` 等

```js
// 注册监听
const unsub = tool.on("afterCreate", (interaction, obj) => {
  console.log("对象创建完成", obj);
});

// 取消监听
unsub();
```

### 当前预定义钩子

工具族的通知型钩子已统一为 namespace 格式，通过 `GestureTool` 的事件机制发布：

| 工具类型 | 控制型钩子（可覆盖）           | 通知型事件          |
| -------- | ------------------------------ | ------------------- |
| Creator  | `beforeCommitCreatedObject()`  | `"action:complete"` |
| Modifier | `beforeApplyModifiedObjects()` | `"action:complete"` |
| Chooser  | `beforeConfirmSelection()`     | `"action:complete"` |

此外，`GestureTool` 还提供手势层事件：`"gesture:begin"`、`"gesture:update"`、`"gesture:end"`、`"gesture:cancel"`。

控制型钩子返回 `false` 即阻止该生命周期步骤继续执行。

## 子类约定

自定义工具通常只需要实现：

- `static parse()`
- `serialize()`
- `process(signalPacket, deviceContext)`
- `reset()`

如果工具需要卸载清理，可覆盖 `umount(deviceContext)`，或依赖基类在 `umount` 时自动回调 `reset()`。

如果工具需要在 `uiCanvas` 上声明兼容 overlay，可额外覆写：

- `collectUiOverlayEntries({ deviceContext, viewport, renderer })`

该方法返回的条目会通过 viewport 上注册的 provider 交给 `UiRenderer`。

## 设计约束

- Tool 只消费稳定设备信号，不承担宿主事件规整
- Tool 不应再把 `button`、`buttons` 这类设备路由字段当作自己的主决策条件
- Tool 不拥有自己的图结构，路径归属始终来自 DevicesDAG
- 共享对象必须显式写入节点 `state`
- 工具节点路径应显式写到最终叶子，避免隐式挂载

## 当前状态

工具族已全面迁移到 `GestureTool` 与 `MultiGestureTool` 骨架。

详见 [gesture-tool-document.md](./gesture-tool-document.md)。

## 相关文档

- [手势工具基类](./gesture-tool-document.md)
- [wrapper（复合设备）](../wrapper/docs/wrapper-document.md)
- [设备图](../../docs/devices-dag-document.md)
- [Core 输入流](../../../../docs/core-input-flow.md)
- [阶段性稳定接口](../../../../docs/core-stable-interfaces.md)
