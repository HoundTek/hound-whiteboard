# prefixContext（ctx）用法文档

## 概述

所有基于 `createPrefixNodeHandler` 构建的 handler，其 `handle(packet, ctx)` 签名的第二个参数 `ctx`（即 `prefixContext`）是一个**封装了节点状态读写和局部路由操作的共享上下文对象**。

它在 `handler.js` 中由 `createPrefixNodeHandler` 构造并注入，调用方无需自己管理状态初始化或手动构造返回包格式。

## ctx 可用成员

| 成员                             | 类型                              | 说明                                                      |
| -------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `ctx.path`                       | `string`                          | 当前节点的完整路径（如 `/mouse/primary/handoff`）         |
| `ctx.context`                    | `Object`                          | 沿 DAG 累积传递的上下文（board、monitor 等）              |
| `ctx.defaultChild`               | `string`                          | 当前节点的默认子节点名                                    |
| `ctx.dag`                        | `Object`                          | DevicesDAG 引用                                           |
| `ctx.state`                      | `Object`                          | 当前节点状态的**只读快照**（首次读取后合并 initialState） |
| `ctx.getState()`                 | `() => Object`                    | 读取最新节点状态（非快照）                                |
| `ctx.setState(nextState)`        | `(Object) => Object`              | 全量覆盖节点状态                                          |
| `ctx.patchState(partial)`        | `(Object) => Object`              | 浅合并更新节点状态                                        |
| `ctx.routeToChild(to, signals?)` | `(string, Array?) => { packets }` | 路由到子节点（见下方）                                    |
| `ctx.stop()`                     | `() => { packets: [] }`           | 终止当前链路，不发任何包                                  |

## 状态管理

### 读取状态

`ctx.state` 是惰性读取的快照——第一次访问时合并 `initialState` 与当前节点实际存储的状态。

```js
handle(packet, ctx) {
    const { anchor } = ctx.state;           // 读取快照
    const latest = ctx.getState();          // 读取最新状态
}
```

### 写入状态

```js
// 全量覆盖
ctx.setState({ anchor: { x: 100, y: 200 }, active: true });

// 浅合并（常用）
ctx.patchState({ anchor: null });
```

`patchState` 等价于：

```
nextState = { ...currentState, ...partial }
setState(nextState)
```

## 路由方法

### `ctx.routeToChild(to, signals?)`

将信号列表路由到指定的下游子节点。**这是向下转发信号的唯一规范方式**。

```js
// 转发当前位置信号到默认子节点
ctx.routeToChild(ctx.defaultChild || "", signals);

// 转发自定义信号到指定子节点
ctx.routeToChild("tool", [
  { type: "displacement", context: { value: { x: 5, y: 3 } } },
]);
```

**返回值**：`{ packets: [SignalPacket] }`，可直接作为 `handle()` 的返回值。

**若不传 `signals`**：默认使用当前输入信号包 `packet.signals`。

### `ctx.stop()`

终止当前链路，不向任何下游节点转发信号。

```js
// 消费信号，不转发
return ctx.stop();
```

**返回值**：`{ packets: [] }`。

### 典型用法模式

```
handle(packet, ctx) {
    // 1. 解析信号
    const positionSig = packet.signals.find(s => s?.type === "position");

    // 2. 不感兴趣 → 透传
    if (!positionSig) {
        return ctx.routeToChild(ctx.defaultChild || "", packet.signals);
    }

    // 3. 消费但不转发（如捕获锚点）
    if (someCondition) {
        ctx.patchState({ anchor: current });
        return ctx.stop();
    }

    // 4. 变换后转发
    return ctx.routeToChild(ctx.defaultChild || "", [
        { type: "displacement", context: { value: ... } },
    ]);
}
```

## 反模式（不建议）

### ❌ 手动构造返回包

```js
// 错误：不应手动构造 { to, signals } 或 [{ to, signals }]
return [
    { to: "tool", signals: [...] }
];

// 错误：不应手动构造 { packets: [...] }
return { packets: [new SignalPacket("tool", [...])] };
```

### ❌ 裸 return []

```js
// 错误：应使用 ctx.stop()
return [];
```

### ✔️ 正确用法

```js
// 转发 → ctx.routeToChild
return ctx.routeToChild("tool", signals);

// 终止 → ctx.stop
return ctx.stop();
```

## 为什么用 ctx 而不是祼构造

1. **封装内部格式**：`routeToChild` / `stop` 隐藏了返回值的内部结构（`{ packets }` vs `[{ to, signals }]`），未来若变更内部格式只需改 `handler.js` 一处。

2. **意图明确**：`ctx.stop()` 比 `return []` 表意更清晰。

3. **类型安全**：统一接口便于未来做 TypeScript 类型约束或参数校验。

## 适用边界

以上规范仅适用于通过 `createPrefixNodeHandler` 创建的 handler 内部的 `handle()` 函数。

以下情况的祼构造是**被允许的**：

- **非 createPrefixNodeHandler 环境**：如 `handoff-handler.js` 中的内部包装 handler，它直接挂载在 DAG 节点上，不走 `createPrefixNodeHandler`，有自己独立的返回值规整逻辑（`normalizeResultPackets`、`normalizeWrappedResult`）。
- **工具函数**：如 `normalizeResultPackets`、`shallowCloneSignals` 等工具函数内部，它们与 prefix 路由无关。
- **`multi-tool-handler.js` 的边界 case**：`!targetChild && transition.signals` 时需路由到空路径子节点，`routeToChild` 不接受空名，此时祼构造 `{ packets: [new SignalPacket("", transition.signals)] }` 是必需的。

## 相关文件

| 文件                     | 说明                                 |
| ------------------------ | ------------------------------------ |
| `handler.js`             | ctx 的定义与注入                     |
| `drag-anchor-handler.js` | 典型用法（状态管理 + 路由 + stop）   |
| `signal-log-handler.js`  | 最简用法（透传 + log）               |
| `repeator-handler.js`    | 多目标路由（flatMap + routeToChild） |
| `multi-tool-handler.js`  | 状态机路由 + context 传递            |
