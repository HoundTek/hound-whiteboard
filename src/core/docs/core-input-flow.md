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

节点处理器可能做的事情包括：

- 根据当前状态改写 `to`
- 把输入信号转换为更具体的业务信号
- 在当前节点终止路由，并把结果包返回
- 直接调用工具逻辑，消费该包

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

- `screenToPage()`：把屏幕坐标转换到页空间
- `origin` / `zoom`：解释当前视口
- `pageWidth` / `pageHeight`：解释页尺寸

这也是为什么设备之间不能直接互调，却仍然可以通过 Monitor 间接共享视口语义。

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

## 相关文档

- 设备定义与状态模型：`../devices/docs/device-document.md`
- 设备树结构与路由：`../devices/docs/devices-tree-document.md`
- 设备树示例：`../devices/docs/devices-tree-example.md`
- 信号包说明：`../devices/docs/signal-document.md`
- 工具职责：`../tools/tool-document.md`
