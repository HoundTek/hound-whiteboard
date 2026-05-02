# 白板对象文档

本文档提供白板中各种对象的概述。

## Container

Container 类是用来包装一、二维对象的容器类。派生于 [BasicObject](./basic-classes-document.md#basic-object)。

### 功能

由于一、二维对象既可以调节变换矩阵，又可以调节对象原本的宽高的逻辑容易造成混乱，所以我们用 Container 包装之，并赋予了 Container 容器多种模式以适应不同的对象调节逻辑:
-  普通模式: 容器直接显示内部对象，可以认为这个容器不存在
-  拉伸模式: 内部对象以拉伸的方式填充容器，此模式与其它模式不一样的是，操纵杆可以直接调整其变换矩阵
-  窗口模式: 对二维对象，其表现与普通模式相同；对一维对象，若其非主轴被缩得过分小会被裁切
-  收缩模式: 不改变内部对象宽高比，而是将其收缩以适应容器

用户通过“进入”容器来修改内部对象的内容 (不是更改对象！)。

### 属性


|名称|描述|类型|
|---|---|---|
|`child`|被窗口包装的一维对象或二维对象|`OneDimensionObject\|TwoDimensionObject`|

## Graph

见 [graph-classes-document.md](./graph/graph-classes-document.md)

## 对象持久化

白板对象在持久化时，应先调用具体对象实例的 `serialize()` 生成普通 JSON 对象；恢复时，统一使用 [src/core/objects/object-deserializer.js](src/core/objects/object-deserializer.js) 导出的 `deserializer(data)`。

这样可以把对象类型分发逻辑收敛在一处，避免业务层散落 `if/else` 或 `switch(type)`。