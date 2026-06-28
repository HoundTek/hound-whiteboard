/**
 * @file 共享类型定义
 * @description 定义 Core Worker 迁移阶段两线程共享的通用 JSDoc typedef。
 * @module core/shared/types
 * @author Zhou Chenyu
 */

/**
 * 二维坐标点
 * @typedef {Object} Point2D
 * @property {number} x - x 坐标
 * @property {number} y - y 坐标
 */

/**
 * 2D 变换矩阵（不含平移）
 * @typedef {Object} TransformMatrix2D
 * @property {number} a - 矩阵 [[**a**, c], [b, d]] 中的 a 分量
 * @property {number} b - 矩阵 [[a, c], [**b**, d]] 中的 b 分量
 * @property {number} c - 矩阵 [[a, **c**], [b, d]] 中的 c 分量
 * @property {number} d - 矩阵 [[a, c], [b, **d**]] 中的 d 分量
 */

/**
 * 通用矩形对象
 * @typedef {Object} Rect
 * @property {number} left - 左边界
 * @property {number} top - 上边界
 * @property {number} right - 右边界
 * @property {number} bottom - 下边界
 */

/**
 * 视口尺寸
 * @typedef {Object} ViewportSize
 * @property {number} width - 视口宽度
 * @property {number} height - 视口高度
 */

/**
 * 跨线程对象摘要
 * @typedef {Object} ObjectSummary
 * @property {number} id - 对象 id
 * @property {string} type - 对象类型名
 * @property {boolean} isActive - 是否在 AOM 动态图中
 * @property {Point2D} position - 世界坐标位置
 * @property {TransformMatrix2D | undefined} [transform] - 对象变换矩阵
 * @property {import("../range/rectangle.js").RectangleRange} boundingBox - 外接矩形
 * @property {import("../range/range.js").Range} range - 主判定范围
 * @property {Record<string, any>} property - 属性快照
 * @property {Record<string, any>} data - 类型专属几何数据快照（如 points、radius、text）
 */

export {};
