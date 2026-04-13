# math3d 文档

本文档提供 `src/utils/math3d.js` 的概述。

## 模块职责

`math3d.js` 提供三维向量与三维矩阵的基础数学能力，主要面向未来 3D 图形对象或三维变换扩展。

核心类型为：

- `Vector3D`
- `Matrix3D`

## Vector3D

### 字段

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `x` | X 坐标 | `number` |
| `y` | Y 坐标 | `number` |
| `z` | Z 坐标 | `number` |

### 主要能力

- 序列化、反序列化
- 三维向量加减、点乘、叉乘
- 距离与距离平方
- 通过 `Matrix3D` 进行变换
- 近似相等判断

### 主要方法

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `serialize()` | 序列化为对象 | `void -> Object` |
| `serializeToArray()` | 序列化为数组 | `void -> number[]` |
| `applyTransform(matrix)` | 原地应用矩阵变换 | `Matrix3D -> Vector3D` |
| `clonePoint()` | 克隆点 | `void -> Vector3D` |
| `add(other)` | 向量加法 | `Vector3D -> Vector3D` |
| `sub(other)` | 向量减法 | `Vector3D -> Vector3D` |
| `dotMul(other)` | 向量点乘 | `Vector3D -> number` |
| `crossMul(other)` | 向量叉乘 | `Vector3D -> Vector3D` |
| `Vector3D.parse(obj)` | 从对象构造向量 | `Object -> Vector3D` |
| `Vector3D.parseFromArray(arr)` | 从数组构造向量 | `number[] -> Vector3D` |
| `Vector3D.mulMatrix(m, p)` | 计算矩阵与向量乘积 | `Matrix3D -> Vector3D -> Vector3D` |
| `Vector3D.nearlyEq(a, b, eps)` | 判断两向量近似相等 | `Vector3D -> Vector3D -> number -> boolean` |
| `Vector3D.distanceTo(a, b)` | 计算差的模长 | `Vector3D -> Vector3D -> number` |
| `Vector3D.distanceSq(a, b)` | 计算差的模长的平方 | `Vector3D -> Vector3D -> number` |

## Matrix3D

### 表示形式

`Matrix3D` 表示三维矩阵：

$$
\begin{bmatrix}
a_{11} & a_{12} & a_{13} \\
a_{21} & a_{22} & a_{23} \\
a_{31} & a_{32} & a_{33}
\end{bmatrix}
$$

### 主要能力

- 序列化与反序列化
- 矩阵加减乘与数乘
- 行列式与逆矩阵计算
- 三维点变换
- 近似相等判断

### 主要方法

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `serialize()` | 序列化为对象 | `void -> Object` |
| `serializeToArray()` | 序列化为二维数组 | `void -> number[][]` |
| `cloneMatrix()` | 克隆矩阵 | `void -> Matrix3D` |
| `get(x, y)` | 读取矩阵元素 | `number -> number -> number` |
| `getFromArr(arr)` | 用数组读取矩阵元素 | `number[] -> number` |
| `applyToVector(point)` | 对三维点应用矩阵 | `Vector3D -> Vector3D` |
| `add(other)` | 矩阵加法 | `Matrix3D -> Matrix3D` |
| `sub(other)` | 矩阵减法 | `Matrix3D -> Matrix3D` |
| `mul(other)` | 矩阵乘法 | `Matrix3D -> Matrix3D` |
| `scale(scale)` | 数乘 | `number -> Matrix3D` |
| `det()` | 行列式 | `void -> number` |
| `inv()` | 逆矩阵 | `void -> Matrix3D` |
| `Matrix3D.identity()` | 单位矩阵 | `void -> Matrix3D` |
| `Matrix3D.parse(obj)` | 从对象构造矩阵 | `Object -> Matrix3D` |
| `Matrix3D.parseFromArray(arr)` | 从数组构造矩阵 | `number[][] -> Matrix3D` |
| `Matrix3D.nearlyEq(a, b, eps)` | 近似相等判断 | `Matrix3D -> Matrix3D -> number -> boolean` |

## 注意事项

- 当前 `get(x, y)` 的实现尚未完整覆盖全部 `3 x 3` 下标组合，因此若需要高频随机访问矩阵元素，建议先确认实现状态。
- `inv()` 在矩阵不可逆时会抛出异常。

## 适用场景

- 三维图元的基础变换
- 3D 对象的点与矩阵存储
- 未来三维几何扩展的底层数学支持