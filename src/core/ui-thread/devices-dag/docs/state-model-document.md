# 状态模型

## 概述

设备图中有三种不同作用域的可变状态，各自遵循不同的读写规则和生命周期。

明确区分这三种状态是编写可维护 prefix / tool 的前提：

- **累积上下文（`acc`）**：基础设施注入 + 回调传输通道。下游可读可用，不存储领域数据
- **节点状态（`node.state`）**：节点持久可观察状态，领域数据的唯一真相源
- **闭包状态**：handler 实例私有状态，只捕获 infra 引用，不存数据

## 三种状态

### 累积上下文（`acc`）

`acc` 是沿 DAG 命中路径逐层追加的上下文对象。

| 属性     | 说明                                     |
| -------- | ---------------------------------------- |
| 存储位置 | `handlerContext.acc`                     |
| 作用域   | 当前分发链路（单次 `dispatch`）          |
| 生命周期 | 单次 `dispatch` 结束后丢弃               |
| 读写规则 | 上游注入，下游可有限可写；不可覆盖已有键 |

`acc` 适合放：

- 共享资源引用（`board`、`boardApi`、`viewport`）
- 链路级一次性回调（`onToolComplete`）
- 链路级行为标志（`autoCommit`、`autoUmountOnApply`）

`acc` **不适合**放领域数据（如 `objects`）。工具对象由各工具节点在 `node.state` 中持有，`acc` 只负责把回调函数从父节点传到子节点。

#### 已知 acc 键

| 键                  | 注入方          | 用途                                  |
| ------------------- | --------------- | ------------------------------------- |
| `board`             | Board 根节点    | Board 实例引用                        |
| `boardApi`          | Board 根节点    | BoardApiRpc 代理                      |
| `viewport`          | Viewport 根节点 | Viewport 实例引用                     |
| `onToolComplete`    | Handoff prefix  | 工具完成通知回调，接受 `objects` 参数 |
| `autoCommit`        | Handoff prefix  | false 时阻止 Creator 自动提交         |
| `autoUmountOnApply` | Handoff prefix  | false 时阻止 modifier 自卸载          |
| `resolvePosition`   | Prefix          | 坐标解析函数                          |

### 节点状态（`node.state`）

| 属性     | 说明                              |
| -------- | --------------------------------- |
| 存储位置 | `DevicesDAGNode.state`            |
| 作用域   | 全图可读；由节点 handler 拥有     |
| 生命周期 | 节点存续期间                      |
| 读写规则 | 外部只读优先；写入由 handler 控制 |

`node.state` 适合放：

- 领域数据（`objects` — 工具当前持有的对象集合）
- 状态机相位（`phase`、`activeChild`）
- 调试摘要（`routeTarget`）

#### 当前已知 state keys

| 键            | 使用者                      | 用途                                 |
| ------------- | --------------------------- | ------------------------------------ |
| `phase`       | handoff prefix              | 当前工作流阶段（`first` / `second`） |
| `activeChild` | multi-tool prefix           | 当前活动子节点名                     |
| `routeTarget` | tool-switcher prefix        | 当前路由目标工具名                   |
| `objects`     | Tool（`setContextObjects`） | 工具当前持有的对象集合               |

### 闭包状态

| 属性     | 说明                       |
| -------- | -------------------------- |
| 存储位置 | handler 工厂闭包           |
| 作用域   | 仅 handler 自身可访问      |
| 生命周期 | handler 实例存续期间       |
| 读写规则 | 彻底私有，外部不可见不可写 |

闭包状态适合放：

- 配置常量（`displacementSignalType`）
- 懒初始化的处理器（tool `processor`）
- 临时缓存，不需要暴露给外部

闭包**不适合**放领域数据。如果数据需要跨上下午传递（如 handoff 桥接对象），应通过回调参数传入，而非存入闭包变量。

#### 已知闭包状态

| 闭包变量      | 所在模块        | 用途                                                 |
| ------------- | --------------- | ---------------------------------------------------- |
| `routeTarget` | `tool-switcher` | 当前路由目标（通过 `node.state.routeTarget` 可观察） |

## 领域数据归属

工具对象集合的归属权随工作流推进迁移：

```
first tool 创建对象
  → node.state.objects = [...objects]       ← first tool 是真相源
  → action:complete 事件
  → onToolComplete(objects)                 ← 数据作为参数传递
  → second.receiveHandoffObjects(objects)
  → second tool 的 process() 接到信号
  → second.setContextObjects(context, objects)
  → node.state.objects = [...objects]       ← 所有权已迁移到 second tool
```

- 每个工具节点在任意时刻都是自己 `objects` 的唯一真相源
- handoff prefix **不持有** `objects` — 它只提供回调传递机制
- `acc` 在传递过程中仅携带回调函数引用，不携带对象数据

## 写入约定

- **读取**：任何代码可通过 `dag.getNodeState(path)` 读取任意节点状态
- **写入自身**：handler 通过 `ctx.setState()` / `ctx.patchState()` 写入当前节点状态
- **跨节点写入**：仅允许父节点协调子节点状态的场景
- **外部写入**：非 handler 代码不应直接调用 `dag.setNodeState()`
- **acc 写入**：工具和 prefix 不应将领域数据写入 `acc`；`acc` 仅用于基础设施和回调

## 相关文档

- [设备图](./devices-dag-document.md)
- [handler 上下文（ctx）用法](./handler-context-document.md)
- [handoff 工作流](../prefixes/docs/handoff-handler-document.md)
