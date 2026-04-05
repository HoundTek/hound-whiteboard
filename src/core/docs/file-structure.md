# `.hwb` 文件结构文档

本文档提供 `.hwb` 文件的结构的概述。

## 概述

`.hwb` 文件是基于 `.zip` 文件的。在 Hound Whiteboard 打开一个白板时，`*.hwb` 文件会被解压到 `.*/` 目录下。

以下代码块提供了一个 `.hwb` 文件解压后的文件夹结构示例：

```
.hwb/
  devices/
  history/
    trash/
      page1/
        1.json
      page2/
        2.json
      pages/
        3.json
    edition/
      page1/
        2-1.json
        2-2.json
      pages/
        1-1.json
    hit/
      1.json
      2.json
  objects/
    stash/
      6.json
      7.json
    page1/
      3.json
      4.json
    page2/
      5.json
  pages/
    connection.json
    1.json
    2.json
  templates/
    1.json
    2.json
  config.json
  trace.json
  meta.json
```

## 内部结构

### 历史记录：`history/`

该文件夹用来存放所有对象和页的历史版本、已删除的对象和页，以及 hit 的块。

#### 回收站：`trash/`

该文件夹用来存放所有已被删除的对象和页。

#### 对象历史版本：`edition/`

该文件夹用来存放所有对象和页的历史版本

#### 时间回溯树：`hit/`

该文件夹用来存放 hit 的块。

### 对象：`objects/`

### 页面：`pages/`

该文件夹存放了关于页面的连接和对象层叠。

#### 连接顺序：`connection.json`

该文件存放了页的连接顺序。

示例：
```json
{
  "count": 8,
  "order": [1, 6, 3, 4, 2],
  "size": 5,
}
```

其中，`count` 是给 `CounterPool` 使用的。

#### 数字 id `json` 文件

其文件名就是页 id，内部存放的是层叠图 DAG。

### 白板配置：`config.json`

该文件存放了白板的基础配置。

### 上次打开：`trace.json`

该文件存放了上次关闭白板时的情况。

示例：
```json
{
  "onPage": 3,
  "offset": 0.1,
}
```

表示上次关闭时在第三页，但第三页的左边有 10% 没有显示。

### `meta.json`

白板的元数据。

## 缓存