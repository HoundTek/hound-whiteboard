# algorithm 文档

本文档提供 `src/utils/algorithm.js` 的概述。

## 模块职责

`algorithm.js` 目前包含两类能力：

- 不重复随机数池 `RandomNumberPool`
- 双指/三指操作对应的二维变换矩阵求解函数

这部分逻辑偏基础算法层，不依赖白板业务对象，可供工具层、手势层和文件命名逻辑复用。

## RandomNumberPool

`RandomNumberPool` 用来在区间 `[min, max]` 内生成不重复随机数，并维护当前已占用数字集合。

### 核心字段

| 名称 | 描述 | 类型 |
|---|---|---|
| `min` | 最小值 | `number` |
| `max` | 最大值 | `number` |
| `length` | 当前已占用数字个数 | `number` |
| `pool` | 已占用数字集合 | `Set<number>` |

### 主要方法

| 名称 | 描述 | 类型 |
|---|---|---|
| `initFromArray(arr)` | 用数组初始化池内容 | `number[] -> void` |
| `add(num)` | 向池中加入指定数字 | `number -> boolean` |
| `include(num)` | 查询数字是否在池中 | `number -> boolean` |
| `isFull()` | 判断池是否已满 | `void -> boolean` |
| `generate()` | 生成一个不重复随机数 | `void -> number` |
| `remove(num)` | 从池中移除指定数字 | `number -> boolean` |
| `rename(num)` | 用一个新随机数替换旧数字 | `number -> number` |

### 行为特点

- `generate()` 在池满时会抛出异常。
- `rename(num)` 的实现是“先生成新值，再移除旧值”，因此它的语义是“替换占位”，不是纯重命名字符串。
- `include()` 只在输入数字位于合法区间内时才可能返回 `true`。

## 双指与三指矩阵计算

### `getDualFingerResult(...)`

根据两个原始点和两个目标点，求解二维变换矩阵参数 `a, b, c, d, e, f`，适用于类似 `ctx.transform(a, b, c, d, e, f)` 的场景。

### `getTriFingerResult(...)`

根据三个原始点和三个目标点求解二维变换矩阵参数。

### 返回值结构

两个函数都返回：

```js
{
  a, b, c, d, e, f
}
```

可直接用于 Canvas 2D 变换参数。

## 已知限制

源码中已明确标注：

- 双指算法中 `a b c d` 的结果是可信的，但 `e` 和 `f` 目前有问题。
- 三指算法也有同样的问题。

因此当前更适合把这两个函数视为“旋转/缩放主逻辑已成型、平移部分待修正”的实现。

## 适用场景

- 手势缩放
- 双指/三指旋转与平移草算
- 随机且不重复的 id 分配

## 依赖

- Node.js `crypto.randomInt`