# Core 输入链路文档

本文档描述 HoundWhiteboard 当前 Core 层的输入信号链路：输入如何从 Board 进入某个 Monitor，再进入 DevicesTree，最后到达工具节点或产出新的输出信号。

## 总览

当前输入链路可概括为：

1. UI 或外部输入源把现实输入编码成一个 `SignalPacket`
2. `Board.signalsEventBus` 收到 `input` 事件
3. `Board` 根据 `to` 路径中的 `monitorId` 找到目标 `Monitor`
4. `Monitor` 把信号包交给自己的 `devicesTree.dispatch()`
5. 设备树节点按路径处理、改写并继续路由该包
6. 末端节点可直接消费该包，或把它交给工具节点处理
7. 工具修改 `Board` / `Object` / 其它 Core 状态，或返回新的输出信号

这条链路里，`EventBus` 负责跨边界通知，`DevicesTree` 负责树上的空间路由，工具负责真正的业务消费。

对于键盘输入，还应额外区分一层宿主边界：不是所有按键都值得编码进这条链路。只有它已经属于某个 Monitor 的操作语义，或确定会被工具消费时，才应进入设备树。

## 入口

当前业务代码里，输入通常先进入 `Board.signalsEventBus`：

```javascript
board.signalsEventBus.emit("input", {
  to: "/monitor/debugger",
  signals: [
    {
      type: "greeting",
      context: { value: "Hello" },
    },
  ],
});
```

这里的 `to` 必须已经指向某个 Monitor 之下的设备路径。也就是说，`Board` 并不负责替你推断目标设备，它只负责把包送到正确的 Monitor。

## Board 到 Monitor

`Board` 当前在内部监听 `signalsEventBus` 的 `input` 事件。处理过程是：

1. 从 `to` 路径中拆出第一段 `monitorId`
2. 在 `board.monitors` 里查找对应 `Monitor`
3. 若找到，就调用 `monitor.devicesTree.dispatch({ to, signals })`
4. 若没找到，当前实现直接忽略该输入

这意味着当前输入链路是按 Monitor 分区的。不同 Monitor 之间不会共享同一棵设备树。

## Monitor 到 DevicesTree

设备挂载发生在 `Monitor` 上，而不是业务代码直接操作 `DevicesTree`。

```javascript
monitor.mountDevice("/debugger", debuggerDevice);
```

这一步会先由 `Monitor.mountDevice()` 自动补上当前 `monitorId`，再转交给底层 `devicesTree.mountDevice()`。

因此：

- 业务侧书写的是相对于当前 monitor 根节点的路径
- 底层设备树实际持有的是包含 `monitorId` 的绝对路径

## DevicesTree 内部路由

进入 `dispatch()` 后，设备树会做三件事：

1. 按 `to` 定位当前目标节点
2. 执行该节点的 `processor`
3. 根据处理结果中的新 `to`，决定是否继续递归转发

节点处理器或节点通用配置可能做的事情包括：

- 根据当前状态改写 `to`
- 把输入信号转换为更具体的业务信号
- 在当前节点终止路由，并把结果包返回
- 直接调用工具逻辑，消费该包

当前 `DevicesTreeNode` 已支持一组通用节点配置：

- `processor`：节点显式处理器
- `rewritePacket`：对进入当前节点的整包输入做改写

因此，设备定义不必为某一类设备单独发明“节点绑定层”；更推荐直接在节点定义上声明这些能力。

其中边界应这样理解：

- `rewritePacket` 适合键盘方向键这类“整包过滤后再翻译”
- `rewritePacket` 也适合触摸 contacts、调试 report 这类“整包汇总后再输出”
- `processor` 仍适合需要维护设备内部状态或做复杂分流的节点

如果处理后的结果包仍然指向别的节点，设备树会继续递归；如果结果包停在当前节点路径上，递归就终止。

## 工具消费

工具通常挂在设备子树的末端节点，负责真正修改 Core 状态。

典型职责分层如下：

- Device: 把现实输入编码为信号包，并决定设备子树内的路由
- DevicesTree: 按路径和状态递归转发信号包
- Tool: 消费信号并修改 `Board`、`Object`、`ActiveObjectManager` 等状态

因此，设备树本身并不直接承担“画线”“擦除”“选中对象”这类业务动作；这些动作应由工具完成。

## Monitor 上下文

设备节点或工具在处理输入时，往往需要 Monitor 提供的上下文能力，比如：

- `screenToWorld()`：把屏幕坐标转换到世界坐标
- `screenToPage()`：把屏幕坐标转换到页空间
- `worldToPage()`：把世界坐标转换到页空间
- `origin` / `zoom`：解释当前视口
- `pageWidth` / `pageHeight`：解释页尺寸

这也是为什么设备之间不能直接互调，却仍然可以通过 Monitor 间接共享视口语义。

在当前实现里，挂到设备树末端的工具通过 `createProcessor()` 默认会拿到两类与 creator 链路直接相关的上下文能力：

- `resolveOwnerPageId(position)`：默认调用 `worldToPage()`，把世界坐标映射到归属页 id
- `allocateObjectId()`：默认转发到 `Board.allocateObjectId()`

因此，一条对象创建链路当前的默认输入规整顺序是：

1. UI / 宿主侧先把原始屏幕坐标转换成世界坐标
2. 世界坐标进入 `SignalPacket`
3. creator 工具直接消费该世界坐标 `position`
4. 同一位置再被映射为 `ownerPageId`
5. `Board` 分配新的 `objectId`
6. 创建工具基于世界坐标创建对象，并按对象类型写入局部几何

这里要特别区分三层坐标语义：

- 屏幕坐标：来自 DOM / Pointer / Mouse 事件，进入 Core 前应先完成换算
- 世界坐标：输入链对 Tool 暴露的统一位置语义，也是位置类信号进入 Core 时的默认语义
- 对象局部坐标：对象内部保存的几何数据，通常相对 `obj.position`

对于键盘设备，当前还支持一个常见的聚合流向：根节点先把原始按键事件送到 `/code/<KeyCode>`，具体键位节点再通过通用 `rewritePacket` 把它改写成统一的业务信号，并在返回包中显式写入目标路径，例如 `/move` 这类公共锚点，随后再交给一个共享工具节点消费。

## 当前边界

当前输入链路已经明确的部分有：

- `SignalPacket` 是统一输入格式
- `Board` 负责输入事件入口和 Monitor 分发
- `Monitor` 负责设备挂载入口与视口上下文
- `DevicesTree` 负责树上的递归路由
- `Tool` 负责业务消费

当前还没有系统化完成的部分有：

- 从 DOM 事件到 `SignalPacket` 的统一编码层
- 设备节点到工具节点的完整落地图谱
- Core 到 UI 输出信号的标准化消费层
- 更明确的设备生命周期钩子

键盘输入的边界目前已经建议冻结为：Monitor 操作键与工具消费键进入设备树，应用级快捷键停留在宿主侧。

## 最小闭环样板

当前最小可工作的纵向样板可以压缩成下面这条链路：

1. UI 或测试代码向 `board.signalsEventBus.emit("input", packet)` 发射一个输入包
2. `Board` 根据 `packet.to` 中的 `monitorId` 找到目标 `Monitor`
3. `Monitor` 上已经通过 `mountDevice()` 挂好一个设备子树
4. 上层若需要工具消费，会先通过 `mount` 事件把工具挂到目标锚点下
5. 若上层需要运行时改写某个设备节点，还可以通过 `configure` 事件更新该节点配置
6. 设备节点按相对路径和默认路径把包继续送往下游节点；若默认下游当前不存在，则信号停在当前设备语义节点
7. 工具节点通过 `tool.createProcessor({ board, monitor })` 消费该包
8. Tool 修改 `Board` 或其它 Core 状态

对于对象创建工具，第 7 步里默认还包含：对象 id 申请，以及基于当前世界坐标的归属页解析。

对应的最小结构可以写成：

```javascript
monitor.mountDevice("/sample-device", {
  defineNodes() {
    return [
      {
        path: "",
        defaultPath: "tool",
      },
    ];
  },
});

board.signalsEventBus.emit("mount", {
  to: `/${monitor.monitorId}/sample-device`,
  tool,
});

board.signalsEventBus.emit("configure", {
  to: `/${monitor.monitorId}/sample-device`,
  options: {
    defaultPath: "tool",
  },
});
```

这个样板的意义不在功能复杂，而在于它把当前系统的四层接口一次性串起来了：

- 输入包格式
- Monitor 挂载入口
- DevicesTree 路由语义
- Tool 消费接口

只要这条最小闭环保持稳定，后续新增设备或工具都应优先复用它，而不是重新发明接线方式。

## 阶段性稳定接口

当前建议视为阶段性稳定、不要轻易改动的接口有：

- `SignalPacket` 的最小结构：`{ to, signals }`
- `DeviceDefinition` 的最小协议：`defineNodes()`
- 业务侧设备挂载入口：`monitor.mountDevice(path, deviceDefinition)`
- 业务侧运行时设备树入口：`board.signalsEventBus.emit("mount" | "umount" | "configure", ...)`
- `configure` 事件的清空语义：`defaultPath` 传 `null` 或空串表示清空，`processor`/`rewritePacket` 传 `null` 表示清空
- 设备树的相对路径与 `defaultPath` 路由语义
- 设备树递归终止语义：结果包停在当前节点路径上时终止
- Tool 接口：`process(signalPacket, deviceContext)` + `createProcessor(toolContext)`
- 多指输入的区分方式：同一包内允许多条 `position`，并通过 `touchId`/`pointerId` 区分

相对地，下面这些目前仍不应视为稳定协议：

- `Board.signalsEventBus.emit("input")` 的返回值
- 设备定义对象上的扩展字段（如 `name`、`meta`、生命周期钩子）
- Core -> UI 输出信号的消费层实现

## 相关文档

- 设备定义与状态模型：`../devices/docs/device-document.md`
- 设备树结构与路由：`../devices/docs/devices-tree-document.md`
- 设备树示例：`../devices/docs/devices-tree-example.md`
- 信号包说明：`../devices/docs/signal-document.md`
- 工具职责：`../tools/tool-document.md`
- 输入编码标准：`./core-input-encoding.md`
- 阶段性稳定接口：`./core-stable-interfaces.md`
