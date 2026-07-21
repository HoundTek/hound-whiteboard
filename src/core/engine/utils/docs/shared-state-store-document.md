# shared-state-store 文档

本文档提供 `src/engine/utils/shared-state-store.js` 的概述。

## 模块职责

`shared-state-store.js` 提供跨信道会话状态的共享存储 `SharedStateStore`。

它服务于"多个设备与图外 UI 必须达成一致"的场景——典型例子是按钮组设备与 DOM 工具栏的高亮一致。它是设备图状态模型中的第四种状态，有明确边界，不用于替代信号、`services` 或节点 `state`。

## 数据结构

| 名称           | 描述                 | 类型                         |
| -------------- | -------------------- | ---------------------------- |
| `#values`      | 键到当前值的映射     | `Map<string, any>`           |
| `#subscribers` | 键到订阅者集合的映射 | `Map<string, Set<Function>>` |

## API

| 名称                       | 描述                              | 类型                             |
| -------------------------- | --------------------------------- | -------------------------------- |
| `get(key)`                 | 读取指定键的当前值                | `(string) => any`                |
| `set(key, value)`          | 写入指定键的值（LWW），并同步通知 | `(string, any) => void`          |
| `subscribe(key, callback)` | 订阅指定键的变更，返回退订函数    | `(string, Function) => Function` |
| `getSnapshot()`            | 获取全部键值对的浅拷贝快照        | `() => Object`                   |

## 语义约束

- **多写者 LWW**：任何写者都可以 `set` 任意键，不做访问控制；最后一次写入获胜（Last-Writer-Wins）。
- **同步通知**：`set` 在写入后同步调用该键的全部订阅者 `callback(value, key)`；值经 `Object.is` 比较相同则跳过写入与通知。
- **回声容忍**：订阅者会收到自己写入触发的通知（回声），订阅者需自行容忍。
- **重入禁令**：订阅者禁止在回调内同步 dispatch 进设备图——回调在 `set` 调用栈内同步执行，重入会把 store 通知链与图分发链搅成死循环。
- **异常隔离**：单个订阅者回调抛错不中断其余订阅者，错误经 log 工具告警。
- **写 store ≠ 切换工具**：写入共享状态只完成"状态发布"这一半。以工具切换为例，完整切换 = `set` store + 发 `tool-switch` 信号；下游 ToolSwitcherWrapper 只认信号载荷。

## 行为特点

- `subscribe()` 返回退订函数；键的订阅者清空后，订阅表中的该键会被移除。
- `getSnapshot()` 返回浅拷贝，修改快照不影响存储内部状态。
- 实现与 `EventBus` 一样是同步的，不做异步调度或跨进程转发。

## 在仓库中的典型用途

- 按钮组设备（`button-group-device`）经 `ctx.services.sharedState` 发布当前激活工具名（键由接线层经必传的 `stateKey` 选项指定），DOM 工具栏适配器订阅同一键同步高亮。
- store 实例挂在 `Board` 上（`board.sharedState`），DAG 内通过根节点 `services.sharedState` 注入，图外代码持 Board 引用直接访问。

## 相关文档

- [utils-document.md](./utils-document.md)
- [event-bus-document.md](./event-bus-document.md)
- [状态模型](../../../ui-thread/devices-dag/docs/state-model-document.md)
