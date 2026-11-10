# queue 文档

## 模块职责

`Queue` 实现了一个基于循环数组的普通队列，适合先进先出场景。源码位于 `src/kernel/utils/queue.js`。

当前调用点在 `src/kernel/board/active-object-manager.js`，用于图遍历 BFS：

- `pickup` 中按区块加载状态分流的跨区块拾取遍历
- 从入度为 0 的节点出发的分层遍历

## 数据结构

`Queue` 使用循环数组并预留一个空位区分空和满。

### 核心字段

| 名称       | 描述         | 类型         |
| ---------- | ------------ | ------------ |
| `elements` | 底层循环数组 | `Array<any>` |
| `head`     | 队头下标     | `number`     |
| `tail`     | 队尾下标     | `number`     |
| `capacity` | 当前容量     | `number`     |

### 静态常量

| 名称               | 描述         | 值   |
| ------------------ | ------------ | ---- |
| `INITIAL_CAPACITY` | 私有初始容量 | `32` |
| `GROWTH_FACTOR`    | 私有扩容因子 | `2`  |

## API

| 名称                | 描述                             | 类型                               |
| ------------------- | -------------------------------- | ---------------------------------- |
| `push(elem)`        | 入队                             | `(any) => void`                    |
| `pop()`             | 出队                             | `() => any`                        |
| `count()`           | 获取元素个数                     | `() => number`                     |
| `empty()`           | 判断是否为空                     | `() => boolean`                    |
| `peek()`            | 查看队头元素                     | `() => any`                        |
| `clear()`           | 清空队列并把容量重置为初始容量   | `() => void`                       |
| `toArray()`         | 转换为数组                       | `() => Array<any>`                 |
| `filter(predicate)` | 筛选队列元素                     | `((any) => boolean) => Array<any>` |
| `map(transform)`    | 映射队列元素                     | `((any) => any) => Array<any>`     |

## 行为特点

- 入队时若空间不足会自动扩容。
- 出队与查看队头在空队列时会抛出 `RangeError`。
- 出队后会把旧槽位设为 `undefined`，避免对象残留引用。
- `filter` 和 `map` 不修改原队列，返回新数组（非 `Queue`），可直接链式调用原生数组方法。

## 相关文档

- [utils-document.md](./utils-document.md)
- [directed-graph-document.md](./directed-graph-document.md)
