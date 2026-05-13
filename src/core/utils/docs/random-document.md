# random 文档

本文档提供 `src/core/utils/random.js` 的概述。

## 模块职责

`random.js` 提供两类能力：

- `randomInt(min, max)`：生成密码学安全随机整数
- `RandomNumberPool`：维护一个不重复数字池

该模块主要用于需要唯一编号但又不希望顺序暴露的场景。

## randomInt

### 职责

`randomInt(min, max)` 使用 `globalThis.crypto.getRandomValues()` 生成 `[min, max)` 区间内的随机整数。

### 行为特点

- 左闭右开区间
- 依赖运行环境提供 Web Crypto API
- 当前实现不负责参数合法性兜底

## RandomNumberPool

### 核心字段

| 名称 | 描述 | 类型 |
|---|---|---|
| `min` | 允许生成的最小值 | `number` |
| `max` | 允许生成的最大值 | `number` |
| `length` | 当前已占用数字数量 | `number` |
| `pool` | 已占用数字集合 | `Set<number>` |

### API

| 名称 | 描述 | 类型 |
|---|---|---|
| `constructor(min, max)` | 创建随机数池 | `number -> number -> RandomNumberPool` |
| `initFromArray(arr)` | 用现有数组重建池状态 | `number[] -> void` |
| `add(num)` | 手动占用一个数字 | `number -> boolean` |
| `include(num)` | 判断数字是否已在池中 | `number -> boolean` |
| `isFull()` | 判断池是否已满 | `void -> boolean` |
| `generate()` | 生成一个新的不重复数字 | `void -> number` |
| `remove(num)` | 释放一个数字 | `number -> boolean` |
| `rename(num)` | 生成新数字并移除旧数字 | `number -> number` |

## 行为特点

- `initFromArray()` 只会接受落在 `[min, max]` 范围内的值。
- `generate()` 在池已满时会抛出异常。
- `rename(num)` 的执行顺序是先生成新数字，再移除旧数字，因此调用时需要保证池中仍有可用空间。
- `length` 是逻辑占用数，不一定等于原始输入数组长度。

## 在仓库中的典型用途

- 活动对象或节点的随机唯一编号
- 测试中需要可回收的唯一数字池
- 不希望直接使用单调递增 id 的临时标识分配

## 相关文档

- [utils-document.md](./utils-document.md)
- [counter-pool-document.md](./counter-pool-document.md)