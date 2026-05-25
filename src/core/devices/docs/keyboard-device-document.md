# 键盘设备

## 概述

键盘设备负责把宿主层已经确认归属到某个 Monitor 的键盘输入，翻译成 Core 内稳定的设备信号。

当前键盘设备根路径固定为 /keyboard，整体结构已经迁移到 createDevice("/keyboard") 模型。

## 节点结构

键盘设备默认挂出以下节点：

- /keyboard：根节点，更新 activeKeys 与 lastEvent，并把输入分流到子节点
- /keyboard/event：接收所有原始键盘事件
- /keyboard/keydown：接收非 repeat 的 keydown
- /keyboard/keyup：接收 keyup 或 end
- /keyboard/repeat：接收 repeat keydown
- /keyboard/cancel：接收 cancel
- /keyboard/tools：键盘工具域的公共父节点
- /keyboard/code/\<KeyCode\>：按具体 code 分出来的键位节点

其中 code 节点通常再通过 defaultChild 把输入送往显式工具叶子，例如 /keyboard/code/KeyW/tool。

## 信号语义

键盘设备内部会把宿主事件规整为两层语义：

- 原始层：keydown、keyup、cancel、end
- 工具层：trigger、release、cancel

转换规则如下：

- keydown 且 repeat 为 false 时，生成 trigger
- keyup 或 end 时，生成 release
- cancel 时，生成 cancel
- repeat keydown 不生成工具层 trigger

这样工具侧不必直接关心浏览器或宿主的事件细节。

## 设备状态

键盘设备维护两份状态：

- activeKeys：当前仍处于按下状态的键集合快照
- lastEvent：最近一次处理过的键事件描述

设备定义通过 expose() 暴露：

- resetState()：清空内部状态
- getState()：返回可序列化快照

## 自定义节点配置

createKeyboardDevice(options) 支持通过 nodeConfigs 为某些路径补充 handler 或 defaultChild。

当前 nodeConfigs 的单项配置保留两类字段：

- handler
- defaultChild

典型用法：

```js
const keyboard = createKeyboardDevice({
  nodeConfigs: {
    "code/KeyW": {
      handler(packet) {
        return {
          to: "../../tools/move/tool",
          signals: packet.signals,
        };
      },
    },
  },
});
```

## 推荐挂载方式

键盘设备本身应挂在 Monitor 边界下：

```js
monitor.mountDevice(createKeyboardDevice());
```

业务工具应挂在显式工具路径上：

```js
monitor.mountTool("/keyboard/tools/move/tool", moveTool);
```

或者先把 code 节点配置为 defaultChild: "tool"，再挂载 /keyboard/code/KeyW/tool。

## 设计要点

- Monitor 是键盘设备的归属边界
- 键盘设备只处理已经确定属于当前 Monitor 的输入
- 根节点负责更新设备状态并生成分流目标
- code 节点负责做键位级路由，不直接承载复杂业务逻辑
- 复杂交互应落到 tools 域下的显式工具叶子

## 相关文档

- [设备定义](./device-document.md)
- [设备树](./devices-tree-document.md)
- [Core 输入编码](../../docs/core-input-encoding.md)
