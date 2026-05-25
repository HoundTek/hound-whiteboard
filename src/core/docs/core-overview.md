# HoundWhiteboard Core 总览

## 1. App 分层概览

当前工程可以粗分为三层：

1. Electron 主进程层
2. 模板/渲染层
3. Core 领域层

其中：

- 主进程入口在 `src/main.js`，负责窗口生命周期、IPC 注册、白板文件打开/保存调度。
- 业务管理组件在 `src/components/`（如板文件管理、模板管理、设置管理）。
- Core 在 `src/core/`，负责白板领域模型本身（区块、对象、工具、层级关系、历史结构）。

## 2. 主流程（从启动到打开白板）

### 2.1 启动

应用启动后，主进程会初始化：

- 设置管理器
- 白板类（主进程版本）
- 模板管理器

随后创建主菜单窗口，并挂载 IPC 通道。

### 2.2 新建/打开白板

主进程侧 `board` 负责：

- 创建 `.hwb` 结构（meta/config/chunks/templates 等）
- 打开 `.hwb`（解压到临时目录）
- 保存白板（压缩回 `.hwb`）

这部分以文件系统与窗口切换为主，属于“宿主调度层”。

### 2.3 Core 介入点

Core 层中的 `Board`（`src/core/components/board.js`）是领域管理器，目标负责：

- 区块生命周期与加载策略
- 对象增删改与层叠关系
- 活动对象状态
- Undo Tree 历史

当前代码中，该类骨架与主要字段已建立，部分流程仍在实现中。

## 3. Core 目录职责

- `components/`: 白板、区块、活动对象等管理器
- `objects/`: 各类领域对象（笔画、多边形、文本、容器）
- `tools/`: 工具体系，作为设备节点之后的信号消费单元
- `hit/`: 历史与回溯树（Undo Tree）
- `devices/`: 设备子树定义、设备树节点处理与 Core-UI Interface 信号边界
- `utils/`: 核心专用算法与数据结构（图、几何算法、计数池）
- `range/`: 选择与碰撞相关范围抽象
- `docs/`: 核心说明文档

## 4. 设计与实现的差异（现状）

当前 Core 特征：

- 设计文档较完整：
  - 设备子树、设备树节点与工具消费链模型
  - 活动对象层叠图（静态图 + 动态层）
  - Undo Tree 与历史组织
  - `.hwb` 文件结构
- 实现完成度不均：
  - 已具备：`DirectedGraph`、基础对象体系、部分创建工具、活动对象管理核心算法、设备树节点处理模型
  - 待完善：区块对象持久化细节、Undo Tree 具体操作、工具消费链落地、多模块联调

当前对象模型还有一个关键变化：`PolygonObject`、`StrokeObject`、`TextObject` 已统一转向 range-first 表达。对象内部不再把普通点数组当作主判定结构，而是分别维护局部范围、世界范围、凸包范围与包围盒。

## 5. 相关流程文档

- 输入信号从 Board 进入 Monitor、DevicesTree，再进入工具节点的路径，见 `core-input-flow.md`。
- DOM/Pointer/Touch 到 `SignalPacket` 的编码约定，见 `core-input-encoding.md`。
- 当前阶段建议冻结的核心接口，见 `core-stable-interfaces.md`。
