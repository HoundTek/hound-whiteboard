/**
 * @file Board API 类型定义
 * @description 定义 BoardApi 的共享 JSDoc typedef，约束同线程实现与 RPC 实现的统一签名。
 * @module core/shared/board-api-types
 * @author Zhou Chenyu
 */

/**
 * 对象修改 patch
 * @typedef {Object} ObjectPatch
 * @property {import("./types.js").Point2D} [position] - 新的绝对位置
 * @property {import("./types.js").TransformMatrix2D} [transform] - 新的变换矩阵
 * @property {Record<string, any>} [property] - 样式属性合并块
 */

/**
 * 批量对象修改条目
 * @typedef {Object} ObjectPatchEntry
 * @property {number} objectId - 对象 id
 * @property {ObjectPatch} patch - 该对象的 patch
 */

/**
 * 对象查询参数
 * @typedef {Object} QueryObjectsOptions
 * @property {number[]} [ids] - 显式查询的对象 id 列表
 * @property {import("../range/range.js").Range | import("./types.js").Rect} [range] - 空间范围
 * @property {number[]} [chunkIds] - 显式查询的 chunk id 列表
 */

/**
 * 命中查询参数
 * @typedef {Object} HitTestOptions
 * @property {import("./types.js").Point2D} [position] - 命中点
 * @property {import("../range/range.js").Range | import("./types.js").Rect} [range] - 命中范围
 * @property {string} [mode] - 命中模式
 */

/**
 * 创建 MonitorCore 的参数
 * @typedef {Object} CreateMonitorOptions
 * @property {string | number} monitorId - monitor 标识
 * @property {number} width - 视口宽度
 * @property {number} height - 视口高度
 */

/**
 * BoardApi 接口摘要
 * @typedef {Object} BoardApi
 * @property {(type: string, props: Record<string, any>) => Promise<number>} createObject - 创建对象并返回 objectId
 * @property {(objectId: number, patch: ObjectPatch) => Promise<void>} modifyObject - 修改单个对象
 * @property {(patches: ObjectPatchEntry[]) => Promise<void>} modifyObjects - 批量修改多个对象
 * @property {(objectId: number, key: string, items: any[]) => Promise<void>} appendListItem - 追加列表属性元素
 * @property {(objectId: number, key: string, index: number, item: any) => Promise<void>} replaceListItem - 替换列表属性元素
 * @property {(objectId: number, key: string, index: number) => Promise<void>} removeListItem - 删除列表属性元素
 * @property {(objectIds: number[]) => Promise<void>} deleteObjects - 删除对象集合
 * @property {(objectIds: number[]) => Promise<void>} commitObjects - 提交活动对象集合
 * @property {(objectIds: number[]) => Promise<void>} addActiveObjects - 将对象加入 AOM
 * @property {(objectIds: number[]) => Promise<void>} discardActiveObjects - 将对象从 AOM 丢弃
 * @property {(options: QueryObjectsOptions) => Promise<import("./types.js").ObjectSummary[]>} queryObjects - 查询对象摘要
 * @property {(options: HitTestOptions) => Promise<number[]>} hitTest - 执行命中查询
 * @property {(options: CreateMonitorOptions) => Promise<void>} createMonitor - 创建 MonitorCore
 * @property {(monitorId: string | number) => Promise<void>} destroyMonitor - 销毁 MonitorCore
 * @property {() => Promise<void>} undo - 执行撤销
 * @property {() => Promise<void>} redo - 执行重做
 */

export {};
