# CUI 信号文档

本文档提供 Hound Whiteboard 中 CUI 信号的概述——特指 Core-UI 间通过信道传输的虚拟信号。

在事件总线中，信号以以下格式传输。

```javascript
{
  to: String
  signals: Array<{
    type: String
    context: Object
  }>
}
```