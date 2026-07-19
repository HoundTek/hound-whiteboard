# 状态模型

## 概述

设备图中的可变状态按「归谁写 × 活多久」归类。明确区分它们是编写可维护 prefix / tool 的前提：

- **静态服务上下文（`services`）**：基础设施依赖，由节点声明注入，沿 DAG 路径累积
- **累积上下文（`acc`）**：单次 dispatch 中由上游 handler 逐层追加的运行时控制参数
- **状态**：分为**权威状态**与**投影**两个层面——
  - **权威状态（真理源）**：归闭包 / 实例字段。系统中所有状态都是单主的，写所有权天然应封闭
  - **状态投影（`node.state`）**：拥有者主动发布的、全图可寻址的只读投影，唯一职责是可观察性

一句话原则：**闭包管对错，state 管看见。**

## 四种状态

### 静态服务上下文（`services`）

`services` 是沿 DAG 路径由节点声明式注入的基础设施依赖。
通过 `configureNode(path, { services: { ... } })` 或 Builder DSL `.services({ ... })` 声明。

| 属性     | 说明                                          |
| -------- | --------------------------------------------- |
| 存储位置 | `handlerContext.services`                     |
| 作用域   | 沿 DAG 路径静态累积（整个 dispatch 生命周期） |
| 生命周期 | 节点存续期间（同一节点同一份 services）       |
| 读写规则 | 只读；由节点定义注入，handler 不能修改        |

`services` 适合放：

- 共享资源引用（`board`、`boardApi`、`viewport`）
- 任何与路由决策无关的基础设施依赖

#### 已知 services 键

| 键         | 声明方           | 用途              |
| ---------- | ---------------- | ----------------- |
| `board`    | Board 根节点 `/` | Board 实例引用    |
| `boardApi` | Board 根节点 `/` | BoardApiRpc 代理  |
| `viewport` | Viewport 根节点  | Viewport 实例引用 |

### 累积上下文（`acc`）

`acc` 是单次 dispatch 中由上游 handler 返回结果时逐层追加的运行时参数。
它只包含动态路由参数，不包含 `services` 中的静态基础设施依赖。

| 属性     | 说明                               |
| -------- | ---------------------------------- |
| 存储位置 | `handlerContext.acc`               |
| 作用域   | 当前分发链路（单次 `dispatch`）    |
| 生命周期 | 单次 `dispatch` 结束后丢弃         |
| 读写规则 | 上游注入，下游只读；不可覆盖已有键 |

`acc` 适合放：

- 链路级一次性控制标志（`autoCommit`、`autoUmountOnApply`）
- 链路级临时参数（`resolvePosition`、`objectId`）
- 仅对当前链路生效的轻量元数据

#### 已知 acc 键

| 键                  | 注入方         | 用途                          |
| ------------------- | -------------- | ----------------------------- |
| `autoCommit`        | Handoff prefix | false 时阻止 Creator 自动提交 |
| `autoUmountOnApply` | Handoff prefix | false 时阻止 modifier 自卸载  |
| `resolvePosition`   | Prefix         | 坐标解析函数                  |
| `objectId`          | 上游 Prefix    | 预分配的对象 id               |

### 状态投影（`node.state`）

`node.state` 是**发布层**：拥有者把需要被外界观察的状态发布到自己的节点上，供调试、测试与跨节点读取。它**不是真理源**——真理源永远在拥有者的闭包或实例字段里。

| 属性     | 说明                                                     |
| -------- | -------------------------------------------------------- |
| 存储位置 | `DevicesDAGNode.state`                                   |
| 作用域   | 全图可读；仅拥有者可写                                   |
| 生命周期 | 节点存续期间                                             |
| 读写规则 | **读取完全开放**；写入仅限拥有者对自身节点（发布语义）   |

`node.state` 适合放：

- 工具发布的状态投影（`objects` — 工具当前持有的对象集合）
- 状态机发布的相位投影（`phase`、`activeChild`、`routeTarget`）
- prefix 的机制状态投影（`anchor` 等）

写入规则由运行时保障：`ctx.setNodeState` / `ctx.delNodeState` 写入非自身节点时，
strict 模式抛错，非 strict 模式经 log 工具告警。外部代码（非 handler）不应调用
`dag.setNodeState()` 写入——投影由拥有者发布，外部写入不产生任何真实效果。

#### 当前已知投影键

| 键            | 发布者                      | 用途                                 |
| ------------- | --------------------------- | ------------------------------------ |
| `phase`       | handoff prefix              | 当前工作流阶段（`first` / `second`） |
| `activeChild` | multi-tool prefix           | 当前活动子节点名                     |
| `routeTarget` | tool-switcher prefix        | 当前路由目标工具名                   |
| `objects`     | Tool（`setContextObjects`） | 工具当前持有的对象集合               |

### 权威状态（闭包 / 实例字段）

权威状态是数据的**唯一真相源**，归拥有者的闭包或实例字段持有。系统中所有状态都是单主的——每个状态只有一个写入者，因此写所有权天然应封闭在拥有者内部。

| 属性     | 说明                       |
| -------- | -------------------------- |
| 存储位置 | handler 工厂闭包 / 实例字段 |
| 作用域   | 仅拥有者自身可访问         |
| 生命周期 | handler 实例存续期间       |
| 读写规则 | 彻底私有，外部不可见不可写 |

闭包 / 实例字段适合放：

- **状态的真理源**——路由类状态机的阶段（`handoffPhase`）、路由目标（`routeTarget`）、工具持有的对象集合
- 配置常量（`displacementSignalType`）
- 懒初始化的处理器（tool `processor`）
- 临时缓存，不需要暴露给外部

需要被外界观察的权威状态，由拥有者**发布投影**到自己的 `node.state`：

```
闭包变量 handoffPhase = "first"        ← 真理源，路由决策只读它
   ↓ 变化时由拥有者发布
node.state.phase / activeChild         ← 只读投影，仅供观察与调试
```

约定：

- 路由决策永远读真理源，不读投影；`dag-debug` 等观察方只读投影
- 外部写入投影不会产生任何效果，且会在下次发布时被真理源覆盖
- 数据需要跨上下游传递时，通过事件参数、函数参数或投影传递，不直接共享闭包变量

#### 已知权威状态

| 闭包变量       | 所在模块        | 用途                                                       |
| -------------- | --------------- | ---------------------------------------------------------- |
| `routeTarget`  | `tool-switcher` | 当前路由目标（通过 `node.state.routeTarget` 投影观察）     |
| `handoffPhase` | `handoff`       | 当前阶段（通过 `node.state.phase` / `activeChild` 观察）   |

## 领域数据归属

工具对象集合的归属权随工作流推进迁移：

```
first tool 创建对象
  → first tool 实例持有，发布投影 node.state.objects = [...objects]
  → action:complete 事件
  → 回调参数 (objects)                      ← 数据作为参数传递
  → second.receiveHandoffObjects(objects)
  → second tool 的 process() 接到信号
  → second.setContextObjects(context, objects)
  → second 实例持有，发布投影 node.state.objects = [...objects]
```

- 每个工具实例在任意时刻都是自己 `objects` 的唯一真相源，`node.state.objects` 只是它发布的投影
- handoff prefix **不持有** `objects` — 它只负责路由与状态切换

## 写入约定

- **读取**：任何代码可通过 `dag.getNodeState(path)` 读取任意节点的投影，完全开放
- **发布（写入自身）**：拥有者通过 `ctx.setState()` / `ctx.patchState()` / `ctx.setNodeState(ctx.path, ...)` 发布自己节点的投影
- **跨节点写入**：禁止。`ctx.setNodeState` / `ctx.delNodeState` 写入非自身节点时，strict 模式抛错，非 strict 模式经 log 工具告警
- **外部写入**：非 handler 代码不应调用 `dag.setNodeState()`——投影由拥有者发布，外部写入不产生真实效果
- **acc 写入**：通过 handler 返回值 `{ acc: { key: value } }` 注入

## 相关文档

- [设备图](./devices-dag-document.md)
- [handler 上下文（ctx）用法](./handler-context-document.md)
- [handoff 工作流](../prefixes/docs/handoff-handler-document.md)
