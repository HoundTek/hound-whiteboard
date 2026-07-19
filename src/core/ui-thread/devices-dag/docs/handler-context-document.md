# handler 上下文（ctx）用法文档

## 概述

所有 DevicesDAG 节点 handler 的 `handler(packet, ctx)` 签名的第二个参数 `ctx`，即 `DevicesDAGHandlerContext`，由 `DevicesDAGNode._buildHandlerContext` 在分发时统一构建。所有 handler（设备根节点、prefix handler、工具 processor）拿到的都是同一套接口。

`createPrefixNodeHandler` 仅在此基础上为 `ctx.state` / `ctx.getState()` 叠加 `initialState` 默认值，不引入额外字段。

## 统一上下文原则

所有 handler 和工具 processor 拿到的 `ctx` 都是同一份 `DevicesDAGHandlerContext`。
它是沿 DAG 传递上下文的**唯一来源**，handler 不应将 `ctx` 包进自定义的中间对象后再传给下游方法。

### 规则

- handler / processor 的方法签名应直接接收 `ctx`（或 `context`），不创建包装层
- 若需从 `ctx` 或 `signalPacket` 中提取派生数据，将派生值作为额外参数独立传递，而非把 `ctx` 装入一个新对象
- 违背原则的典型模式：`buildXxxContext(signalPacket, ctx)` 返回 `{ context: ctx, ... }`，迫使下游方法从包装中拆回 `ctx`

### 示例

```js
// ✅ 正确：直接传递 ctx，派生值作为独立参数
process(signalPacket, ctx) {
  const position = resolvePosition(signalPacket);
  this.doSomething(ctx, position);
}

// ❌ 错误：把 ctx 包进自定义上下文对象
process(signalPacket, ctx) {
  const customCtx = { signalPacket, ctx, signals: packet.signals };
  this.doSomething(customCtx);  // 里面还要 customCtx.ctx 才能取回 ctx
}
```

---

## ctx 成员速览

### 节点信息

| 成员               | 类型             | 说明                                |
| ------------------ | ---------------- | ----------------------------------- |
| `ctx.path`         | `string`         | 当前节点路径（如 `/mouse/primary`） |
| `ctx.dag`          | `DevicesDAG`     | 所属设备图实例                      |
| `ctx.node`         | `DevicesDAGNode` | 当前节点                            |
| `ctx.semantics`    | `Object`         | 节点语义元数据快照                  |
| `ctx.defaultRoute` | `string`         | 当前节点默认出边名                  |
| `ctx.depth`        | `number`         | 当前分发深度                        |
| `ctx.signalPacket` | `SignalPacket`   | 当前输入信号包                      |

### 静态服务上下文

| 成员           | 类型     | 说明                                                                  |
| -------------- | -------- | --------------------------------------------------------------------- |
| `ctx.services` | `Object` | 沿 DAG 路径由节点声明式注入的基础设施依赖（board、viewport 等），只读 |

静态服务由节点定义注入，handler 返回值无法写入。

### 累积上下文

| 成员      | 类型     | 说明                                                                |
| --------- | -------- | ------------------------------------------------------------------- |
| `ctx.acc` | `Object` | 单次 dispatch 中由上游 handler 返回值逐层追加的运行时控制参数，只读 |

**规则**：handler 向下游传递运行时参数时，通过返回值 `{ acc: { key: value } }` 写入累积上下文。
`ctx.acc` 不包含 `services` 中的静态基础设施依赖；这部分请通过 `ctx.services` 读取。

### 状态管理

| 成员                                  | 类型                                  | 说明                                                                   |
| ------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `ctx.state`                           | `Object`                              | 当前节点状态快照。若走 `createPrefixNodeHandler` 已合并 `initialState` |
| `ctx.getState()`                      | `() => Object`                        | 重读节点最新状态                                                       |
| `ctx.setState(nextState)`             | `(Object) => Object`                  | 全量覆盖节点状态                                                       |
| `ctx.patchState(partial)`             | `(Object) => Object`                  | 浅合并 `{ ...current, ...partial }`                                    |
| `ctx.getNodeState(pathOrId?)`         | `(string\|number?) => Object`         | 读取任意节点（默认为当前节点）状态                                     |
| `ctx.setNodeState(pathOrId, state)`   | `(string\|number, Object) => Object`  | 发布自身节点状态；跨节点写入被禁止（strict 抛错，非 strict 告警）      |
| `ctx.delNodeState(pathOrId, ...keys)` | `(string\|number, ...string) => void` | 删除自身节点的状态键；跨节点删除同 `setNodeState` 受限                 |

### 路由

| 成员                             | 类型                              | 说明         |
| -------------------------------- | --------------------------------- | ------------ |
| `ctx.routeToChild(to, signals?)` | `(string, Array?) => { packets }` | 路由到子节点 |
| `ctx.stop()`                     | `() => { packets: [] }`           | 终止当前链路 |

### 信号构造

| 成员                              | 类型                               | 说明                                           |
| --------------------------------- | ---------------------------------- | ---------------------------------------------- |
| `ctx.signal(type, value, extra?)` | `(string, any, Object?) => Object` | 构造 `{ type, context: { value?, ...extra } }` |

`value` 为 `undefined` 时省略 `context.value`。

```js
ctx.signal("position", { x: 10, y: 20 });
// → { type: "position", context: { value: { x: 10, y: 20 } } }

ctx.signal("displacement", { x: 5, y: 3 }, { position: { x: 120, y: 220 } });
// → { type: "displacement", context: { value: { x: 5, y: 3 }, position: { x: 120, y: 220 } } }

ctx.signal("flush", undefined, { code: "KeyR" });
// → { type: "flush", context: { code: "KeyR" } }
```

---

## 状态管理

### 读取

```js
handler(packet, ctx) {
  const { anchor } = ctx.state;     // 读取快照
  const latest = ctx.getState();    // 读取最新状态
}
```

若 handler 通过 `createPrefixNodeHandler` 包装且提供了 `initialState`，首次调用时通过 `patchState` 将缺失的默认值写入节点 state。此后 `ctx.state` / `ctx.getState()` 与外部 `dag.getNodeState(path)` 形状一致。

```js
// initialState = { phase: "idle" }
// 首次调用后 node.state = { phase: "idle" }
// handler 后续写入：ctx.patchState({ anchor: { x: 10, y: 20 } })
// node.state = { phase: "idle", anchor: { x: 10, y: 20 } }
ctx.state; // { phase: "idle", anchor: { x: 10, y: 20 } }
dag.getNodeState(path); // { phase: "idle", anchor: { x: 10, y: 20 } }  ← 形状一致
```

### 写入

```js
ctx.setState({ anchor: { x: 100, y: 200 }, active: true }); // 全量覆盖
ctx.patchState({ anchor: null }); // 浅合并（常用）
```

### 与 React useState 的异同

| 方面       | React useState                                 | DAG handler ctx                                        |
| ---------- | ---------------------------------------------- | ------------------------------------------------------ |
| 读快照     | `const [state] = useState()` — 一次渲染内不变  | `ctx.state` — handler 入口快照，同次分发内不变         |
| 写新值     | `setState(nextState)` — 队列化，下次渲染才生效 | `ctx.setState(nextState)` — **同步写入节点**，立即生效 |
| 写入后重读 | 同一渲染内不可达新值                           | `ctx.getState()` 可立即读到新值                        |

DAG 的状态写入是**同步**的，`setState` / `patchState` 立即修改节点内部存储，不会延迟。

`ctx.state` 在 handler 入口处一次性构造，`setState` / `patchState` 写入的是节点内部存储，
**不会**修改已解构出来的 `ctx.state` 对象。写入后立即读取 `ctx.state` 得到的是旧值。

```js
// ❌ 错误：state 仍是写入前的快照
const state = ctx.state;
ctx.patchState({ anchor: current });
const x = current.x - state.anchor.x; // state.anchor 可能还是 null

// ✅ 正确：写入后用 getState() 重新读取
ctx.patchState({ anchor: current });
const latest = ctx.getState();
const x = current.x - latest.anchor.x;

// ✅ 也正确：写入前将旧值保留到本地变量
const state = ctx.state;
const anchor = state.anchor;
ctx.patchState({ anchor: current });
const x = current.x - (anchor?.x ?? current.x); // 用本地变量兜底
```

---

## 路由

### `ctx.routeToChild(to, signals?)`

将信号路由到下游子节点。**这是向下转发信号的唯一规范方式**。

```js
// 透传
return ctx.routeToChild(ctx.defaultRoute || "", packet.signals);

// 转发变换后的信号
return ctx.routeToChild("tool", [ctx.signal("displacement", { x: 5, y: 3 })]);
```

若不传 `signals`，默认使用当前 `signalPacket.signals`。

### `ctx.stop()`

终止当前链路。

```js
return ctx.stop();
```

---

## 典型用法

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
  return ctx.routeToChild("tool", [
    ctx.signal("position", newPos),
  ]);
}
```

---

## createPrefixNodeHandler 的职责

`createPrefixNodeHandler` 的唯一作用是在首次调用时将 `initialState` 写入节点 state。handler 拿到的仍是标准 `DevicesDAGHandlerContext`。

```js
createPrefixNodeHandler({
  initialState: { anchor: null },
  handle(packet, ctx) {
    // 首次调用时 node.state 已写入 { anchor: null }
    // ctx.state 与 dag.getNodeState(ctx.path) 形状一致
    ctx.patchState({ anchor: current });
    return ctx.routeToChild("tool", packet.signals);
  },
});
```

---

## 适用于所有 handler

以上接口适用于**所有** DevicesDAG handler，包括：

- 设备根节点（`mouse-device`、`keyboard-device`、`touchscreen-device`）
- prefix handler（`drag-anchor`、`signal-log`、`multi-tool`、`repeater`、`handoff`）
- 工具 processor（`Tool.createProcessor`）
- 裸 handler（直接挂在 DAG 节点上的任意函数）

工具 processor 拿到的同样是标准 handler context 全集。
`ctx.services` 中的 `board`、`boardApi`、`viewport` 由 DAG 上游节点通过节点声明式注入。
`ctx.acc` 中的 `autoCommit`、`autoUmountOnApply` 等由 handoff prefix 等上游 handler 返回时注入。

---

## 相关文档

- [DevicesDAG 核心文档](./devices-dag-document.md)
- [状态模型](./state-model-document.md)
- [修饰节点文档](../prefixes/docs/prefix-document.md)
- [Core 稳定接口](../../../docs/core-stable-interfaces.md)
- [signal 文档](./signal-document.md)
