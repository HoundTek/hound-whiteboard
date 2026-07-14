# chain 文档

本文档提供 `src/engine/utils/chain.js` 的概述。

## 模块职责

`chain.js` 提供一个简单的单向链表实现，包括：

- `Node`：链表节点
- `Chain`：链表本体

该实现适合需要顺序插入、头尾追加、按索引访问的小型链式结构场景。

## Node

### 字段

| 名称    | 描述           | 类型           |
| ------- | -------------- | -------------- |
| `value` | 节点值         | `any`          |
| `next`  | 下一个节点引用 | `Node \| null` |

## Chain

### 核心字段

| 名称     | 描述     | 类型           |
| -------- | -------- | -------------- |
| `head`   | 头节点   | `Node \| null` |
| `tail`   | 尾节点   | `Node \| null` |
| `length` | 链表长度 | `number`       |

## API

| 名称                     | 描述                     | 类型                    |
| ------------------------ | ------------------------ | ----------------------- |
| `append(value)`          | 在尾部追加节点           | `(any) => void`         |
| `prepend(value)`         | 在头部插入节点           | `(any) => void`         |
| `insertAt(value, index)` | 在指定索引插入节点       | `(any, number) => void` |
| `removeAt(index)`        | 删除指定索引节点并返回值 | `(number) => any`       |
| `getAt(index)`           | 获取指定索引值           | `(number) => any`       |
| `indexOf(value)`         | 查找值对应索引           | `(any) => number`       |
| `isEmpty()`              | 判断链表是否为空         | `() => boolean`         |
| `size()`                 | 获取链表长度             | `() => number`          |
| `clear()`                | 清空链表                 | `() => void`            |

## 行为特点

- `append` 和 `prepend` 都是常量时间更新头尾引用。
- `insertAt`、`removeAt`、`getAt` 需要线性遍历到目标位置。
- `removeAt`、`getAt` 在索引越界或链表为空时会抛出 `RangeError`。
- `indexOf` 按严格相等 `===` 查找值。

## 相关文档

- [utils-document.md](./utils-document.md)
- [queue-document.md](./queue-document.md)
- [deque-document.md](./deque-document.md)
