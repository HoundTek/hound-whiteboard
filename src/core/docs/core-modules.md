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
- 包围盒、凸包范围与主判定范围
- 点命中判断
- 序列化/渲染抽象接口

### 2.2 代表对象

- `PolygonObject`
  - 已实现局部/世界多边形范围管理、凸包范围/包围盒更新、命中判断、渲染，以及 `setPolygonPoints()`、`replacePolygonPoint()`、`appendPolygonPoint()` 等对象语义接口。
- `StrokeObject`
  - 已实现局部/世界路径范围管理、平滑插点、凸包范围与包围盒更新、渲染，以及 `setPathPoints()` 等路径语义接口。
- `TextObject`
  - 已有基础文本属性、四点文本范围与渲染；自动分行逻辑仍是占位实现。

## 3. tools/

### 3.1 设计定位

工具是设备节点之后的消费单元。它接收整包信号，并对这些信号执行创建、修改、选择、擦除或白板操作等逻辑。

### 3.2 当前代码状态

- 基类 `Tool`、创建工具基类 `ObjectCreatorTool` 已具备。
- 已有可用子类：
  - `StrokeCreatorTool`
  - `PolygonCreatorTool`
  - `PolygonModifierTool`
- 仍未完整：
  - chooser/eraser/board 工具大多为空或仅占位
  - 多个工具文档为空，尚未与实现同速更新
  - 工具与设备子树之间的完整消费链还未完全接通

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

- `DevicesTree` 负责保存节点层级，并按路径把信号包送到节点处理器。
- `DevicesTreeNode` 只表示信号处理单元，本身只挂 `processor`。
- 设备子树定义目前是普通对象协议，核心入口是 `defineNodes()`。
- 业务侧挂载设备时应优先从 `Monitor` 的 `mountDevice()` 进入，再由 `Monitor` 转交给底层 `DevicesTree`。
- 输入从 Board 到 Monitor、再到 DevicesTree 与工具节点的完整链路，见 `core-input-flow.md`。
- DOM/Pointer/Touch 到 `SignalPacket` 的编码约定，见 `core-input-encoding.md`。
- 当前建议冻结的阶段性稳定接口，见 `core-stable-interfaces.md`。

当前状态：

- 节点级 `processor` 路由模型已经建立。
- 设备子树定义可展开并挂载到设备树。
- Core 内部信号通过节点处理器递归传递；处理器可来自闭包、工厂函数或对象方法。
- 跨 Core-UI Interface 的信号边界已经在文档层明确。

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
