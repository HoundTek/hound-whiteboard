# math 文档

本文档提供 `src/utils/math.js` 的概述。

## 模块职责

`math.js` 提供二维几何与线性代数基础设施，核心类型为：

- `Point`：二维点
- `Matrix`：二维线性变换矩阵

这是整个白板几何系统的基础模块，对象位置、顶点编辑、碰撞判断和变换都依赖它。

## Point

### 字段

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `x` | 横坐标 | `number` |
| `y` | 纵坐标 | `number` |

### 主要能力

- 序列化与反序列化
- 点加减与点乘
- 距离与距离平方计算
- 通过矩阵进行坐标变换
- 按误差判断近似相等

### 主要方法

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `serialize()` | 序列化为对象 | `void -> {x, y}` |
| `serializeToArray()` | 序列化为数组 | `void -> number[]` |
| `applyTransform(matrix)` | 原地应用矩阵变换 | `Matrix -> Point` |
| `clonePoint()` | 克隆点 | `void -> Point` |
| `add(other)` | 点加法 | `Point -> Point` |
| `sub(other)` | 点减法 | `Point -> Point` |
| `dotMul(other)` | 点乘 | `Point -> number` |
| `Point.parse(obj)` | 从对象构造点 | `Object -> Point` |
| `Point.parseFromArray(arr)` | 从数组构造点 | `number[] -> Point` |
| `Point.mulMatrix(m, p)` | 计算矩阵与点乘积 | `Matrix -> Point -> Point` |
| `Point.nearlyEq(a, b, eps)` | 判断两点近似相等 | `Point -> Point -> number -> boolean` |
| `Point.distanceTo(a, b)` | 计算距离 | `Point -> Point -> number` |
| `Point.distanceSq(a, b)` | 计算距离平方 | `Point -> Point -> number` |

## Matrix

### 表示形式

`Matrix` 表示二维矩阵：

$$
\begin{bmatrix}
a & c \\
b & d
\end{bmatrix}
$$

### 字段

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `a` | 左上元素 | `number` |
| `b` | 左下元素 | `number` |
| `c` | 右上元素 | `number` |
| `d` | 右下元素 | `number` |

### 主要能力

- 矩阵加减乘与数乘
- 旋转矩阵组合
- 行列式与逆矩阵计算
- 作用于二维点
- 近似相等判断

### 主要方法

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `serialize()` | 序列化为对象 | `void -> Object` |
| `serializeToArray()` | 序列化为二维数组 | `void -> number[][]` |
| `cloneMatrix()` | 克隆矩阵 | `void -> Matrix` |
| `get(x, y)` | 读取矩阵元素 | `number -> number -> number` |
| `getFromArr(arr)` | 用数组读取矩阵元素 | `number[] -> number` |
| `applyToPoint(point)` | 对点应用矩阵 | `Point -> Point` |
| `add(other)` | 矩阵加法 | `Matrix -> Matrix` |
| `sub(other)` | 矩阵减法 | `Matrix -> Matrix` |
| `mul(other)` | 矩阵乘法 | `Matrix -> Matrix` |
| `scale(scale)` | 数乘 | `number -> Matrix` |
| `rotate(radian)` | 右乘旋转矩阵 | `number -> Matrix` |
| `det()` | 行列式 | `void -> number` |
| `inv()` | 逆矩阵 | `void -> Matrix` |
| `Matrix.identity()` | 单位矩阵 | `void -> Matrix` |
| `Matrix.parse(obj)` | 从对象构造矩阵 | `Object -> Matrix` |
| `Matrix.parseFromArray(arr)` | 从数组构造矩阵 | `number[][] -> Matrix` |
| `Matrix.nearlyEq(a, b, eps)` | 近似相等判断 | `Matrix -> Matrix -> number -> boolean` |

## 适用场景

- 对象局部坐标与世界坐标转换
- 旋转、缩放等线性变换
- 几何编辑中的顶点更新

## 注意事项

- `applyTransform()` 和 `applyToPoint()` 会修改点对象本身。
- `inv()` 在矩阵不可逆时会抛出异常。