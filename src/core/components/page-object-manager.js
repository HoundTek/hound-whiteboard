/**
 * 页静态对象管理器
 * @module page-object-manager
 * @author Zhou Chenyu
 */

import { DirectedGraph } from "../utils/directed-graph.js";
import { BasicObject } from "../objects/basic-obj.js";
import { Directory, File } from "../../utils/io.js";

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
   * @param {Directory} root - 白板根目录
   * @returns {boolean} 是否成功加载
   * @description
   * 加载成功的条件是该页未被加载过且层叠图文件存在。
   * 加载成功后，页状态变为已加载且临时加载。
   * 该方法只加载层叠图，不加载对象实例。
   * @todo
   * @throws {Error} 如果文件不存在
   */
  loadTierGraph(root) {
    const tierGraphFile = this.resolveTierGraphFile(root);
    if (tierGraphFile.exist()) {
      this.staticGraph = DirectedGraph.parse(tierGraphFile.catJSON());
    } else {
      throw new Error(`file ${tierGraphFile.toUrl()} does not exist.`);
    }
  }

  /**
   * 保存层叠图
   * @param {Directory} root - 白板根目录
   * @todo
   */
  saveTierGraph(root) {
    const tierGraphFile = this.resolveTierGraphFile(root);
    tierGraphFile
      .rmWhenExist()
      .init()
      .write(JSON.stringify(this.staticGraph.toArray()));
  }

  /**
   * 卸载层叠图
   * @todo
   */
  unloadTierGraph() {
    this.staticGraph = null;
  }

  /**
   * 加载该页的所有对象
   * @param {Directory} root - 白板根目录
   * @todo
   */
  loadObjects(root) {
    const objectsDir = this.resolveObjectsDirectory(root);
    if (objectsDir) {
      const objectFiles = objectsDir
        .lsFile()
        .filter((file) => file.extension === "json");
      for (const file of objectFiles) {
        const obj = BasicObject.parse(file.catJSON());
        this.pageObjects.set(obj.id, obj);
      }
    }
  }

  /**
   * 保存该页的所有对象
   * @param {Directory} root - 白板根目录
   * @todo
   */
  saveObjects(root) {}

  /**
   * 卸载该页的所有对象
   * @todo
   */
  unloadObjects() {}

  /**
   * 卸载该页的所有对象
   * @todo
   */
  unload() {}

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
