# 显示器组件文档

本文档提供白板中的重要组件——显示器组件（Monitor）的概述。

## 显示器组件

显示器组件是设备树的挂载点。它本身不承担普通设备的输入语义，而是负责承载 `canvas`、维护设备子树，并把 Core 的结果组织成可显示的 UI。

它会输出一个 `ReactElement`。这个 `ReactElement` 内有一个 `canvas`，以及设备子树对应的其它 UI 控件。

注：现阶段仍输出 `HTMLCanvasElement`，未来可能改为 `ReactElement`。

## 设备树

设备树是挂载在 Monitor 下的树形结构。设备本身以子树定义的形式接入，而树上的每个节点只负责处理信号。

业务侧挂载设备时，应优先通过 `monitor.mountDevice(path, deviceDefinition)` 进入。这个便捷入口会自动补上当前 `monitorId`，再转交给底层 `devicesTree.mountDevice(rootPath, deviceDefinition)`。

它的作用有两点：

- 把设备状态显化并封存在节点中。
- 按节点路径分发和处理信号包。

在 Core-UI Interface 中，事件的接收者仍然是 Board，但可以通过节点定位，将信号分发到设备子树中的不同节点。

设备树的例子详见设备文档中[设备的状态压缩](../../devices/docs/device-document.md#设备的状态压缩)部分。

当前设备树的数据结构与路由规则见[设备树文档](../../devices/docs/devices-tree-document.md)。
