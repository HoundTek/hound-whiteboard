# 模板系统文档

本文档提供项目中所有模板文件的概述。

## 模板系统概述

模板系统每个模板包含三个主要部分：
1. HTML文件 - 定义结构
2. CSS文件 - 定义样式
3. JavaScript文件 - 定义行为

模板共享公共资源：
- [global.css](./global.css) - 全局样式
- [global.js](./global.js) - 全局工具(主题/语言管理)

## 主菜单模板 (`main-menu`)

应用的主入口点。

### 文件:
- [main-menu.html](./main-menu/main-menu.html) - 主结构
- [main-menu.css](./main-menu/main-menu.css) - 特定样式
- [main-menu.js](./main-menu/main-menu.js) - 逻辑和IPC处理器

### 功能:
- 侧边栏导航
- 包含新建/打开文件选项的起始屏幕
- 帮助和关于屏幕
- 主题/语言选择的设置屏幕

### 结构:
```html
<div id="main-menu">
  <div id="main-menu-sidebar">
    <!-- 导航按钮 -->
  </div>
  <div id="main-menu-content">
    <!-- 内容屏幕 -->
  </div>
</div>
```

### IPC通信:
- `open-modal-window` - 打开新建文件模态窗口
- `open-hwb-file` - 打开文件对话框
- `settings-changed` - 处理设置更新
- `settings-loaded` - 初始设置加载

## 全局资源

### [global.js](./global.js)
提供共享功能:
- 主题管理(`setTheme`)
- 语言管理(`setLanguage`)
- 设置变更的IPC处理器

### [global.css](./global.css)
提供共享样式:
- 所有模板的基础样式
- 通用按钮样式
- 内容屏幕切换

## 其他模板

### 新建文件模板 (`new-file`)
- 文件: [new-file.html](./new-file/new-file.html), [new-file.css](./new-file/new-file.css), [new-file.js](./new-file/new-file.js)
- 用途: 创建新的白板文件

### 新建模板模板 (`new-template`)
- 文件: [new-template.html](./new-template/new-template.html), [new-template.css](./new-template/new-template.css), [new-template.js](./new-template/new-template.js)
- 用途: 创建新模板

### 全屏模板 (`whiteboard`)
- 文件: [whiteboard.html](./whiteboard/whiteboard.html), [whiteboard.css](./whiteboard/whiteboard.css), [whiteboard.js](./whiteboard/whiteboard.js)
- 用途: 白板主界面
- 包含 `whiteboard-utils/` 中的工具模块和 `whiteboard-components` 中的组件模块

## 模板关系图

```
global.js ────┐
              ├─ main-menu.js
global.css ───┘
             
main-menu.js ─── new-file.js
                 new-template.js
                 whiteboard.js
```
