/**
 * @file 共享类型定义
 * @description 定义 Core Worker 迁移阶段两线程共享的通用 JSDoc typedef。
 * @module core/engine/types/types
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
 * 视口通用接口
 * @description UI Viewport 与 Worker ViewportCore 的公共子集，供 shared/renderer 使用。
 * @typedef {Object} ViewportLike
 * @property {number} zoom - 缩放因子
 * @property {{ x: number, y: number }} origin - 视口原点（世界坐标）
 * @property {number} width - 视口宽度
 * @property {number} height - 视口高度
 * @property {() => import("../range/rectangle.js").RectangleRange} getViewportScreenRect - 获取视口屏幕矩形
 * @property {(rect: import("../range/rectangle.js").RectangleRange, padding?: number) => (import("../range/rectangle.js").RectangleRange | undefined)} worldRectToScreenRect - 世界坐标转屏幕坐标
 */

/**
 * 轻量对象条目
 * @description
 * UI 侧（creator / chooser / modifier）统一使用的纯数据对象协议，代替 BasicObject 实例在工具间传递。
 * 两种场景：
 * - **创建态**（creator `_entry`）：对象正在创建中，几何未定型，不包含 `range` / `boundingBox`。
 * - **摘要态**（summary-like）：已有对象的轻量快照，从 Worker 侧反序列化回来，包含 `range` / `boundingBox`。
 *
 * 消费端（如 modifier 的 `resolveModifiedObjectPosition`）通过 `Vector.parse()` 统一处理
 * `position` 的 `Vector` 和 `{ x, y }` 两种形态。
 * @typedef {Object} LightweightObjectEntry
 * @property {number} id - 对象 id
 * @property {string} type - 对象类型名（如 "StrokeObject"、"CircleObject"）
 * @property {Vector|Point2D} position - 世界坐标位置，创建态可为 Vector 实例，摘要态为 { x, y } 纯对象
 * @property {import("../range/rectangle.js").RectangleRange} [boundingBox] - 外接矩形（摘要态有，创建态无）
 * @property {import("../range/range.js").Range} [range] - 主判定范围（摘要态有，创建态无）
 * @property {Record<string, any>} property - 样式属性
 * @property {Record<string, any>} data - 类型专属几何数据（如 points、radius）
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
