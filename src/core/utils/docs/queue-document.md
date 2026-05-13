# queue 文档

本文档提供 `src/core/utils/queue.js` 的概述。

## 模块职责

`Queue` 实现了一个基于循环数组的普通队列，适合先进先出场景。

常见用途包括：

- 图遍历中的 BFS
- 事件或任务排队
- 临时节点处理队列

## 数据结构

与 `Deque` 类似，`Queue` 使用循环数组并预留一个空位区分空和满。

### 核心字段

| 名称 | 描述 | 类型 |
|---|---|---|
| `elements` | 底层循环数组 | `Array<any>` |
| `head` | 队头下标 | `number` |
| `tail` | 队尾下标 | `number` |
| `capacity` | 当前容量 | `number` |

### 静态常量

| 名称 | 描述 | 值 |
|---|---|---|
| `INITIAL_CAPACITY` | 初始容量 | `8` |
| `GROWTH_FACTOR` | 扩容因子 | `2` |

## API

| 名称 | 描述 | 类型 |
|---|---|---|
| `push(elem)` | 入队 | `any -> void` |
| `pop()` | 出队 | `void -> any` |
| `count()` | 获取元素个数 | `void -> number` |
| `empty()` | 判断是否为空 | `void -> boolean` |
| `peek()` | 查看队头元素 | `void -> any` |
| `clear()` | 清空队列 | `void -> void` |

## 行为特点

- 入队时若空间不足会自动扩容。
- 出队与查看队头在空队列时会抛出 `RangeError`。
- 出队后会把旧槽位设为 `undefined`，避免对象残留引用。

## 在仓库中的典型用途

例如活动对象分层逻辑会用它做 BFS，按入度为 `0` 的节点开始逐层传播层号。

## 相关文档

- [utils-document.md](./utils-document.md)
- [deque-document.md](./deque-document.md)
- [directed-graph-document.md](./directed-graph-document.md)