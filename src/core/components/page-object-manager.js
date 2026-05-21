/**
 * 页静态对象管理器
 * @module page-object-manager
 * @author Zhou Chenyu
 */

import { DirectedGraph } from "../utils/directed-graph.js";
import { BasicObject } from "../objects/basic-obj.js";
import { deserialize } from "../objects/object-deserializer.js";
import { boardFileOperateBridge } from "../bridges/file-operate-bridge-renderer.js";
import { intersectsRanges, RectangleRange } from "../range/index.js";
import { Page } from "./page.js";

/**
 * 页静态对象管理器
 * @class
 * @author Zhou Chenyu
 */
class PageObjectManager {
  /**
   * 该页的静态图
   * @description 见 [tier-graph-document.md](./docs/tier-graph-document.md)。
   * 内部存储所有对象的层叠关系，包含在该页的对象（可以不属于该页）。存储对象 id，不拥有对象实例的所有权。
   * @type {DirectedGraph}
   */
  staticGraph;

  /**
   * 对象覆盖页集合索引
   * @description 对象 id -> 覆盖到的页 id 集合。
   * @type {Map<number, Set<number>>}
   */
  objectCoverPages;

  /**
   * 该页的对象映射
   * @description
   * 从对象 id 映射到对象实例。
   * 只包含该页内的对象，拥有对象实例的所有权。
   * @type {Map<number, BasicObject>}
   */
  pageObjects;

  /**
   * 页 id
   * @type {number}
   */
  id;

  constructor(pageId) {
    this.id = pageId;
    this.staticGraph = new DirectedGraph();
    this.objectCoverPages = new Map();
    this.pageObjects = new Map();
  }

  /**
   * 设置对象覆盖页集合
   * @param {number} objectId - 对象 id
   * @param {Iterable<number>} pageIds - 覆盖页 id 集合
   */
  setObjectCoverPages(objectId, pageIds) {
    const normalizedPageIds = new Set();
    for (const pageId of pageIds) {
      if (!Number.isInteger(pageId) || pageId <= 0) {
        throw new Error("Invalid covered page id.");
      }

      normalizedPageIds.add(pageId);
    }
    this.objectCoverPages.set(objectId, normalizedPageIds);
  }

  /**
   * 获取对象覆盖页集合
   * @param {number} objectId - 对象 id
   * @returns {Set<number>}
   */
  getObjectCoverPages(objectId) {
    return new Set(this.objectCoverPages.get(objectId) || []);
  }

  /**
   * 创建指定页坐标对应的页范围
   * @param {number} pageX - 页坐标 x
   * @param {number} pageY - 页坐标 y
   * @param {number} pageWidth - 页宽
   * @param {number} pageHeight - 页高
   * @returns {RectangleRange}
   */
  static createPageRange(pageX, pageY, pageWidth, pageHeight) {
    return new RectangleRange(
      pageX * pageWidth,
      pageY * pageHeight,
      pageWidth,
      pageHeight,
    );
  }

  /**
   * 计算一个世界坐标范围覆盖到的页 id 集合
   * @param {import("../range/range.js").Range} worldRange - 世界坐标范围
   * @param {number} pageWidth - 页宽
   * @param {number} pageHeight - 页高
   * @param {{approximationSegments?: number}} [options] - range 几何计算参数
   * @returns {Set<number>}
   */
  static calculateCoveredPageIdsForRange(
    worldRange,
    pageWidth,
    pageHeight,
    options = {},
  ) {
    if (!(worldRange instanceof Object) || worldRange == null) {
      throw new Error("Invalid world range.");
    }
    if (pageWidth <= 0 || pageHeight <= 0) {
      throw new Error("Invalid page size.");
    }

    const worldBoundingBox = RectangleRange.from(worldRange);
    const minPageX = Math.floor(worldBoundingBox.left / pageWidth);
    const maxPageX = Math.floor(
      (worldBoundingBox.left + worldBoundingBox.width) / pageWidth,
    );
    const minPageY = Math.floor(worldBoundingBox.top / pageHeight);
    const maxPageY = Math.floor(
      (worldBoundingBox.top + worldBoundingBox.height) / pageHeight,
    );

    const pageIds = new Set();
    for (let pageY = minPageY; pageY <= maxPageY; pageY++) {
      for (let pageX = minPageX; pageX <= maxPageX; pageX++) {
        const pageRange = PageObjectManager.createPageRange(
          pageX,
          pageY,
          pageWidth,
          pageHeight,
        );
        if (!intersectsRanges(worldRange, pageRange, options)) {
          continue;
        }
        pageIds.add(Page.coordinateToId(pageX, pageY));
      }
    }

    return pageIds;
  }

  /**
   * 根据对象 range 重新计算其覆盖页集合并写入索引
   * @param {BasicObject} obj - 对象实例
   * @param {number} pageWidth - 页宽
   * @param {number} pageHeight - 页高
   * @param {{approximationSegments?: number}} [options] - range 几何计算参数
   * @returns {Set<number>}
   */
  syncObjectCoverPagesForObject(obj, pageWidth, pageHeight, options = {}) {
    if (!(obj instanceof BasicObject)) {
      throw new Error("Invalid object instance.");
    }

    const worldRange = obj.getRange().withPosition(obj.position);
    const pageIds = PageObjectManager.calculateCoveredPageIdsForRange(
      worldRange,
      pageWidth,
      pageHeight,
      options,
    );

    if (pageIds.size === 0) {
      pageIds.add(obj.ownerPageId);
    }

    this.setObjectCoverPages(obj.id, pageIds);
    return pageIds;
  }

  /**
   * 根据当前页对象映射重建所有对象覆盖页索引
   * @param {number} pageWidth - 页宽
   * @param {number} pageHeight - 页高
   * @param {{approximationSegments?: number}} [options] - range 几何计算参数
   * @returns {Map<number, Set<number>>}
   */
  syncAllObjectCoverPages(pageWidth, pageHeight, options = {}) {
    this.objectCoverPages.clear();
    for (const obj of this.pageObjects.values()) {
      this.syncObjectCoverPagesForObject(obj, pageWidth, pageHeight, options);
    }
    return new Map(this.objectCoverPages);
  }

  /**
   * 将对象覆盖页索引序列化为可持久化结构
   * @returns {Array<[number, number[]]>}
   */
  serializeObjectCoverPages() {
    return Array.from(this.objectCoverPages.entries())
      .map(([objectId, pageIds]) => [
        objectId,
        Array.from(pageIds).sort((left, right) => left - right),
      ])
      .sort((left, right) => left[0] - right[0]);
  }

  /**
   * 从可持久化结构恢复对象覆盖页索引
   * @param {Array<[number, number[]]>} coverIndexData - 覆盖索引数据
   */
  loadObjectCoverPagesFromData(coverIndexData) {
    this.objectCoverPages.clear();
    for (const entry of coverIndexData || []) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new Error("Invalid object cover index entry.");
      }

      const [objectId, pageIds] = entry;
      if (!Number.isInteger(objectId)) {
        throw new Error("Invalid object id in cover index.");
      }

      this.setObjectCoverPages(objectId, pageIds || []);
    }
  }

  /**
   * 加载层叠图
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<void>} 加载完成
   * @description
   * 该方法只加载层叠图，不加载对象实例。
   * @throws {Error} 如果文件不存在
   */
  async loadTierGraph(boardRootPath) {
    // 通过专用 IPC 从主进程读取层叠图数据。
    const graphData = await boardFileOperateBridge.loadTierGraph(
      boardRootPath,
      this.id,
    );
    const coverIndexData =
      await boardFileOperateBridge.loadPageObjectCoverIndex(
        boardRootPath,
        this.id,
      );
    // 渲染侧只负责把 plain object 转回 DirectedGraph。
    this.staticGraph = DirectedGraph.parse(graphData);
    this.loadObjectCoverPagesFromData(coverIndexData);
  }

  /**
   * 保存层叠图
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<void>} 保存完成
   */
  async saveTierGraph(boardRootPath) {
    // 统一以数组结构落盘，避免传输复杂实例对象。
    await boardFileOperateBridge.saveTierGraph(
      boardRootPath,
      this.id,
      this.staticGraph.toArray(),
    );
    await boardFileOperateBridge.savePageObjectCoverIndex(
      boardRootPath,
      this.id,
      this.serializeObjectCoverPages(),
    );
  }

  /**
   * 卸载层叠图
   * @description 仅释放层叠图，保留对象映射。
   */
  unloadTierGraph() {
    this.staticGraph = new DirectedGraph();
    this.objectCoverPages.clear();
  }

  /**
   * 加载该页的所有对象
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<void>} 加载完成
   */
  async loadObjects(boardRootPath) {
    // 先清空旧映射，确保和磁盘状态一致。
    this.pageObjects.clear();

    const objectDataList = await boardFileOperateBridge.loadPageObjects(
      boardRootPath,
      this.id,
    );

    // 使用统一反序列化入口恢复具体对象类型。
    for (const objectData of objectDataList) {
      const obj = deserialize(objectData);
      this.pageObjects.set(obj.id, obj);
    }
  }

  /**
   * 保存该页的所有对象
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<void>} 保存完成
   */
  async saveObjects(boardRootPath) {
    /**
     * 当前页对象的可序列化快照。
     * @type {object[]}
     */
    const serializedObjects = Array.from(this.pageObjects.values()).map(
      (obj) => {
        if (obj && typeof obj.serialize === "function") {
          return obj.serialize();
        }
        return obj;
      },
    );

    await boardFileOperateBridge.savePageObjects(
      boardRootPath,
      this.id,
      serializedObjects,
    );
  }

  /**
   * 卸载该页的所有对象
   * @description 释放对象实例映射。
   */
  unloadObjects() {
    this.pageObjects.clear();
  }

  /**
   * 卸载该页全部数据
   * @description 统一释放层叠图与对象映射。
   */
  unload() {
    this.unloadObjects();
    this.unloadTierGraph();
  }

  /**
   * 解析页对象目录
   * @param {Directory} root - 白板根目录
   * @returns {Directory} 对象目录，如果根目录不存在或无法访问，则返回 undefined
   * @description 对象目录位于白板根目录下的 `objects/page{pageId}/`。
   */
  resolveObjectsDirectory(root) {
    if (!root) return undefined;
    return root.cd("objects").cd("page" + this.id.toString());
  }

  /**
   * 解析页层叠图文件位置
   * @param {Directory} root - 白板根目录
   * @returns {File} 层叠图文件，如果根目录不存在或无法访问，则返回 undefined
   * @description 层叠图文件位于白板根目录下的 `pages/{pageId}.json`。
   */
  resolveTierGraphFile(root) {
    if (!root) return undefined;
    return root.cd("pages").peek(this.id.toString(), "json");
  }
}

export { PageObjectManager };
