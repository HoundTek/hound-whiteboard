/**
 * @file 输入接线作用域
 * @description
 * 提供视口级别的设备子图与工具 workflow 接线 API。
 * 封装 viewportId 前缀拼接，将 mountDevice / mountWorkflow / addEdge 等操作
 * 定向到白板级 DevicesDAG 的对应 viewport 子树范围。
 * @module core/ui-thread/components/orchestration/input-scope
 * @author Zhou Chenyu
 */

import { joinPath } from "../../../engine/utils/path.js";

/**
 * 输入接线作用域
 * @class
 * @description
 * InputScope 是 Viewport 下设备子图与工具 workflow 的接线入口，职责如下：
 * - `mountDevice` — 挂载设备子图（mouse / keyboard / touchscreen 等）
 * - `mountWorkflow` — 挂载工具 workflow（笔画 / 选择 / 视口控制等）
 * - `addEdge` — 在设备与 workflow 之间建立信号通路（支持边级 prefix）
 * - `removeEdge` / `unmountWorkflow` — 拆除信号通路
 *
 * 路径模型：
 * - `mountDevice("mouse", subDAG)` → DAG 路径为 `/{viewportId}/mouse`
 * - `mountWorkflow("stroke", tool)` → DAG 路径为 `/{viewportId}/workflows/stroke`
 * - `addEdge({ from: "mouse/primary", to: "workflows/stroke" })`
 *   → DAG `/{viewportId}/mouse/primary` ──"default"──→ `/{viewportId}/workflows/stroke`
 * - `addEdge({ from: "toolswitcher/stroke" })` — 省略 to，创建匿名目标节点
 * - `addEdge({ from, to, name: "tool" })` — 指定边名
 * - `addEdge({ from, to, prefix: ... })` — 边级信号转换
 *
 * @author Zhou Chenyu
 */
class InputScope {
  /**
   * 所属 Board facade
   * @type {import("./board.js").Board}
   */
  _board;

  /**
   * 所属 Viewport facade
   * @type {import("./viewport.js").Viewport}
   */
  _viewport;

  /**
   * 视口 id
   * @type {string}
   */
  _viewportId;

  /**
   * 白板级设备图
   * @type {import("../../devices-dag/dag.js").DevicesDAG}
   */
  _dag;

  /**
   * @param {import("./board.js").Board} board - 白板实例
   * @param {import("./viewport.js").Viewport} viewport - 视口实例
   */
  constructor(board, viewport) {
    this._board = board;
    this._viewport = viewport;
    this._viewportId = viewport.viewportId;
    this._dag = board.devicesDAG;
  }

  /**
   * 获取所属 Board
   * @type {import("./board.js").Board}
   */
  get board() {
    return this._board;
  }

  /**
   * 获取白板级设备图
   * @type {import("../../devices-dag/dag.js").DevicesDAG}
   */
  get dag() {
    return this._dag;
  }

  /**
   * 挂载设备子图
   * @description
   * 将子图定义挂载到 `/{viewportId}/{name}` 路径下。
   * name 为空时使用子图自身的 rootPath（兼容旧子图定义）。
   * @param {string} name - 设备名（如 "mouse"/"keyboard"）
   * @param {import("../../devices-dag/dag.js").SubDAGDefinition} subDAG - 设备子图定义
   * @returns {import("../../devices-dag/dag-node-edge.js").DevicesDAGNode[]}
   */
  mountDevice(name, subDAG) {
    if (!subDAG || typeof subDAG !== "object") {
      throw new TypeError("mountDevice requires a valid SubDAGDefinition.");
    }

    return this._dag.mountSubDAG(this._viewportId, {
      ...subDAG,
      rootPath: name || subDAG.rootPath,
    });
  }

  /**
   * 挂载工具 workflow
   * @description
   * 将 workflow（Tool 实例或 SubDAGDefinition）挂载到
   * `/{viewportId}/workflows/{name}` 路径下。
   * @param {string} name - workflow 名（如 "stroke"/"view-control"）
   * @param {import("../../devices-dag/dag.js").Tool|import("../../devices-dag/dag.js").SubDAGDefinition} workflow - workflow 或子图定义
   * @returns {import("../../devices-dag/dag-node-edge.js").DevicesDAGNode|import("../../devices-dag/dag-node-edge.js").DevicesDAGNode[]}
   */
  mountWorkflow(name, workflow) {
    const path = joinPath("/", this._viewportId, "workflows", name);
    return this._dag.mountWorkflow(path, workflow);
  }

  /**
   * 在设备节点与 workflow 之间添加有向边
   * @description
   * `from` 和 `to` 均为相对于视口根的路径（如 "mouse/primary"）。
   * `name` 为边名，默认 "default"。可选 `prefix` 子图会作为边级的信号转换节点插入。
   * 省略 `to` 或传空串时创建匿名目标节点。
   * @param {Object} options - 边选项
   * @param {string} options.from - 源节点路径（相对于视口根，如 "mouse/primary"）
   * @param {string} [options.to=""] - 目标节点路径（相对于视口根，如 "workflows/stroke"）
   * @param {string} [options.name="default"] - 边名
   * @param {Object} [options.prefix] - 边级 prefix 子图定义
   * @returns {import("../../devices-dag/dag-node-edge.js").DevicesDAGEdge|undefined}
   */
  addEdge({ from, to = "", name = "default", prefix }) {
    if (typeof from !== "string") {
      throw new TypeError("addEdge requires 'from' path.");
    }

    const sourcePath = joinPath("/", this._viewportId, from);
    const targetPath = to ? joinPath("/", this._viewportId, to) : undefined;

    if (prefix) {
      const prefixSubDAG = { ...prefix, rootPath: name };
      const prefixNodes = this._dag.mountSubDAG(sourcePath, prefixSubDAG);
      const sinkNode = this._findPrefixSink(prefixNodes);
      if (sinkNode?.path) {
        return this._dag.addEdge(sinkNode.path, name, targetPath);
      }
      return undefined;
    }

    return this._dag.addEdge(sourcePath, name, targetPath);
  }

  /**
   * 移除有向边
   * @param {Object} options - 边选项
   * @param {string} options.from - 源节点路径（相对于视口根）
   * @param {string} [options.edge="default"] - 边名
   * @returns {boolean} 是否成功移除
   */
  removeEdge({ from, edge = "default" }) {
    return this._dag.removeEdge(joinPath("/", this._viewportId, from), edge);
  }

  /**
   * 卸载 workflow 并可选移除入边
   * @param {string} name - workflow 名
   * @param {Array<{from: string, edge?: string}>} [edgesToRemove=[]] - 要一并移除的入边列表
   * @returns {boolean} 是否成功卸载
   */
  unmountWorkflow(name, edgesToRemove = []) {
    const workflowPath = joinPath("/", this._viewportId, "workflows", name);

    for (const { from, edge = "default" } of edgesToRemove) {
      this._dag.removeEdge(joinPath("/", this._viewportId, from), edge);
    }

    return this._dag.unmountWorkflow(workflowPath, {
      board: this._board,
      boardApi: this._board?.getBoardApi?.(),
      viewport: this._viewport,
    });
  }

  /**
   * 在已挂载的单源单汇子图中找到汇节点（入度>0 且出度为 0 或其出边目标不在集合内）
   * @param {import("../../devices-dag/dag-node-edge.js").DevicesDAGNode[]} nodes - 子图节点列表
   * @returns {import("../../devices-dag/dag-node-edge.js").DevicesDAGNode|undefined}
   * @private
   */
  _findPrefixSink(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return undefined;
    if (nodes.length === 1) return nodes[0];

    return nodes.find((n) => {
      for (const outEdge of n.outEdges.values()) {
        if (nodes.includes(outEdge.target)) return false;
      }
      return true;
    });
  }
}

export { InputScope };
