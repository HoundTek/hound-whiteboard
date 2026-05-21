# counter-pool 文档

本文档提供 `src/core/utils/counter-pool.js` 的概述。

## 模块职责

`counter-pool.js` 提供一个最小计数器生成器 `CounterPool`。

它用于在运行时连续分配递增编号，适合区块 id、显示器 id、临时对象 id 等只需要“单调递增”而不需要回收的场景。

## 核心字段

| 名称 | 描述 | 类型 |
|---|---|---|
| `counter` | 当前计数值 | `number` |

## API

| 名称 | 描述 | 类型 |
|---|---|---|
| `constructor(count = 0)` | 创建计数器池 | `number -> CounterPool` |
| `init(count = 0)` | 重置当前计数值 | `number -> CounterPool` |
| `generate()` | 返回下一个递增数字 | `void -> number` |

## 行为特点

- `generate()` 会先自增，再返回结果。
- `init()` 会直接覆盖当前状态，并返回实例自身。
- 模块不负责回收编号，也不做并发保护。

## 在仓库中的典型用途

- 生成连续区块 id
- 生成运行时组件序号
- 需要链式初始化的小型计数器场景

## 相关文档

- [utils-document.md](./utils-document.md)
- [random-document.md](./random-document.md)