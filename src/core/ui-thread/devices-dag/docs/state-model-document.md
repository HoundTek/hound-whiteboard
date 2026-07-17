# 状态模型

## 概述

设备图中有四种不同作用域的可变状态，各自遵循不同的读写规则和生命周期。

明确区分这四种状态是编写可维护 prefix / tool 的前提：

- **静态服务上下文（`services`）**：基础设施依赖，由节点声明注入，沿 DAG 路径累积
- **累积上下文（`acc`）**：单次 dispatch 中由上游 handler 逐层追加的运行时控制参数
- **节点状态（`node.state`）**：节点持久可观察状态，领域数据的唯一真相源
- **闭包状态**：handler 实例私有状态，只捕获实现细节，不存领域数据

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

闭包**不适合**放领域数据。如果数据需要跨上下游传递，应通过事件参数、函数参数或节点状态传递，而非存入闭包变量。

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
  → 回调参数 (objects)                      ← 数据作为参数传递
  → second.receiveHandoffObjects(objects)
  → second tool 的 process() 接到信号
  → second.setContextObjects(context, objects)
  → node.state.objects = [...objects]       ← 所有权已迁移到 second tool
```

- 每个工具节点在任意时刻都是自己 `objects` 的唯一真相源
- handoff prefix **不持有** `objects` — 它只负责路由与状态切换

## 写入约定

- **读取**：任何代码可通过 `dag.getNodeState(path)` 读取任意节点状态
- **写入自身**：handler 通过 `ctx.setState()` / `ctx.patchState()` 写入当前节点状态
- **跨节点写入**：仅允许父节点协调子节点状态的场景
- **外部写入**：非 handler 代码不应直接调用 `dag.setNodeState()`
- **acc 写入**：通过 handler 返回值 `{ acc: { key: value } }` 注入

## 相关文档

- [设备图](./devices-dag-document.md)
- [handler 上下文（ctx）用法](./handler-context-document.md)
- [handoff 工作流](../prefixes/docs/handoff-handler-document.md)
