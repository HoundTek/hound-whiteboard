# 状态模型

## 概述

设备图中有三种不同作用域的可变状态，各自遵循不同的读写规则和生命周期。

明确区分这三种状态是编写可维护 prefix / tool 的前提：

- **累积上下文（`acc`）**：链路级共享作用域，有限可写
- **节点状态（`node.state`）**：节点持久可观察状态
- **闭包状态**：handler 实例私有状态，不对外暴露

## 三种状态

### 累积上下文（`acc`）

`acc` 是沿 DAG 命中路径逐层追加的上下文对象。

| 属性 | 说明 |
| --- | --- |
| 存储位置 | `handlerContext.acc` |
| 作用域 | 当前分发链路（单次 `dispatch`） |
| 生命周期 | 单次 `dispatch` 结束后丢弃 |
| 读写规则 | 上游注入，下游可有限可写；不可覆盖已有键 |

`acc` 适合放：

- 共享资源引用（`board`、`boardApi`、`viewport`）
- 链路级一次性回调（`onToolComplete`）
- 工具间桥接数据（`objects`、`handoffObjects`）
- 链路级行为标志（`autoCommit`、`autoUmountOnApply`）

#### Framework-owned keys

以下键由 DAG 框架或 Board 层注入，工具和 prefix 不应覆盖：

| 键 | 注入方 | 用途 |
| --- | --- | --- |
| `board` | Board 根节点 | Board 实例引用 |
| `boardApi` | Board 根节点 | BoardApiRpc 代理 |
| `viewport` | Viewport 根节点 | Viewport 实例引用 |

#### Tool-writable keys

以下键由工具或 prefix 在处理过程中写入，供同链路下游读取：

| 键 | 写入方 | 用途 |
| --- | --- | --- |
| `objects` | Tool（`setContextObjects`） | 当前工具持有的对象集合 |
| `onToolComplete` | Handoff prefix | 工具完成通知回调 |
| `autoCommit` | Handoff prefix | false 时阻止 Creator 自动提交 |
| `autoUmountOnApply` | Handoff prefix | false 时阻止 modifier 自卸载 |
| `handoffObjects` | Handoff prefix | handoff 桥接对象快照 |
| `setHandoffObjects` | Handoff prefix | first tool 写入桥接对象的回调 |
| `resolvePosition` | Prefix | 坐标解析函数 |

### 节点状态（`node.state`）

| 属性 | 说明 |
| --- | --- |
| 存储位置 | `DevicesDAGNode.state` |
| 作用域 | 全图可读；由节点 handler 拥有 |
| 生命周期 | 节点存续期间 |
| 读写规则 | 外部只读优先；写入由 handler 控制 |

`node.state` 适合放：

- 状态机相位（`phase`、`activeChild`）
- 拖拽锚点（`anchor`）
- 调试摘要（`routeTarget`、`bridgeObjectCount`）
- 需要被测试或调试读取的局部可变数据

#### 当前已知 state keys

| 键 | 使用者 | 用途 |
| --- | --- | --- |
| `phase` | handoff prefix | 当前工作流阶段（`first` / `second`） |
| `activeChild` | multi-tool prefix | 当前活动子节点名 |
| `routeTarget` | tool-switcher prefix | 当前路由目标工具名 |
| `bridgeObjectCount` | handoff prefix | 桥接对象数量摘要 |
| `objects` | Tool（`setContextObjects`） | 节点级对象集合快照 |
| `anchor` | modifier prefix | 拖拽锚点位置 |

### 闭包状态

| 属性 | 说明 |
| --- | --- |
| 存储位置 | handler 工厂闭包 |
| 作用域 | 仅 handler 自身可访问 |
| 生命周期 | handler 实例存续期间 |
| 读写规则 | 彻底私有，外部不可见不可写 |

闭包状态适合放：

- 配置常量（`displacementSignalType`）
- 懒初始化的处理器（tool `processor`）
- 临时缓存，不需要暴露给外部

#### 已知闭包状态与可观察摘要的对应关系

以下闭包状态虽然不直接暴露，但通过 `node.state` 提供了可观察摘要：

| 闭包变量 | 所在模块 | 可观察摘要 |
| --- | --- | --- |
| `routeTarget` | `tool-switcher` | `node.state.routeTarget` |
| `handoffObjects` | `handoff-handler` | `node.state.bridgeObjectCount` |
| `handoffExplicitlySet` | `handoff-handler` | （通过 `bridgeObjectCount > 0` 推断） |

## 写入约定

- **读取**：任何代码可通过 `dag.getNodeState(path)` 读取任意节点状态
- **写入自身**：handler 通过 `ctx.setState()` / `ctx.patchState()` 写入当前节点状态
- **跨节点写入**：仅允许父节点协调子节点状态的场景
- **外部写入**：非 handler 代码不应直接调用 `dag.setNodeState()`
- **acc 写入**：工具和 prefix 可写入 tool-writable keys，不应覆盖 framework-owned keys

## 相关文档

- [设备图](./devices-dag-document.md)
- [handler 上下文（ctx）用法](./handler-context-document.md)
