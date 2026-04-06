# deque 文档

本文档提供 `src/utils/deque.js` 的概述。

## 模块职责

`Deque` 实现了一个基于循环数组的双端队列，支持在队头和队尾两端进行入队和出队。

它适合以下场景：

- 页缓冲区维护
- 需要首尾双向弹出的缓存结构
- BFS 的扩展版本或滑动窗口

## 数据结构

`Deque` 内部使用循环数组管理元素，并预留一个空位用于区分“空”和“满”。

### 核心字段

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `elements` | 底层循环数组 | `Array<any>` |
| `head` | 队头下标 | `number` |
| `tail` | 队尾下标 | `number` |
| `capacity` | 当前容量 | `number` |

### 静态常量

| 名称 | 描述 | 值 |
|:--|:--|:--|
| `INITIAL_CAPACITY` | 初始容量 | `8` |
| `GROWTH_FACTOR` | 扩容因子 | `2` |

## API

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `pushBack(elem)` | 从队尾入队 | `any -> void` |
| `pushFront(elem)` | 从队头入队 | `any -> void` |
| `popFront()` | 从队头出队 | `void -> any` |
| `popBack()` | 从队尾出队 | `void -> any` |
| `count()` | 获取元素个数 | `void -> number` |
| `empty()` | 判断是否为空 | `void -> boolean` |
| `peekFront()` | 查看队头元素 | `void -> any` |
| `peekBack()` | 查看队尾元素 | `void -> any` |
| `clear()` | 清空队列 | `void -> void` |
| `toArray()` | 转为数组 | `void -> Array<any>` |
| `includes(elem)` | 判断是否包含元素 | `any -> boolean` |

## 行为特点

- 当数组即将满时会自动扩容。
- `count()` 返回逻辑长度，不等于底层数组长度。
- `peekFront()`、`peekBack()`、`popFront()`、`popBack()` 在空队列时会抛出 `RangeError`。
- `toArray()` 会按照逻辑顺序导出，不受循环数组存储位置影响。

## 典型用途

- 在 `PageLoadManager` 之类场景中维护左右缓冲页
- 维护最近访问记录
- 支持双向淘汰策略的缓存队列