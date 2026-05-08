# 键盘设备文档

本文档描述 HoundWhiteboard 当前阶段的键盘设备定义、路由模型与使用边界。

## 概述

键盘设备是挂载在某个 Monitor 下的一棵设备子树。它处理的不是“所有来自键盘的按键”，而是已经被宿主层判定为设备语义的那部分键盘输入。

当前建议只有两类输入进入键盘设备：

- 该输入直接操作 Monitor
- 该输入最终会被工具消费

因此，键盘设备的关键不在“怎么监听键盘”，而在“哪些键盘事件值得进入设备树”。

## 不属于键盘设备的输入

下面这些输入当前不应进入键盘设备：

- `Command+S` / `Ctrl+S` 保存
- 切换工具、打开 UndoTree、打开设置面板等应用级快捷键
- 与 Monitor 操作和工具消费无关的全局热键

这些行为应直接留在宿主 UI 层处理。

## 当前子树结构

当前实现见 [keyboard-device.js](../keyboard-device.js)。设备根路径下会展开出以下节点：

- `/event`：所有进入设备树的键盘事件都会先转发到这里
- `/keydown`：非重复按下事件
- `/keyup`：抬起事件
- `/repeat`：长按重复事件
- `/cancel`：宿主强制中断当前键盘交互，如 Monitor 失焦
- `/code/<KeyCode>`：按键专属节点，只在调用方为该键位配置了处理器时展开

这种结构把“通用键盘语义”和“具体绑定键位”拆开了：

- 前者适合 Monitor 级操作，如统一处理视口导航键
- 后者适合工具级消费，如只监听 `Space` 或 `KeyW`

## 状态模型

当前键盘设备维护两类最小状态：

- `activeKeys`：当前仍处于按下状态的键集合
- `lastEvent`：最近一次进入设备树的键盘事件快照

这两类状态都属于设备的关联状态，目的是辅助路由与调试，而不是表达宿主 UI 的全部快捷键系统。

## 输入包约定

当前建议的最小输入包如下：

```javascript
{
  to: "/monitor/keyboard",
  signals: [
    {
      type: "keydown",
      context: {
        code: "Space",
        key: " ",
        repeat: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      },
    },
  ],
}
```

抬起时发送 `keyup`，失焦或宿主中断时发送 `cancel`。

## 最小使用方式

```javascript
const keyboardDevice = createKeyboardDevice({
  keyProcessors: {
    Space: tool.createProcessor({ board, monitor }),
  },
});

monitor.mountDevice("/keyboard", keyboardDevice);
```

此时宿主只需把目标 Monitor 的 `keydown` / `keyup` 事件编码后发到 `/${monitorId}/keyboard`，设备树就会把 `Space` 继续送到 `/code/Space`，再交给工具消费。

## 设计约束

- 键盘设备不负责定义应用级快捷键系统
- 键盘设备不负责决定一个按键是否应该被某个工具消费
- 用户绑定关系应由更上层模块维护，键盘设备只负责状态更新与树上路由

这样可以保持设备层与应用命令层解耦。

## 相关文档

- [device-document.md](./device-document.md)
- [devices-tree-document.md](./devices-tree-document.md)
- [signal-document.md](./signal-document.md)
- [../../docs/core-input-encoding.md](../../docs/core-input-encoding.md)
- [../../components/docs/monitor-document.md](../../components/docs/monitor-document.md)