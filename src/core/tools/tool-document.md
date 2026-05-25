# 工具文档

本文档说明白板工具系统的核心设计、设备上下文共享规则和当前实现约定。

## 工具的定义

工具是挂载在设备树末端的消费型处理器。它接收设备树路由后的完整信号包，并直接修改白板、对象或相关状态。

常见挂载点示例：

- `/main/mouse/primary/tool`
- `/main/stylus/pen/tool`
- `/main/keyboard/code/KeyW/tool`

工具默认只负责消费信号，不再负责默认继续转发；若需要路由或信号改写，应该由设备树节点处理器或 `rewritePacket` 完成。

当前实现中有一类特殊的“上下文提供型工具”：

- 对象选择工具
- handoff 模式下的对象创建工具

它们会先把对象写入上下文，再将后续信号转发给自己下方的 modifier 子工具。也就是说，真正修改对象的 modifier 节点，其父节点必须是一个能把对象放进上下文的节点。

## 信号包接口

工具系统统一采用如下信号包格式：

```javascript
{
  to: String,
  signals: Array<{
    type: String,
    context: *,
  }>
}
```

工具的 `process(signalPacket, deviceContext)` 一次接收一个完整信号包。

这意味着：

- 工具无需逐条处理单个信号，而是处理整包语义。
- 一个包内可以包含多个类型信号，如 `position`、`transform`、`end`、`cancel`。
- 设备层负责把硬件输入转成语义信号，工具只关心业务语义。

## `createProcessor()` 与挂载机制

工具挂载流程为：

1. 工具实现 `process(signalPacket, deviceContext)`
2. 调用 `tool.createProcessor(toolContext)` 生成设备树节点处理器
3. 通过 `board.signalsEventBus.emit("mount", { to, tool })` 挂载工具
4. 通过 `board.signalsEventBus.emit("umount", { to })` 卸载工具

`createProcessor()` 的要点：

- 首先把输入规整为 `SignalPacket`
- 将上游 `routeContext` 与传入的 `toolContext` 合并为共享 `deviceContext`
- 默认注入 `allocateObjectId` 和 `resolveOwnerChunkId` 等辅助函数

因此工具内部可直接访问：

- `path`：当前工具节点绝对路径
- `node`：当前设备树节点
- `tree`：所属 `DevicesTree`
- `depth`：当前分发深度
- `board`：当前白板实例
- `monitor`：当前 Monitor 实例
- `allocateObjectId()`：默认转发到 `Board.allocateObjectId()`
- `resolveOwnerChunkId(position)`：默认通过 `Monitor.worldToChunk()` 解析归属区块

如果业务层传入了额外 `toolContext`，这些字段也会被合并入 `deviceContext`。

## 设备上下文的共享与生命周期

当前设备树支持父节点向下游继承上下文：

- `DevicesTreeNode.process()` 的 `routeContext` 是可变对象
- 父节点对它的写入会被后续子节点继承
- `Tool.createProcessor()` 会把 `routeContext` 与 `toolContext` 合并成共享 `deviceContext`

当前实现还提供节点级 `nodeContext`：

- 每个设备树节点持有一个 `context` 对象
- `DevicesTreeNode.process()` 会把该节点的 `context` 暴露给下游
- 这允许同一路径内的工具共享当前节点状态

因此，同一 dispatch 链路内的 creator / chooser -> modifier 协同模式成立：

- creator 工具创建对象后可以写入 `deviceContext.object`
- chooser 工具选择对象后也可以写入 `deviceContext.object` 或 `deviceContext.objects`
- 同一路径中的 modifier 工具可直接读取该对象
- 如果 creator 也写入 `nodeContext.object`，后续同路径挂载的工具也可读取

当前还新增了节点卸载钩子：

- 每个 `DevicesTreeNode` 都可以在被 `umount` 时执行清理逻辑
- `mountTool(...)` 挂载的工具节点会自动将工具的 `umount(deviceContext)` 绑定到该节点
- 这使得 chooser / creator / modifier 可以在节点卸载时统一做 `discard`、`reset` 或上下文清理

这些上下文仅在同一次 signal dispatch 链路中有效，不应被当作跨事件持久状态。

## 推荐约定

- Tool 只负责消费信号，不要默认继续转发
- 转发或改写语义应由设备树节点处理器实现
- 仅在当前信号流内需要共享时写入 `deviceContext`
- 各工具不要把 `deviceContext` 用作全局状态仓库
- modifier 只应修改已经在 AOM 动态图中的对象
- chooser / creator 这类 provider 节点负责把对象放入上下文，并在需要时把信号转发给下方 modifier
- 对象引用类字段推荐使用：
  - `deviceContext.object`
  - `deviceContext.objects`
  - `deviceContext.nodeContext.object`
  - `deviceContext.nodeContext.objects`

## 工具类别概览

### 对象创建工具

对象创建工具负责生成新对象，并管理对象创建过程中的连续几何变化。

其典型流程为：

1. `buildInteractionContext(signalPacket, deviceContext)` 解析输入
2. `ensureObject(interaction)` 创建对象并分配 id / ownerChunkId
3. `beginCreationGesture` / `updateCreationGesture` / `completeCreationGesture`
4. `completeCreatedObject` 或 `cancelCreatedObject`

创建工具通常会在创建阶段分别调用：

- `beforeGeometryMutation(interaction)`
- `afterGeometryMutation(interaction)`

这使得对象创建过程能够稳定支持活动层渲染和快照保护。

当前创建工具已经区分两种完成策略：

- `apply`：对象创建结束后直接调用 `AOM.apply(...)`，写回静态图
- `handoff`：对象创建结束后保持对象留在 AOM 中，并自动在当前 creator 节点下挂载对应的 modifier 子工具

`handoff` 模式下，creator 节点会转为“上下文提供节点”：

- 持续把当前对象写回 `deviceContext` / `nodeContext`
- 将后续信号继续转发给子 modifier
- 当子 modifier 收到 `apply` 信号后，由 modifier 自己提交对象并卸载

### 对象修改工具

对象修改工具负责对已有对象进行编辑，例如平移、缩放、旋转、文本改写等。

它应优先复用 `ObjectModifierTool` 基类提供的统一刷新协议：

- `resolveModifiedObjects(modificationContext, objects)`
- `resolveActiveModifiedObjects(modificationContext, objects)`
- `beforeGeometryMutation(modificationContext, objects)`
- `afterGeometryMutation(modificationContext, objects)`
- `withGeometryMutation(modificationContext, mutate, objects)`

对象修改工具当前还有一个新增约束：它修改的必须是已经在 AOM 动态图中的对象。

因此它的典型工作流是：

1. 由 chooser 或 creator 把对象放进 `deviceContext`
2. modifier 从上下文读取对象，并过滤为当前仍处于 AOM 的对象
3. 收到几何修改信号时修改对象并刷新活动层
4. 收到 `apply` 信号时调用 `AOM.apply(...)`，把对象提交回静态图并卸载自身

这可保证对象修改前后状态一致，并让活动层局部刷新更可靠。

### 对象选择工具

对象选择工具用于选择对象，如套索、矩形、点选等。它的核心职责是：

- 从白板静态图中提取对象
- 调用 `AOM.choose(...)` 将这些对象加入动态图
- 把已选对象写回上下文
- 在需要时挂载下方的 modifier 子工具

因此，对象一旦进入 AOM，就不应再被重复选择；只有在 `apply` 回静态图或被 `discard` 后，才重新回到可选集合。

### 对象擦除工具

对象擦除工具用于擦除对象的部分几何，通常与活动层/LiveRenderer 协同刷新。

## 工具职责分层

当前工具体系的职责分层如下：

- Device 负责定义设备子树、接收硬件输入并生成语义化信号包。
- 设备树节点负责按路径和状态路由信号，以及在必要时改写信号包或转发到默认子节点。
- Tool 负责消费最终送达的语义信号包，执行业务逻辑并修改白板/对象状态。
- Monitor 负责视口映射、坐标转换，以及为工具提供当前视口上下文。
- Board / Core 组件负责对象注册、区块管理、活动对象管理与最终状态持久化。

这种分层确保工具不直接承担硬件输入解析、路径路由或持久化管理。工具只负责“从语义信号到业务结果”的那一段。

## 当前实现状态

- 设备树已支持父节点修改 `routeContext` 并传递给后续节点
- `Tool.createProcessor()` 已把 `routeContext` 与 `toolContext` 共享到 `deviceContext`
- creator / chooser 工具可把对象写回 `deviceContext.object(s)`
- modifier 工具会过滤并只修改当前仍在 AOM 中的对象
- creator 已支持 `apply` / `handoff` 两种完成策略
- modifier 已支持 `apply` 信号，并会在提交后卸载自身
- 节点卸载时会自动触发工具 `umount()` 清理钩子
- `position` 信号在工具链中语义为“世界坐标”，屏幕坐标应在 Monitor/外部层转换后传入

这样，逻辑收口后，工具体系的职责更清晰，设备上下文的共享边界也更明确。
