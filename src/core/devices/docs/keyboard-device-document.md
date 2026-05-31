# 键盘设备

## 概述

键盘设备负责把宿主层已经确认归属到某个 Monitor 的键盘输入，翻译成 Core 内稳定的设备信号。

当前键盘设备根路径固定为 `/keyboard`，整体结构已经迁移到 `createSubDAG("/keyboard")` 模型。

## 节点结构

键盘设备默认挂出以下节点：

- `/keyboard`：根节点，更新 `activeKeys` 与 `lastEvent`，并把输入分流到子节点
- `/keyboard/event`：接收所有原始键盘事件
- `/keyboard/keydown`：接收非 repeat 的 `keydown`
- `/keyboard/keyup`：接收 `keyup` 或 `end`
- `/keyboard/repeat`：接收 repeat `keydown`
- `/keyboard/cancel`：接收 `cancel`
- `/keyboard/tools`：仍保留的公共工具域
- `/keyboard/code/<KeyCode>`：按具体 code 分出来的键位节点

在当前的设备图体系下，更推荐把键位级业务链路直接挂在 `code/<KeyCode>` 的后继，例如：

- `/keyboard/code/KeyW` → 通过 `wasd` 边 → `/keyboard/wasd-move`
- `/keyboard/code/Space/create-circle/params/tool`

对于需要多个键位汇聚到同一个 Tool 的场景（如 WASD 坐标），应使用 **DAG 多前驱模式**：每个键位节点各出一条边，指向同一个共享工具节点。

## 信号语义

键盘设备内部会把宿主事件规整为两层语义：

- 原始层：`keydown`、`keyup`、`cancel`、`end`
- 工具层：`trigger`、`release`、`cancel`

转换规则如下：

- `keydown` 且 `repeat === false` 时，生成 `trigger`
- `keyup` 或 `end` 时，生成 `release`
- `cancel` 时，生成 `cancel`
- repeat `keydown` 不生成工具层 `trigger`

这样工具侧不必直接关心浏览器或宿主的事件细节。

## 设备状态

键盘设备维护两份状态：

- `activeKeys`：当前仍处于按下状态的键集合快照
- `lastEvent`：最近一次处理过的键事件描述

设备定义通过 `expose()` 暴露：

- `resetState()`：清空内部状态
- `getState()`：返回可序列化快照

## 自定义节点配置

`createKeyboardDevice(options)` 支持通过 `nodeConfigs` 为某些路径补充 `handler` 或 `defaultChild`。

当前 `nodeConfigs` 的单项配置保留两类字段：

- `handler`
- `defaultChild`

典型用法：

```js
const keyboard = createKeyboardDevice({
  nodeConfigs: {
    "/code/KeyW": {
      handler(packet) {
        return {
          to: "tool",
          signals: packet.signals,
        };
      },
    },
  },
});
```

这里的 `packet.signals` 已经是 code 节点收到的稳定工具层信号，例如 `trigger`、`release`、`cancel`。

## ⚠️ 一个 Tool 实例只能挂载到一个节点

**不要将同一个 Tool 实例通过 `mountTool` 挂载到多个不同的 DAG 节点上。**

原因：

- Tool 实例内部持有可变状态（如 WASD 坐标工具的 `position`）
- 如果同一实例挂在多个节点上，每次信号到达都会修改这个共享状态
- 不同路径的信号会在彼此不知情的情况下覆盖对方的累积结果
- 卸载时也会导致问题（`unmount` 钩子只在第一个节点卸载时触发一次）

**正确做法**：创建一个共享节点，然后通过 `addEdge` 让多条路径汇聚到它：

```js
// ✅ 正确：一个 Tool 实例 → 一个共享节点
monitor.mountTool("/keyboard/wasd-move", wasdTool);

// 多条路径通过同名边汇聚到共享节点
monitor.addEdge("/keyboard/code/KeyW", "wasd", "/keyboard/wasd-move");
monitor.addEdge("/keyboard/code/KeyA", "wasd", "/keyboard/wasd-move");
monitor.addEdge("/keyboard/code/KeyS", "wasd", "/keyboard/wasd-move");
monitor.addEdge("/keyboard/code/KeyD", "wasd", "/keyboard/wasd-move");
```

```js
// ❌ 错误：同一个 Tool 实例挂在多个节点上
for (const code of ["KeyW", "KeyA", "KeyS", "KeyD"]) {
  monitor.mountTool(`/keyboard/code/${code}/tool`, wasdTool); // 禁止！
}
```

## 推荐挂载方式

键盘设备本身应挂在 Monitor 边界下：

```js
monitor.mountSubDAG("", createKeyboardDevice());
```

单键位工具直接挂在对应 code 节点下：

```js
monitor.mountTool("/keyboard/code/Space/create-circle/params/tool", circleTool);
```

多键位汇聚工具推荐 DAG 多前驱模式：

```js
// 1. 挂载工具到共享节点（一次）
monitor.mountTool("/keyboard/wasd-move", wasdTool);

// 2. 每个键位添加同名边指向共享节点
monitor.addEdge("/keyboard/code/KeyW", "wasd", "/keyboard/wasd-move");

// 3. 键位 handler 返回该边名即可
// handler: return { to: "wasd", signals: [...] }
```

## 设计要点

- Monitor 是键盘设备的归属边界
- 键盘设备只处理已经确定属于当前 Monitor 的输入
- 根节点负责更新设备状态并生成分流目标
- code 节点负责做键位级路由，复杂交互优先继续下传到它自己的后代
- 需要跨多个键位复用同一个 Tool 时，使用 **DAG 多前驱模式**（`addEdge` → 共享节点），而不是把同一实例挂在多个节点上
- 💡 `addEdge` 支持多对一汇聚，这是 DAG 的核心能力

## 相关文档

- [设备定义](./device-document.md)
- [设备图](./devices-dag-document.md)
- [Core 输入编码](../../docs/core-input-encoding.md)
