# 设备树示例

## 目标

下面用一个简化的手写笔设备示例说明当前推荐写法：

- 输入子树用 createSubTree(root) 构建
- 根节点只做分流
- defaultChild 只表示默认子链路
- 工具节点使用显式的 /tool 叶子路径

## 示例代码

```js
import { DevicesTree, createSubTree } from "../devices-tree.js";
import { Tool } from "../../tools/tool.js";

class PenTool extends Tool {
  process(signalPacket, deviceContext) {
    return {
      to: deviceContext.path,
      signals: signalPacket.signals,
    };
  }

  reset() {}
}

const penSubTree = createSubTree("/pen")
  .node("")
  .handler((packet) => ({
    to: "pointer",
    signals: packet.signals,
  }))
  .end()
  .node("pointer")
  .defaultChild("tool")
  .end()
  .build();

const tree = new DevicesTree();
const tool = new PenTool();

tree.mountSubTree("/monitor/main", penSubTree);
tree.mountTool("/monitor/main/pen/pointer/tool", tool, {
  board,
  monitor,
});

const result = tree.dispatch({
  to: "/monitor/main/pen",
  signals: [{ type: "position", context: { value: { x: 10, y: 20 } } }],
});
```

## 处理过程

1. 输入先到 /monitor/main/pen
2. 根节点 handler 把包转发到相对路径 pointer
3. /monitor/main/pen/pointer 没有 handler，但声明了 defaultChild: "tool"
4. 设备树自动把输入继续送到 /monitor/main/pen/pointer/tool
5. PenTool.process() 消费最终信号包

## 带状态的写法

如果需要在设备节点和工具之间共享状态，建议显式写入节点 state：

```js
tree.mount("/monitor/main/pen", (packet, context) => {
  context.setNodeState("/monitor/main/pen", { activeStrokeId: 1 });
  return { to: "pointer", signals: packet.signals };
});
```

工具侧再通过 deviceContext.getNodeState 或 Tool.resolveNodeState() 读取。

## 推荐做法

- 根节点做设备态更新与粗分流
- 子节点做稳定语义拆分
- 工具节点只挂在显式叶子路径
- 跨节点共享状态走 getNodeState 和 setNodeState
- 运行时更新节点走 configureNode，不要直接改内部对象

## 相关文档

- [设备树](./devices-tree-document.md)
- [工具基类](../../tools/tool-document.md)
- [Core 输入流](../../docs/core-input-flow.md)
