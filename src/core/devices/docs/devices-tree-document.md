# 设备树文档

本文档描述 Hound Whiteboard 中设备树（DevicesTree）的结构、路由模型和当前实现边界。

## 总览

设备树是 Monitor 名下所有逻辑设备的路由骨架。它负责两件事：

- 保存设备节点的层级关系。
- 按 `to` 路径将一个信号包送到对应节点。

设备树本身不定义具体设备语义。节点只提供“挂载设备”和“把包送过去”这两个基础能力。

## 节点模型

每个节点包含以下信息：

- `name`：当前节点名。
- `parent`：父节点。
- `children`：子节点表。
- `device`：挂载在该节点上的设备或处理器。

节点路径采用类 Unix 形式，如 `/monitor/stylus/tip`。

## 路由模型

设备树接收的仍是一个完整信号包：

```javascript
{
  to: "/monitor/stylus",
  signals: [
    { type: "position", context: { value: vector } },
    { type: "pressure", context: { value: 0.4 } },
  ],
}
```

路由过程如下：

1. 读取 `to` 字段并定位目标节点。
2. 调用该节点挂载设备的 `processSignalPacket` 或 `process`。
3. 若设备返回新的信号包，且其 `to` 指向别的节点，则继续递归转发。
4. 若目标不存在，或节点上没有处理器，则该包直接作为未消费结果返回。

这说明设备树只负责“送达”，不负责“解释”信号。

## 与 Tool / Device 的关系

- Device 负责把现实输入编码成逻辑信号包。
- DevicesTree 负责按路径把信号包送到设备节点。
- Tool 负责在设备节点内部消费和变换信号包。

因此，设备树是 Device 和 Tool 之间的结构化信道，而不是新的业务逻辑层。

## 当前实现边界

当前 DevicesTree 实现提供：

- 路径归一化。
- 节点挂载、查询、卸载。
- 基于 `to` 的递归分发。
- 最大转发深度保护，防止节点间错误循环。

当前 DevicesTree 还没有做：

- 权限控制。
- 广播、多播。
- 路径通配符。
- 节点生命周期事件。
- Monitor 专属坐标转换。

这些都应在设备或 Monitor 上层继续扩展，而不是直接塞进树结构里。