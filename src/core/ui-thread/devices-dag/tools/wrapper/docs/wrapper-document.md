# wrapper（复合设备 / 组合子）

## 概述

wrapper 是设备图上的第四类角色：对外呈现为普通 `Tool`，通过 `mountWorkflow` 单节点挂载；对内把多个子工具组合为一个整体。

设计判据（详见 [设备图文档](../../../docs/devices-dag-document.md) 的"设计判据"章节）：

- **图表达并发拓扑**：fan-out、多入边汇聚、多路径并发必须用图表达
- **wrapper 表达顺序/互斥组合**：first→second 顺序流（handoff）与 1-of-N 互斥选择（tool-switcher）不利用图的并发能力，应塌缩为 wrapper

Unix 类比：管线 `a | b | c` 组合出来本身仍是一条命令，可以再进管线——wrapper 就是这种"打包好的管线"。

从设备哲学的角度看，wrapper 是复合设备：输入信道是上游信号，输出信道是转发给内部子工具的信号，内部组合对外不可见（见 [设备定义](../../../devices/docs/device-document.md)）。

## 模块清单

| 文件                    | 导出                  | 用途                                   |
| ----------------------- | --------------------- | -------------------------------------- |
| `wrapper-tool.js`       | `WrapperTool`         | 槽位托管基座                           |
| `handoff-wrapper.js`    | `HandoffWrapperTool`  | first → second 两阶段顺序流            |
| `switcher-wrapper.js`   | `ToolSwitcherWrapper` | 1-of-N 互斥工具路由                    |
| `multi-tool-wrapper.js` | `MultiToolWrapper`    | 多指并发分流（独立实现，见下文"关系"） |

## WrapperTool 基座

`WrapperTool` 继承 `Tool`，把一组子工具托管为内部槽位（slot）。

### 槽位与 shell 节点

每个槽位由一个**不进入真实 DAG** 的 shell 节点（`DevicesDAGNode`）承载，`shell.handler = tool.createProcessor()`。wrapper 通过 `shell.dispatch()` 把信号转发到目标槽位。

shell 节点的 `dag` 为 `null`，因此 dispatch 上下文的 state 读写降级为 shell 节点自身 `state`——各槽位子工具的节点状态**天然隔离**，互不干扰。禁止用虚拟路径调真实 `dag.setNodeState` 模拟子节点。

### 上下文传递

- **services 透传**：父上下文的 `services` 原样传入槽位 dispatch，并缓存为最近一次 services 供完成回调使用
- **`_buildSlotContext(scopeId, parentContext)`**：构造面向指定槽位的调用上下文（state 读写落 shell 节点），用于在信号分发之外直接调用子工具的生命周期方法（如 `discardAction`）

### 可观察性约定

shell 节点不在真实 DAG 中，子图结构可观察性由镜像机制替代：

- 子类必须把可观察状态（`phase` / `activeName` 等）通过 `context.patchState` 镜像到 wrapper 自己的节点 state，供 `dag.getNodeState` 观察
- 子类必须提供 `getDebugInfo()` 供调试

### 生命周期

- `endAction(context)` / `cancelAction(context)`：由子类传播到当前活跃槽位的子工具
- `umount(context)`：取消活跃动作并 dispose 全部槽位（`processor.dispose`）
- `reset()`：重置组合状态（相位 / 路由目标），**不销毁槽位**

## HandoffWrapperTool

两阶段顺序组合：first（creator / chooser）→ second（通常为 modifier）→ first …

```js
const handoff = new HandoffWrapperTool({
  first: new RectangleObjectChooserTool(),
  second: new CommonObjectModifierTool(),
});
scope.mountWorkflow("secondary-chooser", handoff);
```

### 相位切换

- 构造时**一次性长期订阅**两个子工具的 `action:complete` 事件
- first 完成且产出非空对象数组 → 通过 `second.receiveHandoffObjects(objects, ctx)` 桥接对象（`autoBridgeObjects` 可关），相位切到 `second`
- first 完成但无产出对象 → 不切换
- second 完成 → 相位切回 `first`，并请求 UI overlay 刷新
- second 阶段收到 `cancel` 信号且相位未被完成回调改变 → wrapper 调用 `second.discardAction()` 丢弃活动对象，切回 `first`

相位镜像键：`phase` / `activeChild`。

### 构造期语义适配

wrapper 构造时自动适配子工具的提交语义（显式实例属性）：

- first 若有 `autoCommit` 属性则置为 `false`：creator 完成时不提前提交静态图，对象留在 AOM 等待 modifier 最终提交
- second 若有 `autoUmountOnApply` 属性则置为 `false`：modifier 提交后不自卸载，槽位保持存活

### 构造校验

- first / second 必须是 Tool 实例（具备 `createProcessor`），否则抛 `TypeError`
- first 与 second 不能是同一实例

## ToolSwitcherWrapper

1-of-N 互斥路由：接收 button-group 设备的 `tool-switch` 信号切换活跃工具，其余信号转发到当前活跃槽位。

```js
const switcher = new ToolSwitcherWrapper({
  tools: [
    { name: "stroke", tool: strokeTool },
    { name: "circle", createTool: () => new CircleCreatorTool({...}) },
    { name: "select", tool: selectHandoff },
  ],
  defaultTool: "stroke",
});
scope.mountWorkflow("tool-switcher", switcher);
```

### 路由规则

- `tool-switch` 信号（`context.activeTool` 为目标名）：校验目标在工具列表中；先确保新槽位实例化，再对旧工具调用 `endAction(context)` 让其优雅收尾；该信号不再向下转发
- 其他信号：转发到当前活跃槽位
- 路由目标镜像键：`routeTarget`

### 懒实例化

- `tool` 实例条目在构造时即创建槽位
- `createTool` 工厂条目在首次激活时才调用并建槽——面向千级工具场景，避免一次性实例化全部工具

### 边界

- `endAction` / `cancelAction` 传播到当前活跃工具；因此切换出 handoff 分支时，handoff 的当前相位工具会收到 `endAction` 完成收尾
- `reset()` 恢复默认路由目标，保留已实例化槽位

## 与 MultiToolWrapper 的关系

`MultiToolWrapper`（多指并发分流）也是 wrapper tool，但目前是**独立实现**（直接继承 `Tool`，自建 `Map<touchId, DevicesDAGNode>`），未建在 `WrapperTool` 基座上——它的槽位是 per-touch 动态创建销毁的，与基座的静态槽位模型不同。未来可考虑将其重建在基座之上 [todo]。

## 注意事项

- wrapper 的子工具**不经 `_registerToolInstance` 注册**——DAG 层的"同一实例禁止重复挂载"保护不覆盖槽位内部，复用同一工具实例到多个 wrapper 时需自行保证生命周期边界
- wrapper 不支持序列化（`serialize()` / `parse()` 沿用 `Tool` 基类的抛错默认实现）
- 槽位 dispatch 的 `dag` 为 `null`：子工具内 `context.dag?.unmount` 等跨节点操作不可用，跨节点影响应通过 wrapper 或事件钩子完成

## 相关文档

- [设备图](../../../docs/devices-dag-document.md)
- [设备定义](../../../devices/docs/device-document.md)
- [工具基类](../../docs/tool-document.md)
- [手势工具基类](../../docs/gesture-tool-document.md)
- [多工具并发包装器](./multi-tool-wrapper-document.md)
- [对象创建工具](../../creator/docs/object-creator-document.md)
- [对象选择工具](../../chooser/docs/object-chooser-document.md)
- [对象修改工具](../../modifier/docs/object-modifier-document.md)
- [修饰节点](../../../prefixes/docs/prefix-document.md)
