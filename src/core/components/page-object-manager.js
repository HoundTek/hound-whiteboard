/**
 * 页静态对象管理器
 * @module page-object-manager
 * @author Zhou Chenyu
 */

import { DirectedGraph } from "../utils/directed-graph.js";
import { BasicObject } from "../objects/basic-obj.js";
import { deserialize } from "../objects/object-deserializer.js";
import { boardFileOperateBridge } from "./file-operate-bridge-renderer.js";

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
   * 向左跨页对象集合
   * @type {Set<number>}
   * @description 包含在该页的、向跨左页的对象，可以不属于该页。
   */
  coverLeftPage;

  /**
   * 向右跨页对象集合
   * @type {Set<number>}
   * @description 包含在该页的、向跨右页的对象，可以不属于该页。
   */
  coverRightPage;

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
    this.coverLeftPage = new Set();
    this.coverRightPage = new Set();
    this.pageObjects = new Map();
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
    // 渲染侧只负责把 plain object 转回 DirectedGraph。
    this.staticGraph = DirectedGraph.parse(graphData);
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
  }

  /**
   * 卸载层叠图
   * @description 仅释放层叠图，保留对象映射。
   */
  unloadTierGraph() {
    this.staticGraph = new DirectedGraph();
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

export {
  PageObjectManager,
};
