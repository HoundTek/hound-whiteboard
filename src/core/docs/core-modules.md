# Core 模块详解（含实现状态）

本文按模块总结“职责、关键类、现状”。

## 1. components/

### 1.1 Board

目标职责：

- 管理白板级状态（宽高、根目录、页顺序）
- 管理分页加载与对象写入
- 管理 `UndoTree` 与 `ActiveObjectManager`

当前状态：

- 字段与主要流程框架已在 `src/core/components/board.js` 建立。
- `load()` 已覆盖 meta/config/page-order/trace 的基础读取与邻近页加载策略。
- 仍有明显 `todo`：创建文件结构、完整页加载、历史状态回放、设备相关联动。

### 1.2 Page

目标职责：

- 管理单页对象
- 维护双向页链（prev/next）
- 提供完整加载/临时加载/卸载

当前状态：

- 基本字段和页连接逻辑已存在。
- 临时加载 (`loadTemp`) 可加载层叠图。
- 完整对象加载、落盘、卸载清理仍待完成。

### 1.3 PageObjectManager

目标职责：

- 管理页级静态对象图（层叠关系）
- 管理页内对象映射与跨页覆盖集合

当前状态：

- `staticGraph`、`coverLeftPage`、`coverRightPage`、`pageObjects` 数据结构已定义。
- `loadTierGraph()` 能解析图结构。
- 对象读写与图落盘方法仍为空。

### 1.4 ActiveObjectManager

目标职责：

- 管理当前活动对象
- 以层结构维护活动对象与非活动对象子图
- 支持选择、取消选择、置顶、整理层

当前状态：

- 是 Core 中实现最完整的复杂模块之一。
- 已包含：
  - 子图拾取（含跨页访问）
  - 选择分层逻辑（按路径活动点数分层）
  - 层插入、层顺序比较、置顶与清理
- 仍有待打磨：页加载器与真实文件路径联动、性能优化、边界处理测试补全。

## 2. objects/

### 2.1 基础层次

对象继承链主干：

- `BasicObject`
- `Container`
- `OneDimensionObject` / `TwoDimensionObject`
- 具体对象（如 `TextObject`、`PolygonObject`、`StrokeObject`）

`BasicObject` 已定义关键通用能力：

- 位置、变换矩阵
- 矩形范围与凸包
- 点命中判断
- 序列化/渲染抽象接口

### 2.2 代表对象

- `PolygonObject`
  - 已实现点集管理、变换后点缓存、凸包/矩形更新、命中判断（绳钉算法）、渲染。
- `StrokeObject`
  - 已实现轨迹点管理、平滑插点、凸包与包围盒更新、渲染。
- `TextObject`
  - 已有基础文本属性与渲染；自动分行逻辑仍是占位实现。

## 3. tools/

### 3.1 设计定位

工具是设备与白板交互的媒介，并支持“工具栈”概念（文档层已定义）。

### 3.2 当前代码状态

- 基类 `Tool`、创建工具基类 `ObjectCreatorTool`、控制杆基类 `Controller` 已具备。
- 已有可用子类：
  - `StrokeCreatorTool`
  - `PolygonCreatorTool`
  - `PolygonModifierTool`
- 仍未完整：
  - chooser/eraser/board 工具大多为空或仅占位
  - 多个工具文档为空，尚未与实现同速更新

## 4. hit/

### 4.1 设计目标

`operation-document.md` 与 `undo-tree-document.md` 规划了：

- 原子操作 / 分子操作
- 支持分支撤销的 Undo Tree
- attempt 与 vip 等扩展概念

### 4.2 当前状态

- `operation.js` 与 `undo-tree-core.js` 仅有类骨架。
- 实际历史操作记录、回放、压缩与落盘逻辑尚未实现。

## 5. devices/

- `Device` 为输入设备抽象。
- `DebuggerDevice` 提供调试占位实现。
- 与工具系统、事件系统的完整对接尚未出现。

## 6. utils/ 与 range/

### 6.1 DirectedGraph

`DirectedGraph` 是当前 Core 最稳定的底层模块之一，包含：

- 节点/边增删改查
- 入度出度与零入度/零出度查询
- DAG 判定
- 序列化与反序列化
- 图等价比较

### 6.2 几何算法

`math-algorithm.js` 包含：

- 凸包计算（Graham 扫描）
- 曲线插点（用于笔画平滑）
- 绳钉求交（点在多边形内判断）

### 6.3 其他

- `CounterPool`：对象/页面 id 递增池
- `RectangleRange`：矩形范围抽象与矩阵变换
