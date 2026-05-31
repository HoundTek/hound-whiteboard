# 设备图

## 概述

DevicesDAG 是 Core 输入系统唯一的分发引擎。

当前模型已经收敛为一张有向无环图：

- `dispatch()` 从根节点开始，按 `SignalPacket.to` 的每一段沿边向下走
- 每个命中的节点都可以执行自己的 `handler`
- `handler` 只能把后续包继续发给当前节点的后继节点
- 累积上下文通过 `context` 沿当前路由链逐层追加，不能覆盖已有键
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
- 判断某个输入属于哪个 Monitor
- 决定业务工具如何修改对象或视口

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

`handler` 的输入是 `SignalPacket`，输出会被规整为 `DevicesDAGHandlerResult`。稳定结果字段是：

- `packets`：继续向下路由的包列表
- `context`：要追加到累积上下文的键值对
- `redirect`：改写当前主链下一段路径
- `stop`：强制终止当前链路

## 处理上下文

`handler` 的第二个参数是平面化的 `DevicesDAGHandlerContext`，核心字段包括：

- `path`：当前节点的活动路径
- `semantics`：当前节点职责语义快照
- `defaultRoute`
- `resolvedDefaultRoutePath`
- `depth`
- `signalPacket`
- `context`：累积上下文
- `getNodeState(pathOrId?)`
- `setNodeState(pathOrId, state)`

这里有两条边界需要明确：

- `context` 是逐层追加的只读视图。上游节点可通过返回 `{ context: { key: value } }` 注入数据，下游节点只能读取，不能覆盖已有键。
- 需要可变共享数据时，应显式写入节点 `state`。例如对象桥接、拖拽锚点、局部状态机都应落在节点状态里。

如果一条链路需要“向上通知”，当前推荐做法不是返回向上的 `to`，而是在 `context` 里注入回调函数，例如 `onToolComplete`。

## 路由规则

一次 `dispatch()` 的稳定行为如下：

1. 从根节点出发，按 `packet.to` 的路径段逐层查找出边。
2. 每经过一个实际命中的子节点，都先执行该节点的 `handler`。
3. `handler` 返回的 `packets.to` 必须是从当前节点继续向下的相对路径。
4. 若主包没有显式 `to`，而当前节点声明了 `defaultRoute`，则沿该默认出边继续。
5. 若 `handler` 返回多个包，dispatcher 会保留返回顺序，先完成主链，再按顺序处理额外包。
6. 若某一段路径不存在，则当前链路在该处终止，并返回已收集结果或一个 `to: ""` 的叶子包。
7. 若返回 `stop: true`，则当前链路立即结束。
8. 同一节点可被多条路径命中，但单次 dispatch 的 `context` 只沿当前路由链累积。

## 修饰节点语义

修饰节点是链路中的前置处理层。常见职责包括：

- 记录或监视经过当前节点的信号
- 注入或改写信号字段
- 维护局部状态机
- 决定当前信号应路由到哪个子节点
- 通过 `context` 注入回调，把局部决策传给下游节点

当前实现里，prefix 不需要新的节点类。

- 结构化子图通过 `prefix(handler, semantics)` 声明修饰节点语义
- 调试和文档层通过 `semantics.prefix` 识别该职责
- 真正的控制逻辑仍由 `handler` 和节点状态决定

### routePolicy 语义标签

`routePolicy` 是 `semantics` 上的一个文档性标签，描述该修饰节点的信号策略意图。它**不参与 DAG 分发引擎的决策**，仅用作调试、日志和未来扩展的预留点位。

当前使用的取值：

| 值                | 含义                                   | 示例                                                                                        |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `"inject"`        | 拦截上游信号后从零生成新信号注入子节点 | `random-circle-generator`：拦截 trigger → 随机计算 position/radius/property → 注入给 params |
| `"transform"`     | 接收上游信号做变换后转发               | `circle-params`：接收 position+radius → 变换为三阶段信号的 sequence                         |
| `"state-machine"` | 节点维护局部状态机，按状态决定路由     | `handoff-handler`：根据 phase 状态在不同子节点间切换                                        |

`prefixKind` 则是更细粒度的业务角色标签（如 `"random-circle-generator"`、`"circle-params"`），用于在日志/调试中快速识别前缀节点类型。

## 挂载模型

当前推荐的挂载方式有三类：

- `mount(path, handler, options)`：挂载普通运行时节点
- `mountWorkflow(path, workflow, workflowContext)`：挂载 workflow 节点
- `mountSubDAG(basePath, subDAGDefinition, mountContext)`：挂载结构化输入子图

### Workflow 挂载约定

workflow 节点统一挂载到 `/<monitorId>/workflows/` 路径下，通过有向边与设备节点连接。

这里的 workflow 有两种等价形态：

- 单个 Tool 入口
- 由 prefix + tool 组成的单源 SubDAG

这样做的好处：

- **生命周期解耦**：workflow 不挂在设备子树内，不会随设备卸载被意外释放
- **统一管理**：遍历 `/workflows/` 即可拿到当前 monitor 的所有 workflow
- **多前驱自然**：多键位或多通道汇聚到同一 workflow 时，多入边是 DAG 原生能力
- **子图封装**：prefix + tool 的整体工作流可以完整地埋到 `/workflows/` 下

设备节点通过 `addEdge` 与 workflow 节点连接：

- **1:1** 场景：设备节点声明 `defaultRoute`，通过出边指向 `/workflows/` 下的 workflow 节点
- **多:1** 场景：各设备节点各出一条同名边，汇聚到同一个 workflow 节点
- **1:多** 场景：由设备节点 handler 做 fan-out 分发

典型映射：

```
/<monitorId>/mouse/primary --"tool"--> /<monitorId>/workflows/primary-stroke
/<monitorId>/keyboard/code/KeyW --"wasd"--> /<monitorId>/workflows/wasd-move
/<monitorId>/keyboard/code/Space --"create-circle"--> /<monitorId>/workflows/create-circle
```

`mountWorkflow` 的第一个参数现在是 workflow 在 `/workflows/` 下的路径，不再是设备子路径。设备节点与 workflow 的连接通过 `addEdge` 在 wiring 层完成。

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
monitor.addEdge(
  "/keyboard/code/Space",
  "create-circle",
  "/workflows/create-circle",
);
```

键位节点收到的 `trigger` 信号会沿 `create-circle` 边进入 workflow 子树，经 prefix 处理后由末端工具消费。

## 设计约束

- Board 持有唯一 `DevicesDAG` 实例
- Monitor 只做代理入口，不再拥有独立设备路由器
- 路由始终逐层向下，不支持向上或跨兄弟节点跳转
- 工具共享状态必须显式写入节点 `state`
- 累积上下文只能追加，不能覆盖
- `handler` 与 `tool` 不能在同一结构化节点上同时声明
- 节点身份由 id 决定，路径只是一条可达路由表示

## 相关文档

- [设备定义](./device-document.md)
- [设备图示例](./devices-dag-example.md)
- [工具基类](../../tools/tool-document.md)
- [Core 输入流](../../docs/core-input-flow.md)
