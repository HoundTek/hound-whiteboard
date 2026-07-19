# 设备图

## 概述

DevicesDAG 是 Core 输入系统唯一的分发引擎。

当前模型已经收敛为一张有向无环图：

- `dispatch()` 从根节点开始，按 `SignalPacket.to` 的每一段沿边向下走
- 每个命中的节点通过 `DevicesDAGNode.dispatch` 递归路由到子节点
- 每个命中的节点都可以执行自己的 `handler`
- `handler` 只能把后续包继续发给当前节点的后继节点
- 静态服务上下文通过节点 `services` 声明式注入，沿 DAG 路径累积
- 累积上下文通过 handler 返回值 `acc` 逐层追加，不能覆盖已有键
- 静态基础设施依赖通过节点 `services` 声明式注入
- 需要可变共享数据时使用节点 `state`
- 同一个节点允许被多条路径到达，节点状态按节点身份共享，而不是按路径复制

DevicesDAG 不负责定义“什么是鼠标”“什么是键盘”。它只负责保存图结构、执行节点处理器，并把包继续向下送给下一段路径。

## 角色边界

DevicesDAG 负责：

- 路径解析与逐段下传
- `defaultRoute` 的缺省继续链路
- 运行时节点配置更新
- workflow 节点和结构化子图的挂载与卸载
- 为 `handler` 提供统一的平面上下文与节点状态接口
- 在多路径可达时，保证一次分发只沿当前命中的那条路径累积上下文

DevicesDAG 不负责：

- 从 DOM 事件直接生成设备信号
- 判断某个输入属于哪个 Viewport
- 决定业务工具如何修改对象或视口

## 节点路由能力

`DevicesDAGNode` 自带完整的递归路由能力。核心路由逻辑由 `DevicesDAGNode.dispatch` 实现：

- `node.dispatch(packet, options)` — 调用节点 handler 后按结果沿出边递归路由
- `node._routeFrom(packet, options)` — 不调 handler，仅沿边路由到子节点（用于延迟路由）
- `DevicesDAGNode._buildHandlerContext(packet, opts)` — 统一构建 handler 上下文

`DevicesDAG.dispatch()` 是此机制的入口点：从 ghost 节点出发，沿 `/` 出边走到根节点后递归下钻。

## 节点模型

每个 `DevicesDAGNode` 只描述一个路由节点。

节点上的可变内容包括：

- `handler`：当前节点处理器
- `semantics`：当前节点职责语义元数据
- `defaultRoute`：默认出边名，不是绝对路径
- `umount`：节点卸载时的清理钩子
- `state`：节点私有状态

这里的 `semantics` 不是新的类型系统。

- 图里所有节点仍然都是 `DevicesDAGNode`
- 修饰节点只是 `semantics.prefix === true` 的职责标记
- 工具节点只是 `semantics.tool === true` 的职责标记

`handler` 的输入是 `SignalPacket`，输出会被规整为 `DevicesDAGHandlerResult`。

### 结果规整

handler 的原生返回值可以是多种形式——单个 `SignalPacket`、数组、纯对象、`undefined` 等——但分发引擎只认经过 `normalizeHandlerResult()` 规整后的四个**稳定结果字段**：

| 字段       | 类型             | 含义                           | 对分发引擎的影响                                                     |
| ---------- | ---------------- | ------------------------------ | -------------------------------------------------------------------- |
| `packets`  | `SignalPacket[]` | 继续路由到后继节点的信号包列表 | 第一个包作为主包继续下传；其余排入延迟路由队列，待主链结束后依次分发 |
| `acc`      | `Object`         | 要追加到累积上下文的键值对     | 合并到累积上下文供下游节点读取；已有键重复则抛错                     |
| `redirect` | `string`         | 改写主链接下来的路径段         | 把当前路径的剩余段全部替换为指定路径，继续分发                       |
| `stop`     | `boolean`        | 强制终止当前链路               | 立即结束当前链路，不再向下路由                                       |

这些字段的组合行为如下（均为 `DevicesDAGNode.dispatch` 内的稳定行为）：

**1. `packets` 路由规则**

- handler 返回了 `packets`，则提取第一个作为主包继续主链，其余放入延迟路由队列
- 主包的 `to` 字段决定下一段路径；若无 `to` 且节点有 `defaultRoute`，则走默认出边
- 若 handler 显式返回空 `packets`（`return { packets: [] }`），则终止当前链路
- 若 handler 无返回值（未显式声明 packets），链路按默认行为继续

**2. `stop` 优先级**

- `stop: true` 立即终止当前链路，无视 `redirect` 和后续路径段
- 停止前已产生的 `packets` 仍会正常路由

**3. `redirect` 与默认出边**

- `redirect` 的优先级高于主包 `to` 和节点 `defaultRoute`
- `redirect` 和主包 `to` 同时存在时，后者覆盖前者（redirect 先作用，主包 to 再覆盖）

**4. `acc` 合并规则**

- 仅在当前节点追加，不可覆盖已有键（重复键抛错）
- 即使当前链路因 `stop` 或边缺失而终止，累积的上下文仍会随结果返回

### 返回值样例

```js
// 基础：继续走默认出边
return { packets: [new SignalPacket("", packet.signals)] };

// 注入路由参数给下游节点
return { acc: { autoCommit: false } };

// 改写后续路由
return { redirect: "alternate-child" };

// 多路分发：主包走 redirect，额外包排入延迟队列
return {
  redirect: "primary-child",
  packets: [
    new SignalPacket("", packet.signals),
    new SignalPacket("secondary-child", extraSignals),
  ],
};

// 终止
return { stop: true };
```

## 处理上下文

`handler` 的第二个参数是平面化的 `DevicesDAGHandlerContext`，核心字段包括：

- `path`：当前节点的活动路径
- `semantics`：当前节点职责语义快照
- `defaultRoute`：默认路径
- `resolvedDefaultRoutePath`
- `depth`：当前路由深度
- `signalPacket`：当前信号包
- `services`：静态服务上下文
- `acc`：累积上下文（仅包含动态路由参数）
- `getNodeState(pathOrId?)`
- `setNodeState(pathOrId, state)`

这里有两条原则需要明确：

- `services` 是声明式的——由节点定义注入，handler 返回值无法写入。
- `acc` 是逐层追加的只读视图。上游节点可通过返回 `{ acc: { key: value } }` 注入参数，下游节点只能读取，不能覆盖已有键。
- `acc` 不包含 `services` 中的静态基础设施依赖，新代码应分别使用 `services` 与 `acc`。
- 需要可变共享数据时，应显式写入节点 `state`。例如对象桥接、拖拽锚点、局部状态机都应落在节点状态里。

如果一条链路需要"向上通知"，推荐做法是使用事件钩子（如 `action:complete`），或在 `acc` 中传递回调函数。

## 状态模型与约定

设备图中有四种不同作用域的可变状态，各自遵循不同的读写规则和生命周期。

### 四种状态

| 状态类别           | 存储位置                  | 作用域                        | 读写规则                           | 生命周期             |
| ------------------ | ------------------------- | ----------------------------- | ---------------------------------- | -------------------- |
| **静态服务上下文** | `handlerContext.services` | 沿 DAG 路径静态累积           | 节点定义注入，handler 只读         | 节点存续期间         |
| **累积上下文**     | `handlerContext.acc`      | 当前分发链路                  | 上游注入，下游只读；不可覆盖已有键 | 单次 `dispatch`      |
| **节点状态**       | `DevicesDAGNode.state`    | 全图可读；由节点 handler 拥有 | 外部优先只读；写入由 handler 控制  | 节点存续期间         |
| **闭包状态**       | handler 工厂闭包          | 仅 handler 自身可访问         | 彻底私有，外部不可见不可写         | handler 实例存续期间 |

### 状态的分工

**静态服务上下文** 适合放：

- 共享资源引用（`board`、`boardApi`、`viewport`）
- 任何与路由决策无关的只读基础设施依赖

**累积上下文（acc）** 适合放：

- 链路级一次性控制标志（`autoCommit`、`autoUmountOnApply`）
- 链路级临时参数（`resolvePosition`、`objectId`）

**节点状态** 适合需要长期维护且允许外部观察的数据：

- 拖拽锚点位置（`anchor`）
- 状态机相位（`phase`、`activeChild`）
- 跨 handler 配置切换后仍需保留的状态
- 测试断言、序列化、调试日志需要读取的数据

**闭包状态** 适合 handler 的纯内部实现细节：

- 配置常量（`displacementSignalType`）
- 懒初始化的重量级处理器（tool `processor`）
- 临时缓存，不需要暴露给外部

### 节点状态的写入约定

节点状态是**拥有者发布的只读投影**（真理源在拥有者的闭包 / 实例字段）。读写规则如下：

- **读取**：任何代码可以通过 `dag.getNodeState(path)` 或 `handlerContext.getNodeState(path)` 读取任意节点的状态。这是节点状态区别于闭包状态的核心价值——可外部观察。
- **发布（写入自身）**：handler 通过 `handlerContext.setNodeState(handlerContext.path, state)` / `patchState` 发布自己节点的投影。这是唯一合法的写入方式。
- **跨节点写入**：禁止。`ctx.setNodeState` / `ctx.delNodeState` 写入非自身节点时，strict 模式抛错，非 strict 模式经 log 工具告警。需要影响其他节点时，应通过信号、事件或 `acc` 传递，而不是直接改对方状态。
- **外部写入**：非 handler 代码不应直接调用 `dag.setNodeState()` 写入——投影由拥有者发布，外部写入不产生真实效果，且会被下次发布覆盖。

简而言之：闭包管对错（真理源），state 管看见（只读投影）。

## 路由规则

一次 `dispatch()` 的稳定行为如下：

1. 从根节点出发，按 `packet.to` 的路径段逐层查找出边。
2. 每经过一个实际命中的子节点，都先执行该节点的 `handler`。
3. `handler` 返回的 `packets.to` 必须是从当前节点继续向下的相对路径。
4. 若主包没有显式 `to`，而当前节点声明了 `defaultRoute`，则沿该默认出边继续。
5. 若 `handler` 返回多个包，dispatcher 会保留返回顺序，先完成主链，再按顺序处理额外包。
6. 若某一段路径不存在，则当前链路在该处终止，并返回已收集结果或一个 `to: ""` 的叶子包。
7. 若返回 `stop: true`，则当前链路立即结束。
8. 同一节点可被多条路径命中，但单次 dispatch 的 `acc` 只沿当前路由链累积。

## 修饰节点语义

修饰节点是链路中的前置处理层。常见职责包括：

- 记录或监视经过当前节点的信号
- 注入或改写信号字段
- 维护局部状态机
- 决定当前信号应路由到哪个子节点
- 通过 `acc` 注入回调，把局部决策传给下游节点

当前实现里，prefix 不需要新的节点类。

- 结构化子图通过 `prefix(handler, semantics)` 声明修饰节点语义
- 调试和文档层通过 `semantics.prefix` 识别该职责
- 真正的控制逻辑仍由 `handler` 和节点状态决定

### routePolicy 语义标签

`routePolicy` 是 `semantics` 上的一个文档性标签，描述该修饰节点的信号策略意图。它**不参与 DAG 分发引擎的决策**，仅用作调试、日志和未来扩展的预留点位。

当前使用的取值：

| 值                | 含义                                      | 示例                                                                                        |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `"inject"`        | 拦截上游信号后从零生成新信号注入子节点    | `random-circle-generator`：拦截 trigger → 随机计算 position/radius/property → 注入给 params |
| `"transform"`     | 接收上游信号做变换后转发                  | `circle-params`：接收 position+radius → 变换为三阶段信号的 sequence                         |
| `"state-machine"` | 节点维护局部状态机，按状态决定路由        | `handoff-handler`：根据 phase 状态在不同子节点间切换                                        |
| `"inspect"`       | 被动观测/记录信号元数据，原样转发给子节点 | `debug` prefix：记录 entryIndex/path/originalTo 后原样路由到 report 子节点                  |

`prefixKind` 则是更细粒度的业务角色标签（如 `"random-circle-generator"`、`"circle-params"`），用于在日志/调试中快速识别前缀节点类型。

## 挂载模型

当前推荐的挂载方式有三类：

- `mount(path, handler, options)`：挂载普通运行时节点
- `mountWorkflow(path, workflow)`：挂载 workflow 节点
- `mountSubDAG(basePath, subDAGDefinition)`：挂载结构化输入子图

### Workflow 挂载约定

workflow 节点统一挂载到 `/<viewportId>/workflows/` 路径下，通过有向边与设备节点连接。

这里的 workflow 有两种等价形态：

- 单个 Tool 入口
- 由 prefix + tool 组成的单源 SubDAG

这样做的好处：

- **生命周期解耦**：workflow 不挂在设备子树内，不会随设备卸载被意外释放
- **统一管理**：遍历 `/workflows/` 即可拿到当前 viewport 的所有 workflow
- **多前驱自然**：多键位或多通道汇聚到同一 workflow 时，多入边是 DAG 原生能力
- **子图封装**：prefix + tool 的整体工作流可以完整地埋到 `/workflows/` 下

设备节点通过 `addEdge` 与 workflow 节点连接：

- **1:1** 场景：设备节点声明 `defaultRoute`，通过出边指向 `/workflows/` 下的 workflow 节点
- **多:1** 场景：各设备节点各出一条同名边，汇聚到同一个 workflow 节点
- **1:多** 场景：由设备节点 handler 做 fan-out 分发

典型映射：

```
/<viewportId>/mouse/primary --"tool"--> /<viewportId>/workflows/primary-stroke
/<viewportId>/keyboard/code/KeyW --"wasd"--> /<viewportId>/workflows/wasd-move
/<viewportId>/keyboard/code/Space --"create-circle"--> /<viewportId>/workflows/create-circle
```

`mountWorkflow` 的第一个参数现在是 workflow 在 `/workflows/` 下的路径，不再是设备子路径。设备节点与 workflow 的连接通过 `addEdge` 在 wiring 层完成。

需要把工具挂到子图内部的已存在节点（如 tool-switcher 的透传子节点）时，`InputScope.mountWorkflow` 的 name 支持嵌套路径（如 `"tool-switcher/stroke"`），同样走完整挂载契约。

> **handler 写入约定**：节点的 `handler` 只允许通过 `mountWorkflow`（或子图定义中的 `builder.node().handler()`）写入。禁止直接给 `node.handler` 赋值——那会绕过 tool 实例注册与 umount 钩子链，导致卸载行为不一致。

### 独立子图实例化

`DevicesDAGNode.createGraph(subDAGDef)` 从子图定义创建独立的节点图，不挂载到任何 DAG。每次调用都创建全新节点实例，适合 per-touch 子图等需要多份独立副本的场景。

```js
const builder = createSubDAG("/touch");
builder.node().tool(
  new StrokeCreatorTool({
    property: { color: "#ff0000", width: 2 },
  }),
);
DevicesDAGNode.createGraph(builder.build());
```

与 `mountSubDAG` 的区别：

- `createGraph` 创建脱离 DAG 的独立节点，不注册到全局节点表
- `createGraph` 不分配全局节点 id，使用子图定义的局部 id
- `createGraph` 不注册 tool 实例到 DAG 的全局工具表（tool 通过 `createProcessor()` 转为 handler）
- `mountSubDAG` 将节点挂到 DAG 中，支持路径查找和多路径可达

## 结构化子图定义

结构化子图统一为 `rootPath + nodes + edges`：

```js
const builder = createSubDAG("/workflows/create-circle");
const root = builder.node().prefix(randomPrefixHandler).defaultRoute("params");
const params = builder
  .node()
  .prefix(circleParamPrefixHandler)
  .defaultRoute("circle-creator");
const tool = builder.node().tool(circleTool);

builder.edge("params", root, params);
builder.edge("circle-creator", params, tool);

const subDAG = builder.build();
```

这个子图通过一条边挂在 `code/Space` 下：

```js
viewport.addEdge(
  "/keyboard/code/Space",
  "create-circle",
  "/workflows/create-circle",
);
```

键位节点收到的 `trigger` 信号会沿 `create-circle` 边进入 workflow 子树，经 prefix 处理后由末端工具消费。

## 设计约束

- Board 持有唯一 `DevicesDAG` 实例
- Viewport 只做代理入口，不再拥有独立设备路由器
- 路由始终逐层向下，不支持向上或跨兄弟节点跳转
- 工具共享状态必须显式写入节点 `state`
- 累积上下文只能追加，不能覆盖
- `handler` 与 `tool` 不能在同一结构化节点上同时声明
- 节点身份由 id 决定，路径只是一条可达路由表示
- `addEdge()` 和 `mountSubDAG()` 在形成环时直接抛错，不允许构造 cyclic 图
- DAG handler 必须是同步函数；返回 Promise 会在 strict 模式下抛错，非 strict 模式下经 log 工具告警后忽略
- `DevicesDAG` 构造选项 `strict: true` 时，handler 报错直接抛出；非 strict 模式下经 log 工具（`utils/log`）记录后继续
- `dispose` / `umount` 钩子抛错不中断卸载链，错误经 log 工具按 WARN 级记录

## 相关文档

- [handler 上下文（ctx）用法](./handler-context-document.md)
- [状态模型](./state-model-document.md)
- [设备定义](../devices/docs/device-document.md)
- [设备图示例](./devices-dag-example.md)
- [对象创建工具](../tools/creator/docs/object-creator-document.md)
- [对象选择工具](../tools/chooser/docs/object-chooser-document.md)
- [对象修改工具](../tools/modifier/docs/object-modifier-document.md)
- [Core 输入流](../../../docs/core-input-flow.md)
