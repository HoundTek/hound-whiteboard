# Tauri 迁移问题总结与交接文档

## 📋 问题概述

原始 Hound Whiteboard 应用使用传统 WebView，在迁移到 **Tauri 2.x** 后遇到以下问题：

| 问题 | 根因 | 状态 |
|------|------|------|
| 页面显示白色 | HTML/CSS 结构不完整 | ✅ 已修复 |
| Loading demo 卡住 | ES Module 路径解析失败 | ✅ 已修复 |
| 功能不工作 | 多重问题（事件绑定、路径、焦点） | 🔄 调试中 |

---

## 🔍 调试过程总结

### 1. ES Module 路径问题（已解决）

**发现过程：**
```
动态 import: import('../core/utils/math.js')
错误信息: http://tauri.localhost/core/utils/math.js  (缺少 /src/ 前缀)

静态 import: import("/core/utils/math.js")
错误信息: asset not found: index.html
```

**根本原因：**
- `frontendDist = "../src/templates"` 只包含 templates 目录
- `core/utils/math.js` 在 `src/core/utils/math.js`，无法访问

**解决方案：**
- 修改 `frontendDist = "../src"`（使整个 src 目录可访问）
- 将 `index.html` 复制到 `src/index.html`

### 2. 当前未解决的问题

| 现象 | 可能原因 |
|------|----------|
| 只有 `mouseup` 事件，没有 `mousedown` | 事件被劫持或阻止 |
| 没有绘制图案 | 信号未正确传递到工具 |
| 键盘无输出 | canvas 焦点问题 |

---

## 🏗️ 当前实现

### 关键文件

| 文件 | 作用 |
|------|------|
| `src-tauri/tauri.conf.json` | Tauri 配置，`frontendDist` 和 CSP |
| `src/index.html` | 应用入口，已添加调试面板 |
| `src/templates/demo/whiteboard-demo.js` | Demo 工具配置 |
| `src/core/components/board.js` | 白板核心类 |
| `src/core/utils/math.js` | Vector 等数学工具 |

### 事件流

```
DOM Event → emitMousePacket() → board.signalsEventBus.emit("input")
                                              ↓
                                    /monitor/mouse route
                                              ↓
                                    configureWhiteboardDemo 挂载的工具
                                              ↓
                                    StrokeCreatorTool / WasdCoordinateTool
                                              ↓
                                    渲染到 canvas
```

---

## 🔧 DevOps 调试步骤

### Step 1: 验证构建

```powershell
# 清理并重新构建
Get-Process | Where-Object {$_.Path -like "*hound-whiteboard*"} | Stop-Process -Force
Remove-Item "src-tauri/target/release/hound-whiteboard.exe" -Force
yarn tauri build
```

### Step 2: 运行应用并测试

```powershell
.\src-tauri\target\release\hound-whiteboard.exe
```

### Step 3: 检查调试面板

按 `` ` `` (反引号) 打开调试面板，查看：
- 启动日志是否显示 `Monitor canvas: CANVAS`（不是 NULL）
- 鼠标事件是否显示 `target=CANVAS` 或 `target=DIV`
- 键盘事件是否有输出

### Step 4: 核心检查点

```javascript
// 在浏览器控制台检查
monitor.canvas        // 应该是一个 <canvas> 元素
monitor.rootElement   // 应该是一个 <div> 元素
board.signalsEventBus // 应该存在
```

---

## 📁 关键配置

### tauri.conf.json

```json
{
  "build": {
    "frontendDist": "../src"
  },
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ..."
    }
  }
}
```

### Cargo.toml (启用 devtools)

```toml
[dependencies]
tauri = { version = "2", features = ["devtools"] }
```

---

## 🎯 建议的下一步调试方向

### 1. 确认 monitor.canvas 是否正确创建

在 `board.createMonitor()` 之后检查：
- `monitor.canvas` 是否为 NULL
- 如果是 NULL，说明 `createMonitor` 的参数有问题

### 2. 检查事件目标

日志中 `target` 字段显示事件绑定的元素：
- `target=CANVAS` = 事件在 canvas 上
- `target=DIV` = 事件在父元素上（事件冒泡）
- `target=BODY` = 事件冒泡到 document

### 3. 验证信号路由

在调试面板确认：
```
Emitting to /monitor/mouse: ["position","end"]
```
这表示信号已发送到正确的路由。

### 4. 检查工具挂载

`configureWhiteboardDemo` 应该将工具挂载到：
- `/monitor/mouse/primary` - 左键黑笔
- `/monitor/mouse/secondary` - 右键红笔
- `/monitor/keyboard/tools/create-circle` - 空格随机圆
- `/monitor/keyboard/tools/move` - WASD 移动

---

## 📞 需要确认的问题

1. **调试面板显示 `Monitor canvas: ???`** - 请告知具体值
2. **点击左键时 target 是什么？** - `target=CANVAS` 还是 `target=DIV`
3. **按 WASD 时是否有任何日志输出？**

---

## 🔗 相关文件路径

```
c:\Users\Frank\Documents\Hound\HoundWhiteboard\
├── src\
│   ├── index.html                    # 当前正在调试的入口文件
│   ├── core\
│   │   ├── components\board.js      # Board 类
│   │   ├── components\monitor.js     # Monitor 类
│   │   └── utils\math.js             # Vector 类
│   └── templates\
│       └── demo\
│           ├── whiteboard-demo.js    # Demo 配置
│           ├── wasd-coordinate-tool.js
│           └── random-circle-creator-tool.js
└── src-tauri\
    ├── tauri.conf.json              # Tauri 配置
    └── Cargo.toml                   # Rust 依赖
```

---

## 📝 原 Demo 功能需求

### 左键黑笔
- 功能：按住左键绘制黑色笔画
- 工具：StrokeCreatorTool，color: #000000, width: 2

### 右键红笔
- 功能：按住右键绘制红色笔画
- 工具：StrokeCreatorTool，color: #ff0000, width: 2

### 空格随机圆
- 功能：按空格键在随机位置生成随机颜色的圆形
- 工具：RandomCircleCreatorTool

### WASD 移动视图
- 功能：按 WASD 键移动视图（不是画笔）
- 工具：WasdCoordinateTool
