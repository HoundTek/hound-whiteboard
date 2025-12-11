/**
 * @file 基本对象定义
 * @description
 * 定义白板系统中使用的所有基础类，包括:
 * - 基础渲染单元 Quark
 * - 多边形渲染单元 PolygonQuark: Quark
 * - 文本渲染单元 TextQuark: Quark
 * - 图像渲染单元 ImageQuark: Quark
 * - 基础对象 BasicObject
 * - 零维对象 ZeroDimensionObject: BasicObject
 * - 一维对象 OneDimensionObject: BasicObject
 * - 二维对象 TwoDimensionObject: BasicObject
 * @module basic-classes
 * @author Zhou Chenyu
 */

const { Matrix, Point } = require("../../../utils/math");

/**
 * Quark 抽象基类 - 最底层的渲染单元
 * @abstract
 * @class
 * @description 直接与 canvas 交互的最底层类，所有可渲染对象的基类
 * @author Zhou Chenyu
 */
class Quark {
  /**
   * 变换矩阵
   * @type {Matrix}
   * @default Matrix.identity()
   * @description 用于对象的几何变换（旋转、缩放等）
   */
  transform = Matrix.identity();

  /**
   * 位置
   * @type {Point}
   * @description 对象在画布上的位置
   */
  position;

  /**
   * 混合模式
   * @type {string}
   * @default "source-over"
   * @description Canvas 2D 上下文的 globalCompositeOperation 属性值
   * @see https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation
   */
  mixture = "source-over";

  /**
   * 创建一个新的 Quark 实例
   * @param {Point} p - 对象的初始位置坐标
   * @constructor
   */
  constructor(p) {
    this.transform = Matrix.identity();
    this.position = p;
  }

  /**
   * 将此对象序列化为普通 JSON 对象
   * @abstract
   * @returns {object} 序列化后的对象
   * @description 子类必须实现此方法以支持对象的持久化
   * @throws {Error} 基类未实现此方法
   */
  serialize() {
    throw new Error("Method not implemented.");
  }

  /**
   * 将序列化的对象转化为 Quark 实例
   * @abstract
   * @param {object} quark - 被序列化的 Quark 对象
   * @returns {Quark} Quark 实例
   * @static
   * @description 子类必须实现此方法以支持对象的持久化
   * @throws {Error} 基类未实现此方法
   */
  static parse(quark) {
    throw new Error("Method not implemented.");
  }
}

/**
 * 多边形渲染 Quark
 * @class
 * @extends Quark
 * @description 用于渲染实心多边形的 Quark 类
 * @author Zhou Chenyu
 */
class PolygonQuark extends Quark {
  /**
   * 多边形的顶点集
   * @type {Point[]}
   * @description 每一个点相对 position 的位置数组
   */
  points = [];

  /**
   * 多边形的填充颜色
   * @type {string}
   * @default "#000000"
   */
  color = "#000000";

  /**
   * 创建一个新的多边形 Quark
   * @param {Point} p - 多边形的位置坐标
   * @param {Point[]} points - 多边形的顶点集
   * @constructor
   */
  constructor(p, points) {
    super(p);
    this.points = points;
  }

  /**
   * 将序列化的对象转化为 PolygonQuark 实例
   * @param {Object} quark - 被序列化的 PolygonQuark 对象
   * @param {string} quark.type - 类型 (应为 "PolygonQuark")
   * @param {Object} quark.position - 坐标
   * @param {number} quark.position.x - 横坐标
   * @param {number} quark.position.y - 纵坐标
   * @param {string} quark.mixture - 混合模式
   * @param {number[][]} quark.points - 外点数据 (应为二维数组的数组)
   * @returns {PolygonQuark} PolygonQuark 实例
   * @static
   * @throws {Error} 当 type 不是 "solidPolygon" 时抛出错误
   * @example
   * const triangle = PolygonQuark.parse({
   *   type: "solidPolygon",
   *   position: { x: 100, y: 100 },
   *   mixture: "source-over",
   *   points: [[0, 0], [100, 100], [0, 100]],
   *   color: "#000000"
   * });
   */
  static parse(quark) {
    if (quark.type !== "solidPolygon") throw Error("Error: incorrect type");
    const q = new PolygonQuark(
      Point.parse(quark.position),
      quark.points.map((p) => Point.parseFromArray(p))
    );
    q.mixture = quark.mixture;
    return q;
  }

  /**
   * 将此对象序列化为普通 JSON 对象
   * @returns {{type: string, position: {x: number, y: number}, mixture: string, points: number[][], color: string}} 序列化后的对象
   * @description 将多边形 Quark 转换为可 JSON 序列化的格式
   */
  serialize() {
    return {
      type: "solidPolygon",
      position: this.position.serialize(),
      mixture: this.mixture,
      points: this.points.map((p) => p.serializeToArray()),
      color: this.color,
    };
  }
}

/**
 * 文本渲染 Quark
 * @class
 * @extends Quark
 * @description 用于在画布上渲染文本的 Quark 类
 * @author Zhou Chenyu
 */
class TextQuark extends Quark {
  /**
   * 文本内容
   * @type {string}
   */
  text;

  /**
   * 字号大小
   * @type {number}
   */
  size;

  /**
   * 文本颜色
   * @type {string}
   * @description 支持任何有效的 CSS 颜色值
   */
  color;

  /**
   * 字体名称
   * @type {string}
   */
  font;

  /**
   * 创建一个新的文本 Quark
   * @param {Point} p - 文本的位置坐标
   * @param {string} text - 文本文字
   * @param {number} size - 文本大小
   * @param {string} color - 文本颜色
   * @param {string} font - 文本字体
   * @constructor
   */
  constructor(p, text, size, color, font) {
    super(p);
    this.text = text;
    this.size = size;
    this.color = color;
    this.font = font;
  }

  /**
   * 将序列化的对象转化为 TextQuark 实例
   * @param {Object} quark - 被序列化的 TextQuark 对象
   * @param {string} quark.type - 类型 (应为 "text")
   * @param {Object} quark.position - 坐标
   * @param {number} quark.position.x - 横坐标
   * @param {number} quark.position.y - 纵坐标
   * @param {number[2][2]} quark.transform - 二维变换矩阵
   * @param {string} quark.mixture - 混合模式
   * @param {string} quark.text - 文字
   * @param {string} quark.font - 字体
   * @param {number} quark.size - 字号
   * @param {string} quark.color - 字色
   * @returns {TextQuark} TextQuark 实例
   * @static
   * @throws {Error} 当 type 不是 "text" 时抛出错误
   * @example
   * const exampleText = TextQuark.parse({
   *   type: "text",
   *   position: { x: 100, y: 100 },
   *   transform: [[1, 0], [0, 1]],
   *   mixture: "source-over",
   *   text: "This is an example text.",
   *   font: "Noto Sans CJK SC",
   *   size: 24,
   *   color: "#000000"
   * });
   */
  static parse(quark) {
    if (quark.type !== "text") throw Error("Error: incorrect type");
    const q = new TextQuark(
      Point.parse(quark.position),
      quark.text,
      quark.size,
      quark.color,
      quark.font
    );
    q.transform = Matrix.parse(quark.transform);
    q.mixture = quark.mixture;
    return q;
  }

  /**
   * 将此对象序列化为普通 JSON 对象
   * @returns {{type: string, position: {x: number, y: number}, transform: *, mixture: string, text: string, font: string, size: number, color: string}} 序列化后的对象
   * @description 将文本 Quark 转换为可 JSON 序列化的格式
   */
  serialize() {
    return {
      type: "text",
      position: this.position.serialize(),
      transform: this.transform.serialize(),
      mixture: this.mixture,
      text: this.text,
      font: this.font,
      size: this.size,
      color: this.color,
    };
  }
}

/**
 * 图片渲染 Quark
 * @class
 * @extends Quark
 * @description 用于在画布上渲染图片的 Quark 类
 * @author Zhou Chenyu
 */
class ImageQuark extends Quark {
  /**
   * 图片文件路径或 URL
   * @type {string}
   */
  src;

  /**
   * 图片宽度（像素）
   * @type {number}
   */
  width;

  /**
   * 图片高度（像素）
   * @type {number}
   */
  height;

  /**
   * 创建一个新的图片 Quark
   * @param {Point} p - 图片的位置坐标
   * @param {string} src - 图片的地址
   * @param {number} width - 图片的宽度
   * @param {number} height - 图片的高度
   * @constructor
   */
  constructor(p, src, width, height) {
    super(p);
    this.src = src;
    this.width = width;
    this.height = height;
  }

  /**
   * 将序列化的对象转化为 ImageQuark 实例
   * @param {Object} quark - 被序列化的 ImageQuark 对象
   * @param {string} quark.type - 类型 (应为 "img")
   * @param {Object} quark.position - 坐标
   * @param {number} quark.position.x - 横坐标
   * @param {number} quark.position.y - 纵坐标
   * @param {number[2][2]} quark.transform -
   * @param {string} quark.mixture - 混合模式
   * @param {string} quark.src - 图像路径
   * @param {number} quark.width - 图像宽度
   * @param {number} quark.height - 图像高度
   * @returns {ImageQuark} ImageQuark 实例
   * @static
   * @throws {Error} 当 type 不是 "img" 时抛出错误
   * @example
   * const archbtw = ImageQuark.parse({
   *   type: "img",
   *   position: { x: 100, y: 100 },
   *   transform: [[1, 0], [0, 1]],
   *   mixture: "source-over",
   *   src: "/home/zhouc_yu/Pictures/Wallpapers/archbtw.png",
   *   width: 1920,
   *   height: 1200
   * });
   */
  static parse(quark) {
    if (quark.type !== "img") throw Error("Error: incorrect type");
    const q = new ImageQuark(
      Point.parse(quark.position),
      quark.src,
      quark.width,
      quark.height
    );
    q.transform = Matrix.parse(quark.transform);
    q.mixture = quark.mixture;
    return q;
  }

  /**
   * 将此对象序列化为普通 JSON 对象
   * @returns {{type: string, position: {x: number, y: number}, transform: *, mixture: string, src: string, width: number, height: number}} 序列化后的对象
   * @description 将图片 Quark 转换为可 JSON 序列化的格式
   */
  serialize() {
    return {
      type: "img",
      position: this.position.serialize(),
      transform: this.transform.serialize(),
      mixture: this.mixture,
      src: this.src,
      width: this.width,
      height: this.height,
    };
  }
}

/**
 * 所有白板对象的抽象基类
 * @abstract
 * @class
 * @description 定义了所有白板对象的通用属性和方法，包括位置、变换、边界等
 * @author Zhou Chenyu
 */
class BasicObject {
  /**
   * 对象的位置
   * @type {Point}
   * @description 对象在画布上的位置坐标
   */
  position;

  /**
   * 变换矩阵
   * @type {Matrix}
   * @default Matrix.identity()
   * @description 用于对象的几何变换
   */
  transform = Matrix.identity();

  /**
   * 对象的矩形边界范围
   * @private
   * @type {Matrix}
   * @description 存储对象的边界矩形，用于碰撞检测和选择
   */
  #rectangle;

  /**
   * 设置对象的矩形边界范围
   * @param {Matrix} rect - 矩形边界矩阵
   * @description 设置边界时会自动计算几何中心
   */
  set rectangle(rect) {
    this.#rectangle = rect;
    this.#center = new Point(
      (rect.a + rect.c) / 2,
      (rect.b + rect.d) / 2
    ).applyTransform(this.transform.inv());
  }

  /**
   * 获取对象的矩形边界范围
   * @returns {Matrix} 矩形边界矩阵
   */
  get rectangle() {
    return this.#rectangle;
  }

  /**
   * 对象的凸包
   * @type {Point[]}
   * @description 用于更精确的碰撞检测，存储凸包的顶点坐标
   */
  convexHull;

  /**
   * 对象在变换前的几何中心
   * @private
   * @type {Point}
   * @description 存储对象的原始几何中心点
   */
  #center;

  /**
   * 对象的旋转中心点
   * @private
   * @type {Point}
   * @description 对象旋转时的中心点，仅对有向对象有效
   */
  #rotateCenter;

  /**
   * 获取对象的旋转中心
   * @returns {Point} 旋转中心点
   * @description 对于有向对象返回自定义旋转中心，否则返回几何中心
   */
  get rotateCenter() {
    if (this.isDirected) return this.#rotateCenter;
    return this.#center.applyTransform(this.transform.inv());
  }

  /**
   * 设置对象的旋转中心
   * @param {Point} rotateCenter - 新的旋转中心点
   * @throws {Error} 当对象不是有向对象时抛出错误
   */
  set rotateCenter(rotateCenter) {
    if (this.#isDirected) {
      this.#rotateCenter = rotateCenter;
    } else {
      throw new Error(
        "Error: the object is not directed so that it's rotate center can not be moved"
      );
    }
  }

  /**
   * 标识对象是否是有向对象
   * @private
   * @abstract
   * @type {boolean}
   * @default false
   * @readonly
   * @description 有向对象可以自定义旋转中心
   */
  #isDirected = false;

  /**
   * 获取对象是否是有向对象
   * @returns {boolean} 是否是有向对象
   */
  get isDirected() {
    return this.#isDirected;
  }

  /**
   * 该对象是否是可擦对象
   * @private
   * @abstract
   * @type {boolean}
   * @default false;
   * @readonly
   */
  #isErasable = false;

  /**
   * 获取对象是否是可擦对象
   * @returns {boolean} 是否是可擦对象
   */
  get isErasable() {
    return this.#isErasable;
  }

  /**
   * 创建一个新的基础对象
   * @param {Point} p - 对象的初始位置
   * @param {boolean} [erasable = false] - 对象是否为可擦对象
   * @param {boolean} [directed = false] - 对象是否为有向对象
   * @constructor
   */
  constructor(p, erasable = false, directed = false) {
    this.position = p;
    this.#isErasable = erasable;
    this.#isDirected = directed;
  }

  /**
   * 设置对象的变换矩阵
   *
   * **⚠ [warning] 你应该使用此方法而不是直接修改 transform ⚠**
   * @param {Matrix} trans - 新的变换矩阵
   */
  setTransform(trans) {
    this.transform = trans;
  }

  /**
   * 应用变换矩阵到对象
   * @param {Matrix} trans - 要应用的变换矩阵
   * @description 将变换矩阵与当前变换矩阵相乘
   */
  applyTransform(trans) {
    this.transform = this.transform.mul(trans);
  }

  /**
   * 获取该对象的渲染 Quark
   * @abstract
   * @returns {Quark[]} 多个 Quark 对象
   * @description 子类必须实现此方法以返回用于渲染的 Quark
   */
  getQuarks() {
    throw new Error("Method not implemented.");
  }

  /**
   * 将此对象序列化以持久化对象
   * @abstract
   * @returns {Object} 序列化后的对象
   * @description 子类必须实现此方法以支持对象的持久化
   * @throws {Error} 基类未实现此方法
   */
  serialize() {
    throw new Error("Method not implemented.");
  }

  /**
   * 将序列化的对象转化为对象实例
   * @abstract
   * @param {object} obj - 被序列化的对象
   * @returns {BasicObject} 对象实例
   * @static
   * @description 子类必须实现此方法以支持对象的持久化
   * @throws {Error} 基类未实现此方法
   */
  static parse(obj) {
    throw new Error("Method not implemented.");
  }
}

/**
 * 零维对象抽象基类
 * @abstract
 * @class
 * @extends BasicObject
 * @description 表示零维对象，对象自身没有长度和宽度
 * @author Zhou Chenyu
 */
class ZeroDimensionObject extends BasicObject {}

/**
 * 一维对象抽象基类
 * @abstract
 * @class
 * @extends BasicObject
 * @description 表示一维对象，对象自身只有长度没有宽度 (或只有长度没有宽度)
 * @author Zhou Chenyu
 */
class OneDimensionObject extends BasicObject {
  /**
   * 标识该一维对象的主轴是否是 x 轴
   * @private
   * @type {boolean}
   * @default true
   * @description true 表示主轴是 x 轴（水平），false 表示主轴是 y 轴（垂直）
   */
  #isMainAxisX = true;

  /**
   * 获取该一维对象的主轴是否是 x 轴
   * @returns {boolean} 主轴是否是 x 轴
   */
  get isMainAxisX() {
    return this.#isMainAxisX;
  }

  /**
   * 创建一个新的一维对象
   * @param {Point} p - 对象的初始位置
   * @param {boolean} [erasable = false] - 对象是否为可擦对象
   * @param {boolean} [directed = false] - 对象是否为有向对象
   * @param {boolean} [xAxis = true]
   * @constructor
   */
  constructor(p, erasable = false, directed = false, xAxis = true) {
    super(p, erasable, directed);
    this.#isMainAxisX = xAxis;
  }
}

/**
 * 二维对象抽象基类
 * @abstract
 * @class
 * @extends BasicObject
 * @description 表示二维对象，自身有长度和宽度
 * @author Zhou Chenyu
 */
class TwoDimensionObject extends BasicObject {}

module.exports = {
  Quark,
  TextQuark,
  ImageQuark,
  PolygonQuark,
  BasicObject,
  ZeroDimensionObject,
  OneDimensionObject,
  TwoDimensionObject,
};
