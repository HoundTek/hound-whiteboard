# io 文档

本文档提供 `src/utils/filesys/io.js` 的概述。

## 模块职责

`io.js` 提供面向对象的文件系统封装，核心目标是把文件和目录操作从字符串路径提升为对象操作。

模块主要包含：

- `Directory`：目录对象
- `File`：文件对象
- `FilenameRandomPool`：随机文件名池

## Directory

`Directory` 用于表示一个目录，并提供链式目录操作接口。

### 核心字段

| 名称    | 描述                                     | 类型       |
| ------- | ---------------------------------------- | ---------- |
| `paths` | 目录路径分段数组，兼容不同平台路径分隔符 | `string[]` |

### 常用方法

| 名称                      | 描述                 | 类型                       |
| ------------------------- | -------------------- | -------------------------- |
| `getPath()`               | 获取绝对路径         | `() => string`             |
| `cd(pathStr)`             | 进入子目录           | `(string) => Directory`    |
| `father()`                | 获取父目录           | `() => Directory`          |
| `peek(fileName, fileExt)` | 构造目录下的文件对象 | `(string, string) => File` |
| `exist()`                 | 判断目录是否存在     | `() => boolean`            |
| `make()`                  | 创建目录             | `() => Directory`          |
| `existOrMake()`           | 不存在则创建         | `() => Directory`          |
| `cp(dest)`                | 复制目录             | `(Directory) => Directory` |
| `mv(dest)`                | 移动目录             | `(Directory) => Directory` |
| `rm()`                    | 删除目录             | `() => Directory`          |
| `rmWhenExist()`           | 存在则删除           | `() => Directory`          |
| `ls()`                    | 列出全部内容名称     | `() => string[]`           |
| `lsDir()`                 | 列出子目录           | `() => Directory[]`        |
| `lsFile()`                | 列出文件             | `() => File[]`             |
| `hide()`                  | 隐藏目录             | `() => Directory`          |
| `unhide()`                | 取消隐藏             | `() => Directory`          |
| `compress(file, remove)`  | 压缩目录到文件       | `(File, boolean) => File`  |

### 静态方法

| 名称                             | 描述                   | 类型                       |
| -------------------------------- | ---------------------- | -------------------------- |
| `Directory.getHideResult(dir)`   | 获取隐藏后目录名       | `(Directory) => Directory` |
| `Directory.getUnHideResult(dir)` | 获取取消隐藏后的目录名 | `(Directory) => Directory` |
| `Directory.parse(pathStr)`       | 由路径解析目录对象     | `(string) => Directory`    |

## File

`File` 表示单个文件，提供读写、复制、移动、隐藏、解压等操作。

### 核心字段

| 名称        | 描述                 | 类型        |
| ----------- | -------------------- | ----------- |
| `dir`       | 所在目录对象         | `Directory` |
| `name`      | 文件名（不含扩展名） | `string`    |
| `extension` | 扩展名               | `string`    |

### 常用方法

| 名称                        | 描述                      | 类型                        |
| --------------------------- | ------------------------- | --------------------------- |
| `getPath()`                 | 获取绝对路径              | `() => string`              |
| `unPeek()`                  | 获取所在目录              | `() => Directory`           |
| `cat()`                     | 读取文件文本              | `() => string`              |
| `catJSON()`                 | 读取 JSON                 | `() => any`                 |
| `write(content)`            | 写入文本                  | `(string) => File`          |
| `writeJSON(content)`        | 写入 JSON                 | `(Object) => File`          |
| `exist()`                   | 判断文件是否存在          | `() => boolean`             |
| `init()`                    | 创建空文件                | `() => File`                |
| `existOrInit()`             | 不存在则创建空文件        | `() => File`                |
| `existOrWrite(content)`     | 不存在则写入文本          | `(string) => File`          |
| `existOrWriteJSON(content)` | 不存在则写入 JSON         | `(Object) => File`          |
| `toUrl()`                   | 转为背景图 URL 字符串逻辑 | `() => string`              |
| `cp(dest)`                  | 复制文件                  | `(File\|Directory) => File` |
| `mv(dest)`                  | 移动文件                  | `(File\|Directory) => File` |
| `rm()`                      | 删除文件                  | `() => File`                |
| `rmWhenExist()`             | 存在则删除                | `() => File`                |
| `hide()`                    | 隐藏文件                  | `() => File`                |
| `unhide()`                  | 取消隐藏                  | `() => File`                |
| `extract(dir)`              | 解压文件                  | `(Directory) => Directory`  |

### 静态方法

| 名称                         | 描述                 | 类型               |
| ---------------------------- | -------------------- | ------------------ |
| `File.getHideResult(file)`   | 获取隐藏后文件名     | `(File) => File`   |
| `File.getUnHideResult(file)` | 获取取消隐藏后文件名 | `(File) => File`   |
| `File.parse(pathStr)`        | 由路径解析文件对象   | `(string) => File` |

## FilenameRandomPool

`FilenameRandomPool` 基于 `RandomNumberPool` 提供“随机且不重复”的目录名或文件名分配能力。

### 主要字段

| 名称   | 描述                     | 类型               |
| ------ | ------------------------ | ------------------ |
| `dir`  | 目标目录                 | `Directory`        |
| `type` | `Directory` 或文件扩展名 | `string`           |
| `pool` | 内部随机数池             | `RandomNumberPool` |

### 主要方法

| 名称          | 描述                | 类型                          |
| ------------- | ------------------- | ----------------------------- |
| `add(ID)`     | 将指定 id 放入池中  | `(string) => boolean`         |
| `include(ID)` | 查询 id 是否存在    | `(string) => boolean`         |
| `isFull()`    | 判断池是否已满      | `() => boolean`               |
| `generate()`  | 生成随机文件/目录   | `() => Directory\|File`       |
| `remove(ID)`  | 删除并移出池        | `(string) => boolean`         |
| `rename(ID)`  | 重命名为新的随机 id | `(string) => Directory\|File` |

## 模块特点

- 高层 API 基于对象而不是裸字符串路径。
- `Directory` 内部以路径分段数组保存目录路径，适配 Windows、Linux 与 macOS 的分隔符差异。
- `File` 内部以 `Directory + name + extension` 保存文件定位信息。
- 支持链式调用，适合白板文件结构初始化。
- 目录与文件都支持隐藏/取消隐藏。
- 文件压缩与解压已被纳入统一封装。
- 目录、文件、压缩与解压操作直接调用 `fs`/`adm-zip`。

## 注意事项

- `toUrl()` 当前实现会引用外部 `previewScreen`，因此它并不是纯粹的路径转换方法，更偏特定 UI 场景辅助函数。
- `FilenameRandomPool` 初始化时会按类型扫描现有目录项：目录池读取子目录名，文件池读取同扩展名文件名，并尝试从名称中解析数字作为已占用 id。

## 依赖

- Node.js `path`
- Node.js `fs`
- `adm-zip`
- `hidefile`
- `../utils/algorithm`
