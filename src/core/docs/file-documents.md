# `.hwb` 文件结构文档

本文档提供 `.hwb` 文件的结构的概述。

## 概述

`.hwb` 文件是基于 `.zip` 文件的。在 Hound Whiteboard 打开一个白板时，`*.hwb` 文件会被解压到 `.*/` 目录下。

以下代码块提供了一个 `.hwb` 文件解压后的文件夹结构示例：

```
.hwb/
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
  config.json
  meta.json
```

## 内部结构

### `history/`

`.hwb/history/` 文件夹用来存放所有对象和页的历史版本、已删除的对象和页，以及 hit 的块。

#### `trash/`

#### `edition/`

#### `hit/`

### `objects/`

### `pages/`

#### `connection.json`

`connection.json` 内含一个 JSON 对象。存储页的总数，和页与页间的连接顺序。

由于 `connection.json` 的内容较少且关键，所以它会在一开始就读入内存并一直存在。

### `meta.json`

## 缓存