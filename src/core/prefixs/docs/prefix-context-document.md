# handler 上下文（ctx）用法文档

## 概述

所有 DevicesDAG handler 的 `handler(packet, ctx)` 签名的第二个参数 `ctx`，即 `DevicesDAGHandlerContext`，由 DAG 引擎在分发时通过 `_createHandlerContext` 统一构建。它包含**节点状态读写**和**路由操作**的标准 helper，所有 handler（包括 prefix、device、tool）拿到的都是同一套接口。

`createPrefixNodeHandler` 不额外注入 helper，只在 `ctx.state` / `ctx.getState()` 上叠加 `initialState` 作为默认值。

## ctx 可用成员

### 基本信息

| 成员 | 类型 | 说明 |
|------|------|------|
| `ctx.path` | `string` | 当前节点路径（如 `/mouse/primary`） |
| `ctx.dag` | `DevicesDAG` | 所属设备图实例 |
| `ctx.node` | `DevicesDAGNode` | 当前节点 |
| `ctx.semantics` | `Object` | 节点语义元数据快照 |
| `ctx.defaultRoute` | `string` | 当前节点默认出边名 |
| `ctx.depth` | `number` | 当前分发深度 |
| `ctx.signalPacket` | `SignalPacket` | 当前已规整的输入信号包 |

### 累积上下文

| 成员 | 类型 | 说明 |
|------|------|------|
| `ctx.context` | `Object` | 沿 DAG 累积的只读上下文（board、monitor、回调等） |

**规则**：handler 不能往 `ctx` 平级新增键。需要向下游传递额外数据时，通过返回值中的 `{ context: { ... } }` 写入累积上下文。

### 状态管理

| 成员 | 类型 | 说明 |
|------|------|------|
| `ctx.state` | `Object` | 当前节点状态快照。若走 `createPrefixNodeHandler`，已合并 `initialState` |
| `ctx.getState()` | `() => Object` | 重读节点最新状态 |
| `ctx.setState(nextState)` | `(Object) => Object` | 全量覆盖节点状态 |
| `ctx.patchState(partial)` | `(Object) => Object` | 浅合并 `{ ...current, ...partial }` |
| `ctx.getNodeState(pathOrId?)` | `(string\|number?) => Object` | 读取任意节点（默认为当前节点）状态 |
| `ctx.setNodeState(pathOrId, state)` | `(string\|number, Object) => Object` | 写入任意节点状态 |

### 路由操作

| 成员 | 类型 | 说明 |
|------|------|------|
| `ctx.routeToChild(to, signals?)` | `(string, Array?) => { packets }` | 路由到子节点 |
| `ctx.stop()` | `() => { packets: [] }` | 终止当前链路 |

## 状态管理

### 读取状态

```js
handler(packet, ctx) {
    const { anchor } = ctx.state;     // 读取快照
    const latest = ctx.getState();    // 读取最新状态
}
```

若 handler 通过 `createPrefixNodeHandler` 包装且提供了 `initialState`，则 `ctx.state` 和 `ctx.getState()` 会合并初始默认值：

```js
// initialState = { phase: "idle" }
// 节点实际 state = { anchor: { x: 10, y: 20 } }
ctx.state // { phase: "idle", anchor: { x: 10, y: 20 } }
```

写入时只写入实际值，不持久化初始默认值。

### 写入状态

```js
ctx.setState({ anchor: { x: 100, y: 200 }, active: true });  // 全量覆盖
ctx.patchState({ anchor: null });                              // 浅合并（常用）
```

## 路由方法

### `ctx.routeToChild(to, signals?)`

将信号列表路由到下游子节点。**这是向下转发信号的唯一规范方式**。

```js
// 透传当前信号到默认子节点
return ctx.routeToChild(ctx.defaultRoute || "", packet.signals);

// 转发变换后的信号
return ctx.routeToChild("tool", [
    { type: "displacement", context: { value: { x: 5, y: 3 } } },
]);
```

**返回值**：`{ packets: [SignalPacket] }`，可直接作为 handler 的返回值。

若不传 `signals`，默认使用当前输入 `signalPacket.signals`。

### `ctx.stop()`

终止当前链路，不向任何下游节点转发信号。

```js
// 消费信号，不转发
return ctx.stop();
```

## 典型用法模式

```js
handler(packet, ctx) {
    // 1. 不感兴趣 → 透传
    if (!interesting(packet)) {
        return ctx.routeToChild(ctx.defaultRoute || "", packet.signals);
    }

    // 2. 消费 + 状态写入（如捕获锚点）
    if (shouldCapture) {
        ctx.patchState({ anchor: current });
        return ctx.stop();
    }

    // 3. 状态机切换 + 路由
    ctx.setState({ phase: "next" });
    return ctx.routeToChild("tool", transformedSignals);
}
```

## 反模式

### ❌ 祼构造

```js
// 错误：手动构造返回对象
return [{ to: "tool", signals: [...] }];
return { packets: [new SignalPacket("tool", [...])] };
```

### ❌ 祼 return []

```js
// 错误：表意不清
return [];
```

### ❌ 往 ctx 平级新增键

```js
// 错误：ctx.object = foo;  ctx.foo = bar;
// 额外数据应走累积上下文：
return { context: { myKey: value }, packets: [...] };
```

### ✔️ 正确

```js
return ctx.routeToChild("tool", signals);   // 转发
return ctx.stop();                          // 终止
return { context: { ... }, packets: [...] };// 带累积上下文 + 路由
```

## createPrefixNodeHandler 的职责

`createPrefixNodeHandler` 的唯一作用是提供 `initialState` 默认值合并。它的 handler 直接拿到标准 DAG ctx，`ctx.state` / `ctx.getState()` 自动包含 `initialState` 的默认值。

```js
// 之前：handler.js 自己实现 state + routeToChild + stop
// 之后：handler.js 只做 initialState 合并，其余委托 DAG

createPrefixNodeHandler({
    initialState: { anchor: null },
    handle(packet, ctx) {
        // ctx.state = { anchor: null, ...实际状态 }
        // ctx.routeToChild / ctx.stop 来自 DAG
    },
});
```

## 适用边界

以上规范适用于**所有** DevicesDAG handler，包括：

- prefix handler（`drag-anchor`、`signal-log`、`multi-tool`、`repeator`）
- 设备根节点 handler（`mouse-device`、`keyboard-device`）
- 裸 handler（挂在 DAG 节点上的任意函数）

**不适用**：
- 纯工具函数（如 `normalizeResultPackets`、`shallowCloneSignals`）
- `multi-tool-handler.js` 中 `!targetChild && transition.signals` 的边界 case（`routeToChild` 不接受空子节点名，此处需祼构造）

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/core/devices-dag/dag.js` | ctx 的定义处（`_createHandlerContext`） |
| `src/core/prefixs/handler.js` | `createPrefixNodeHandler`：initialState 合并 |
| `src/core/prefixs/drag-anchor-handler.js` | 典型用法（状态 + 路由 + stop） |
| `src/core/prefixs/signal-log-handler.js` | 最简用法（透传 + routeToChild） |
| `src/core/prefixs/repeator-handler.js` | 多目标路由 |
| `src/core/prefixs/multi-tool-handler.js` | 状态机路由 |
| `src/core/docs/core-stable-interfaces.md` | 稳定接口清单 |
