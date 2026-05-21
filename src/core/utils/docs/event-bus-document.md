# event-bus 文档

本文档提供 `src/core/utils/event-bus.js` 的概述。

## 模块职责

`event-bus.js` 提供一个轻量级同步事件总线 `EventBus`。

它负责表达模块之间的运行时通知关系，不负责事件持久化、异步调度或跨进程转发。

## 数据结构

| 名称 | 描述 | 类型 |
|---|---|---|
| `listeners` | 事件名到监听器集合的映射 | `Map<string, Set<Function>>` |

同一事件下使用 `Set` 存储监听器，因此同一个函数重复注册不会重复保留多份。

## API

| 名称 | 描述 | 类型 |
|---|---|---|
| `on(eventName, handler)` | 订阅事件，并返回取消订阅函数 | `string -> Function -> Function` |
| `off(eventName, handler)` | 取消订阅指定监听器 | `string -> Function -> boolean` |
| `once(eventName, handler)` | 只订阅一次 | `string -> Function -> Function` |
| `emit(eventName, payload)` | 同步触发事件 | `string -> any -> Array<any>` |
| `clear(eventName)` | 清空指定事件或全部事件 | `string? -> void` |

## 行为特点

- `emit()` 会按注册顺序执行当前监听器快照，并返回所有监听器的返回值数组。
- `once()` 通过包装函数实现，在首次触发后会自动解绑。
- 当某个事件的监听器被全部移除后，事件键会从 `listeners` 中删除。
- 当前实现是同步总线，不会自动吞掉监听器内部抛出的异常。

## 在仓库中的典型用途

- `ChunkLoader` 这类运行时组件之间的状态通知
- 测试环境中的轻量事件编排
- 不希望直接形成强耦合调用关系的模块协作

## 相关文档

- [utils-document.md](./utils-document.md)
- [queue-document.md](./queue-document.md)
- [directed-graph-document.md](./directed-graph-document.md)