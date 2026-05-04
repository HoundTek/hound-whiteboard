# 设备树示例

本文档用一个简化的 S-Pen 子树示例，说明 DevicesTree 如何挂载节点、展开设备子树，并在节点之间递归路由。

## 示例目标

我们希望表达这样一个设备：

- `/monitor/s-pen` 是根节点，根据按钮状态决定把包送到 `pen` 或 `eraser`。
- `/monitor/s-pen/pen` 消费输入，并产出绘画结果。
- `/monitor/s-pen/eraser` 消费输入，并产出擦除结果。

## 直接挂载节点

最直接的写法是分别挂载三个节点处理器：

```javascript
const tree = new DevicesTree();

tree.mount("/monitor/s-pen", (packet, context) => {
  const isButtonPressed = packet.signals.some(
    (signal) => signal.type === "button" && signal.context?.value === true,
  );

  return [
    {
      to: isButtonPressed ? "/monitor/s-pen/eraser" : "/monitor/s-pen/pen",
      signals: packet.signals,
    },
  ];
});

tree.mount("/monitor/s-pen/pen", (packet, context) => [
  {
    to: context.path,
    signals: [{ type: "draw", context: { from: context.path } }],
  },
]);

tree.mount("/monitor/s-pen/eraser", (packet, context) => [
  {
    to: context.path,
    signals: [{ type: "erase", context: { from: context.path } }],
  },
]);
```

这里有两个关键点：

- 根节点并不直接修改白板，它只负责根据当前状态改写 `to`，把包继续送到合适的子节点。
- `pen` 和 `eraser` 节点把 `to` 设为当前节点路径，表示路由在这里终止，结果包直接返回给设备树调用方。

## 用设备子树定义挂载

同一个例子也可以先写成设备子树定义，再统一挂载：

```javascript
const createNodeProcessor =
  (nodePath) =>
  (signalPacket, routeContext = {}) =>
    SignalPacket.normalizeResult(
      processNodePacket(
        nodePath,
        SignalPacket.from(signalPacket, { defaultTo: "/" }),
        routeContext,
      ),
      { defaultTo: "/" },
    );

const processNodePacket = (nodePath, packet) => {
  if (nodePath === "") {
    const isButtonPressed = packet.signals.some(
      (signal) => signal.type === "button" && signal.context?.value === true,
    );
    return {
      to: isButtonPressed ? "/monitor/s-pen/eraser" : "/monitor/s-pen/pen",
      signals: packet.signals,
    };
  }

  return {
    to: `/monitor/s-pen/${nodePath}`,
    signals: [
      {
        type: nodePath === "pen" ? "draw" : "erase",
        context: { from: nodePath },
      },
    ],
  };
};

const deviceDefinition = {
  defineNodes() {
    return [
      { path: "", processor: createNodeProcessor("") },
      { path: "/pen", processor: createNodeProcessor("pen") },
      { path: "/eraser", processor: createNodeProcessor("eraser") },
    ];
  },
};

tree.mountDevice("/monitor/s-pen", deviceDefinition);
```

这段示例对应当前 `mountDevice()` 的真实用法：

- 设备定义对象只负责返回节点列表。
- 每个节点只声明相对路径和对应的 `processor`。
- 设备树负责把这些相对路径展开到 `/monitor/s-pen` 之下。

## 路由结果

如果送入如下输入：

```javascript
tree.dispatch({
  to: "/monitor/s-pen",
  signals: [{ type: "position", context: { value: { x: 1, y: 2 } } }],
});
```

那么路由过程是：

1. 包先到 `/monitor/s-pen`。
2. 根节点检查按钮状态，决定把包转发到 `/monitor/s-pen/pen`。
3. `pen` 节点产出一个 `draw` 结果包，并把 `to` 保持为当前路径。
4. 因为结果包不再指向其它节点，设备树停止递归，并返回该结果。

最终结果类似于：

```javascript
[
  {
    to: "/monitor/s-pen/pen",
    signals: [{ type: "draw", context: { from: "/monitor/s-pen/pen" } }],
  },
];
```

这个示例体现了当前设备树模型的三个核心点：

- 节点既可以做局部判断，也可以改写路由目标。
- 设备不是单个对象，而是一组节点之间的协作关系。
- 设备树只负责树上的递归分发，具体业务语义由节点处理器承担。
