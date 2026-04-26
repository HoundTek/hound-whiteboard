# 工具模块文档（待更新）

本文档提供项目中所有工具模块的概述。

## [algorithm](algorithm.js)

提供基础算法。

### 功能:

- 随机数池
- 双指、三指操作的矩阵变换计算

### 主要方法:

- `getDualFingerResult(x1, y1, x2, y2, x1q, y1q, x2q, y2q, aq, bq, cq, dq, eq, fq)` - 计算双指操作的变换矩阵
- `getTriFingerResult(x1, y1, x2, y2, x3, y3, x1q, y1q, x2q, y2q, x3q, y3q, aq, bq, cq, dq, eq, fq)` - 计算三指操作的变换矩阵

### 主要类:

- `RandomNumberPool` - 不重复随机数池类

### 依赖:

- `crypto.randomInt` 用于生成随机数

## [fp](fp.js)

特化 `fs` 的功能，封装文件操作。

### 功能:

- 目录和文件的基本操作
- 文件压缩和解压
- 文件复制、移动、删除

### 主要方法:

- `mkdir(dir)` - 创建目录
- `lsDir(dir)` - 列出子目录
- `lsFile(dir)` - 列出文件
- `readFile(file)` - 读取文件内容
- `writeFile(file, content)` - 写入文件内容
- `cp(source, dest)` - 复制文件
- `mv(source, dest)` - 移动文件
- `rm(file)` - 删除文件
- `extractFile(source, dest)` - 解压文件
- `compressFile(source, dest, remove)` - 压缩目录

### 依赖:

- `fs` - Node.js 文件系统模块
- `adm-zip` - ZIP 压缩库

## [io](io.js)

封装文件操作，提供面向对象的文件和目录管理。

### 功能:

- 文件和目录的面向对象封装
- 随机文件名池管理
- 文件隐藏和显示
- 路径解析和操作

### 主要类:

- `Directory` - 目录操作类
- `file` - 文件操作类
- `fileNameRandomPool` - 随机文件名池类

### 主要方法:

- `Directory` 类方法: `getPath()`, `cd()`, `make()`, `exist()`, `ls()`, `cp()`, `mv()`, `rm()`
- `file` 类方法: `getPath()`, `cat()`, `write()`, `exist()`, `cp()`, `mv()`, `rm()`
- `fileNameRandomPool` 类方法: `generate()`, `add()`, `remove()`, `rename()`

### 依赖:

- `path` - Node.js 路径模块
- `hidefile` - 文件隐藏库
- `fp` - 文件操作模块

## [Fake Window](ui/fake-window.js)

提供模拟窗口 UI 组件，采用严格的面向对象设计。

### 功能:

- 模态和非模态窗口显示
- 居中和自定义位置显示
- 象限模式智能定位
- 事件驱动架构
- Z-index 层级管理
- 多种预设窗口类型

### 主要类:

- `FakeWindow` - 主窗口类
- `WindowFactory` - 窗口工厂类
- `EventEmitter` - 事件发射器基类

### 主要方法:

- `showCentered()` - 居中显示窗口
- `showAt(x, y, options)` - 在指定位置显示窗口
- `hide()` - 隐藏窗口
- `toggle()` - 切换窗口可见性

### 依赖:

- 无 (纯 DOM 操作)

---

## [Toast](ui/toast.js)

提供内联通知系统，轻量级提示框组件。

### 功能:

- 多种通知类型 (成功、警告、错误、信息)
- 多种显示位置
- 自定义动画
- 进度指示器

### 主要方法:

- `show(options)` - 显示自定义提示框
- `success(message, options)` - 显示成功提示
- `warning(message, options)` - 显示警告提示
- `error(message, options)` - 显示错误提示
- `info(message, options)` - 显示信息提示
- `close(toast)` - 关闭指定提示框
- `closeAll()` - 关闭所有提示框

### 依赖:

- 无 (纯 DOM 操作)
