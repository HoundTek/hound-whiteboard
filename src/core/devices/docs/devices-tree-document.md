# 设备树

## 概述

DevicesTree 是 Core 输入系统的唯一分发引擎。

它只做四件事：

- 按路径保存节点层级
- 在目标节点上执行 handler
- 在需要时沿 defaultChild 继续转发
- 为节点提供显式 state 与卸载钩子
- 为节点保存轻量职责语义，例如 prefix / tool

DevicesTree 本身不是设备语义的来源。它只负责把信号沿路径传递给节点，执行节点 handler，并根据 defaultChild 继续分发。是否把一个子树视作“键盘”、“触摸屏”或“调试器”，由设备定义和 handler 语义决定。

## 角色边界

DevicesTree 负责：

- 路径解析与递归分发
- 节点配置的运行时更新
- 工具节点和结构化设备子树的挂载与卸载
- 为 handler 提供 eventContext、runtimeContext、getNodeState、setNodeState

DevicesTree 不负责：

- 从 DOM 事件直接生成设备信号
- 决定业务工具如何修改对象
- 推断某个输入应该进入哪个 Monitor

## 节点模型

每个 DevicesTreeNode 只描述一个路径节点。

节点上的可变内容有：

- handler：当前节点的处理函数
- semantics：当前节点的职责语义元数据
- defaultChild：默认子链路名称，不是绝对路径
- umount：节点卸载时的清理钩子
- state：节点私有状态

这里的 `semantics` 不是“节点类型系统”。

- DevicesTree 里的所有节点仍然都是 DevicesTreeNode
- 修饰节点（prefix node）只是 `semantics.prefix === true` 的职责视角
- tool node 也只是 `semantics.tool === true` 的职责视角

handler 的输入是 SignalPacket，输出可以是：

- 单个包
- 多个包
- 普通对象，后续会被规整为 SignalPacket
- null、undefined 或空数组，表示当前链路结束

## 处理上下文

handler 的第二个参数是 DevicesTreeHandlerContext，包含：

- eventContext：当前事件上下文，只读
- runtimeContext：Board、Monitor、对象分配器等运行时资源
- getNodeState(path?)：读取任意节点状态，默认读当前节点
- setNodeState(path, state)：写入任意节点状态

eventContext 的核心字段有：

- path：当前正在处理的节点绝对路径
- semantics：当前节点语义元数据快照
- defaultChild：当前节点声明的默认子链路
- resolvedDefaultChildPath：当前默认子链路对应的绝对路径
- depth：当前递归分发深度
- node：当前节点实例
- tree：所属 DevicesTree

## 路由规则

一次 dispatch 的处理顺序如下：

1. 按包上的 to 找到目标节点
2. 若目标节点不存在，直接返回规整后的输入包
3. 执行目标节点 handler，得到下一批包
4. 若下一包未显式声明 to，且当前节点存在可达的 defaultChild，则自动继续路由到该子节点
5. 若下一包仍然指向当前节点自身，则停止递归并返回结果

这意味着 defaultChild 只是“缺省继续链路”，不是强制跳转。显式返回的 to 始终优先。

## 修饰节点语义

修饰节点（prefix node）是信号链路中的前置处理层。

它常见的职责包括：

- 记录或监视经过当前节点的信号
- 注入或改写信号字段
- 维护局部状态机
- 决定当前信号应路由到哪个子节点

当前实现里，prefix 不需要新的节点类。

- 结构化设备定义可通过 `prefix(handler, semantics)` 标记修饰节点语义
- 运行时 eventContext 会暴露当前节点的 semantics
- 子节点回送到修饰节点时，仍然直接复用既有 `SignalPacket.to` 路径机制

## 挂载模型

当前推荐的挂载方式有三类：

- mount(path, handler, options)：挂载普通节点
- mountTool(path, tool, toolContext)：挂载显式工具叶子
- mountSubTree(basePath, subTreeDefinition, runtimeContext)：挂载结构化输入子树

工具节点路径现在要求显式写出最终叶子，例如 /monitor/main/mouse/pointer/tool。

## 结构化子树定义

结构化子树统一为 root + nodes：

```js
const subTree = createSubTree("/keyboard/tools/create-circle")
  .node("")
  .prefix(randomPrefixHandler)
  .defaultChild("params")
  .node("params")
  .prefix(circleParamPrefixHandler)
  .defaultChild("tool")
  .node("tool")
  .tool(circleTool)
  .end()
  .end()
  .end()
  .build();
```

其中：

- root 是子树根路径
- nodes 是一棵结构化节点树
- 节点可继续声明 children、handler、prefix、semantics、defaultChild、tool、toolContext、umount
- 子树还可以通过 expose() 暴露 resetState()、getState() 等子树级 API
- 嵌套 `node()` 会以当前节点为锚点继续向下构建子节点

## 运行时更新

configureNode(path, options) 支持在不重挂载的情况下修改节点：

- 传入 handler 可替换处理器
- 传入 handler: null 可清空处理器
- 传入 semantics 可替换节点职责语义
- 传入 defaultChild 可替换默认子链路
- 传入 defaultChild: "" 或 null 可清空默认子链路
- 传入 umount 可替换卸载逻辑

## 卸载语义

当前有两种卸载方式：

- unmount(path)：卸载某个节点及其整棵子树
- unmountLeaf(path)：从锚点出发，沿 defaultChild 链找到最末端节点并卸载它

工具卸载走 unmountTool(path)，本质上是对显式工具节点调用 unmount。

## 设计约束

- Board 持有唯一 DevicesTree 实例
- Monitor 只做代理入口，不再拥有独立设备树
- 工具共享状态必须显式写入节点 state，不再依赖隐式上下文对象
- handler 与 tool 不能在同一结构化节点上同时声明
- 显式路径优先于 defaultChild 推断

## 当前状态

当前 DevicesTree 已完成以下收敛：

- 结构化子树统一为 createSubTree(root).build()
- builder 已支持 prefix(handler) 与嵌套 node() 链式写法
- 工具挂载统一为显式叶子路径
- 节点处理统一为 handler
- 修饰节点语义通过 semantics 元数据与复用 helper 表达，不引入新的节点类
- 节点状态统一为 getNodeState 和 setNodeState
- Board 到 Tool 的端到端输入链路已经按新模型验证通过

## 相关文档

- [设备定义](./device-document.md)
- [设备树示例](./devices-tree-example.md)
- [工具基类](../../tools/tool-document.md)
- [Core 输入流](../../docs/core-input-flow.md)
