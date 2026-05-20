/**
 * 页面组件
 * @description
 * 页面组件负责管理每一页的对象和层级关系，以及页的位置与唯一标识。
 * 每一页对应一个页面类实例。
 * @module page
 * @author Zhou Chenyu
 */

import { BasicObject } from "../objects/basic-obj.js";
import { PageObjectManager } from "./page-object-manager.js";

/**
 * 页面类
 * @class
 * @description 每一页对应一个页面类实例。
 * @author Zhou Chenyu
 */
class Page {
  /**
   * 页面上的对象管理
   * @description 包括页对象和层级关系
   * @type {PageObjectManager}
   */
  objectManager;

  /**
   * 页唯一标识
   * @type {number}
   */
  id;

  /**
   * 页二维坐标 x
   * @type {number}
   */
  x;

  /**
   * 页二维坐标 y
   * @type {number}
   */
  y;

  /**
   * 左页引用
   * @type {Page | undefined}
   */
  leftPage;

  /**
   * 右页引用
   * @type {Page | undefined}
   */
  rightPage;

  /**
   * 上页引用
   * @type {Page | undefined}
   */
  upPage;

  /**
   * 下页引用
   * @type {Page | undefined}
   */
  downPage;

  /**
   * 页是否已被加载到内存中
   * @type {boolean}
   */
  isLoad;

  /**
   * 页是否是临时被加载
   * @description
   * 若是临时被加载，那么它应只加载对象层叠关系。
   * 若不是临时被加载，那它还会加载页上所有对象。
   * @type {boolean}
   */
  isTempLoad;

  /**
   * 创建页面实例
   * @constructor
   * @param {number} pageId - 页 id
   */
  constructor(pageId) {
    const coordinate = Page.idToCoordinate(pageId);
    this.objectManager = undefined;
    this.id = pageId;
    this.x = coordinate.x;
    this.y = coordinate.y;
    this.leftPage = undefined;
    this.rightPage = undefined;
    this.upPage = undefined;
    this.downPage = undefined;
    this.isLoad = false;
    this.isTempLoad = false;
  }

  /**
   * 通过页 id 创建页面实例
   * @param {number} pageId - 页 id
   * @returns {Page}
   */
  static fromId(pageId) {
    return new Page(pageId);
  }

  /**
   * 通过二维坐标创建页面实例
   * @param {number} x - 页二维坐标 x
   * @param {number} y - 页二维坐标 y
   * @returns {Page}
   */
  static fromCoordinate(x, y) {
    const pageId = Page.coordinateToId(x, y);
    return new Page(pageId);
  }

  /**
   * 回字形 id 转二维坐标
   * @param {number} pageId - 页 id
   * @returns {{x: number, y: number}} 页二维坐标
   */
  static idToCoordinate(pageId) {
    if (!Number.isInteger(pageId) || pageId <= 0) {
      throw new Error("Invalid page id.");
    }

    if (pageId === 1) {
      return { x: 0, y: 0 };
    }

    const radius = Math.ceil((Math.sqrt(pageId) - 1) / 2);
    const maxId = (2 * radius + 1) ** 2;
    const diff = maxId - pageId;
    const edgeLength = radius * 2;

    if (diff < edgeLength) {
      return { x: radius - diff, y: -radius };
    }
    if (diff < edgeLength * 2) {
      return {
        x: -radius,
        y: -radius + (diff - edgeLength),
      };
    }
    if (diff < edgeLength * 3) {
      return {
        x: -radius + (diff - edgeLength * 2),
        y: radius,
      };
    }
    return {
      x: radius,
      y: radius - (diff - edgeLength * 3),
    };
  }

  /**
   * 二维坐标转回字形 id
   * @param {number} x - 页二维坐标 x
   * @param {number} y - 页二维坐标 y
   * @returns {number}
   */
  static coordinateToId(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error("Invalid page coordinate.");
    }

    const radius = Math.max(Math.abs(x), Math.abs(y));
    if (radius === 0) {
      return 1;
    }

    const maxId = (2 * radius + 1) ** 2;
    let diff = 0;

    if (y === -radius) {
      diff = radius - x;
    } else if (x === -radius) {
      diff = radius * 2 + (y + radius);
    } else if (y === radius) {
      diff = radius * 4 + (x + radius);
    } else if (x === radius) {
      diff = radius * 6 + (radius - y);
    } else {
      throw new Error("Coordinate is not on a valid spiral ring.");
    }

    return maxId - diff;
  }

  /**
   * 判断页 id 与二维坐标是否匹配
   * @param {number} pageId - 页 id
   * @param {number} x - 页二维坐标 x
   * @param {number} y - 页二维坐标 y
   * @returns {boolean}
   */
  static isValidPageIdentity(pageId, x, y) {
    if (
      !Number.isInteger(pageId) ||
      pageId <= 0 ||
      !Number.isInteger(x) ||
      !Number.isInteger(y)
    ) {
      return false;
    }

    const coordinate = Page.idToCoordinate(pageId);
    return coordinate.x === x && coordinate.y === y;
  }

  /**
   * 判断当前页是否合法
   * @returns {boolean}
   */
  isValid() {
    return Page.isValidPageIdentity(this.id, this.x, this.y);
  }

  /**
   * 断言当前页合法
   * @throws {Error} 若当前页不合法，则抛出错误
   */
  assertValid() {
    if (!this.isValid()) {
      throw new Error("Invalid page identity.");
    }
  }

  /**
   * 连接两页
   * @param {Page | undefined} first - 第一页
   * @param {Page | undefined} second - 第二页
   * @param {"right" | "left" | "up" | "down"} [direction = "right"] - second 相对 first 的方向，默认左右相邻
   * @description
   * 该方法会在 first 和 second 之间建立双向连接。
   * 仅更新页之间的引用关系，不会判断或修改页的二维坐标或 id。
   */
  static connectTwoPage(first, second, direction = "right") {
    if (!first || !second) return;

    const directions = {
      right: ["rightPage", "leftPage"],
      left: ["leftPage", "rightPage"],
      up: ["upPage", "downPage"],
      down: ["downPage", "upPage"],
    };
    const pair = directions[direction];
    if (!pair) {
      throw new Error("Invalid page connection direction.");
    }

    first[pair[0]] = second;
    second[pair[1]] = first;
  }

  /**
   * 添加对象并更新层叠图
   *
   * @param {BasicObject | number} obj - 要添加的对象或对象 id
   * @param {number[]} [below = []] - 应在该对象之下的对象
   * @param {number[]} [above = []] - 应在该对象之上的对象
   */
  addObject(obj, below = [], above = []) {
    if (!this.objectManager) {
      this.objectManager = new PageObjectManager(this.id);
    }

    const graph = this.objectManager.staticGraph;
    const objectId = obj instanceof BasicObject ? obj.id : obj;

    if (obj instanceof BasicObject) {
      this.objectManager.pageObjects.set(obj.id, obj);
    }

    if (!graph.hasNode(objectId)) {
      graph.addNodeUnsafe(objectId);
    }

    for (const from of below) {
      if (!graph.hasNode(from)) continue; // 在其它页，不管
      graph.addEdgeUnsafe(from, objectId);
    }
    for (const to of above) {
      if (!graph.hasNode(to)) continue; // 在其它页，不管
      graph.addEdgeUnsafe(objectId, to);
    }
  }

  /**
   * 完整加载该页
   * @description
   * @param {string} boardRootPath - 白板根目录
   * @todo
   * @returns {Promise<boolean>} 是否成功
   */
  async loadFull(boardRootPath) {
    // 已完整加载
    if (this.isLoad && !this.isTempLoad) return false;

    // 未加载，升级为临时加载
    if (!this.isLoad) await this.loadTemp(boardRootPath);
    this.isTempLoad = false;

    // 升级为完整加载，加载对象
    // [todo] 加载 Objects
    await this.objectManager.loadObjects(boardRootPath);
    return true;
  }

  /**
   * 完整卸载该页
   * @returns {boolean} 是否成功卸载
   * @description
   * 该方法会把该页变成未加载状态。
   * 无论该页之前是完整加载还是临时加载，调用后都会变成未加载状态。
   */
  unload() {
    if (this.objectManager) this.objectManager.unload();
    this.objectManager = undefined;
    this.isLoad = false;
    this.isTempLoad = false;
    return true;
  }

  /**
   * 卸载临时加载页
   * @returns {boolean} 是否成功卸载
   */
  unloadTemp() {
    if (!this.isLoad || !this.isTempLoad) {
      return false;
    }
    return this.unload();
  }

  /**
   * 从完整加载降级为临时加载
   * @returns {boolean} 是否成功降级
   * @description
   * 该方法会保留层叠图，只卸载完整加载阶段持有的对象内容。
   * 若当前页不是完整加载状态，则不进行任何操作。
   */
  downgradeToTemp() {
    if (!this.isLoad || this.isTempLoad) {
      return false;
    }
    if (this.objectManager) this.objectManager.unloadObjects();
    this.isTempLoad = true;
    return true;
  }

  /**
   * 临时加载该页
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<boolean>} 是否成功
   */
  async loadTemp(boardRootPath) {
    if (this.isLoad) {
      // 已加载，不管是完整加载还是临时加载，都不能重复加载
      return false;
    }
    this.isLoad = true;
    this.isTempLoad = true;
    if (!this.objectManager) {
      this.objectManager = new PageObjectManager(this.id);
    }
    await this.objectManager.loadTierGraph(boardRootPath);
    return true;
  }
}

export { Page };
