/**
 * @file 有向图模块
 * @module directed-graph
 * @author Zhou Chenyu
 */

/**
 * 自定义图错误基类
 * @class
 * @extends Error
 */
class GraphError extends Error {
  /**
   * 错误名称
   * @type {string}
   */
  name;

  /**
   * @param {string} message - 错误信息
   * @constructor
   */
  constructor(message) {
    super(message);
    this.name = "GraphError";
  }
}

/**
 * 节点不存在
 * @class
 * @extends GraphError
 */
class NodeNotExistError extends GraphError {
  /**
   * 不存在的节点
   * @type {*}
   */
  node;

  /**
   * @param {*} node - 不存在的节点
   * @constructor
   */
  constructor(node) {
    super(`Node ${node} does not exist.`);
    this.name = "NodeNotExistError";
    this.node = node;
  }
}

/**
 * 边不存在
 * @class
 * @extends GraphError
 */
class EdgeNotExistError extends GraphError {
  /**
   * 边起点
   * @type {*}
   */
  from;

  /**
   * 边终点
   * @type {*}
   */
  to;

  /**
   * @param {*} from - 不存在的边的起点
   * @param {*} to - 不存在的边的终点
   * @constructor
   */
  constructor(from, to) {
    super(`Edge from ${from} to ${to} does not exist.`);
    this.name = "EdgeNotExistError";
    this.from = from;
    this.to = to;
  }
}

/**
 * 节点已存在
 * @class
 * @extends GraphError
 */
class NodeAlreadyExistError extends GraphError {
  /**
   * 已存在的节点
   * @type {*}
   */
  node;

  /**
   * @param {*} node - 已存在的节点
   * @constructor
   */
  constructor(node) {
    super(`Node ${node} already exists.`);
    this.name = "NodeAlreadyExistError";
    this.node = node;
  }
}

/**
 * 边已存在
 * @class
 * @extends GraphError
 */
class EdgeAlreadyExistError extends GraphError {
  /**
   * 边起点
   * @type {*}
   */
  from;

  /**
   * 边终点
   * @type {*}
   */
  to;

  /**
   * @param {*} from - 已存在的边的起点
   * @param {*} to - 已存在的边的终点
   * @constructor
   */
  constructor(from, to) {
    super(`Edge from ${from} to ${to} already exists.`);
    this.name = "EdgeAlreadyExistError";
    this.from = from;
    this.to = to;
  }
}

/**
 * 有向图
 * @author Zhou Chenyu
 */
class DirectedGraph {
  /**
   * 该图的邻接表
   * @type {Map<*, Set<*>>}
   */
  adjList;

  /**
   * 该图的反向邻接表
   * @type {Map<*, Set<*>>}
   */
  adjListR;

  /**
   * 创建一个新的有向图
   * @constructor
   */
  constructor() {
    this.adjList = new Map();
    this.adjListR = new Map();
  }

  /**
   * 查询图中是否包含某个节点
   * @param {*} node - 要查询的节点
   * @returns {boolean} 如果图中包含该节点，则返回 true，否则返回 false
   */
  hasNode(node) {
    return this.adjList.has(node);
  }

  /**
   * 查询图中是否存在某边
   * @param {*} from - 起点
   * @param {*} to - 终点
   */
  hasEdge(from, to) {
    return this.adjList.has(from) && this.adjList.get(from).has(to);
  }

  /**
   * 添加一个节点
   * @param {*} node - 要添加的节点
   * @returns {DirectedGraph} 返回自身以方便链式调用
   */
  addNodeUnsafe(node) {
    this.adjList.set(node, new Set());
    this.adjListR.set(node, new Set());
    return this;
  }

  /**
   * 添加一个节点，如果节点已存在，则抛出错误
   * @param {*} node - 要添加的节点
   * @throws {NodeAlreadyExistError} 如果节点已存在
   * @returns {DirectedGraph} 返回自身以方便链式调用
   */
  addNode(node) {
    if (this.hasNode(node)) {
      throw new NodeAlreadyExistError(node);
    }
    return this.addNodeUnsafe(node);
  }

  /**
   * 添加一条边
   * @param {*} from - 起点
   * @param {*} to - 终点
   * @returns {DirectedGraph} 返回自身以方便链式调用
   */
  addEdgeUnsafe(from, to) {
    this.adjList.get(from).add(to);
    this.adjListR.get(to).add(from);
    return this;
  }

  /**
   * 添加一条边，如果起点或终点不存在，或边已存在，则抛出错误
   * @param {*} from - 起点
   * @param {*} to - 终点
   * @throws {NodeNotExistError | EdgeAlreadyExistError} 如果起点或终点不存在，或边已存在
   * @return {DirectedGraph} 返回自身以方便链式调用
   */
  addEdge(from, to) {
    if (!this.hasNode(from)) {
      throw new NodeNotExistError(from);
    }
    if (!this.hasNode(to)) {
      throw new NodeNotExistError(to);
    }
    if (this.hasEdge(from, to)) {
      throw new EdgeAlreadyExistError(from, to);
    }
    return this.addEdgeUnsafe(from, to);
  }

  /**
   * 删除一条边
   * @param {*} from - 起点
   * @param {*} to - 终点
   * @returns {DirectedGraph} 返回自身以方便链式调用
   */
  deleteEdgeUnsafe(from, to) {
    this.adjList.get(from).delete(to);
    this.adjListR.get(to).delete(from);
    return this;
  }

  /**
   * 删除一条边，如果起点或终点不存在，或边不存在，则抛出错误
   * @param {*} from - 起点
   * @param {*} to - 终点
   * @throws {NodeNotExistError | EdgeNotExistError} 如果起点或终点不存在，或边不存在
   * @return {DirectedGraph} 返回自身以方便链式调用
   */
  deleteEdge(from, to) {
    if (!this.hasNode(from)) {
      throw new NodeNotExistError(from);
    }
    if (!this.hasNode(to)) {
      throw new NodeNotExistError(to);
    }
    if (!this.hasEdge(from, to)) {
      throw new EdgeNotExistError(from, to);
    }
    return this.deleteEdgeUnsafe(from, to);
  }

  /**
   * 更改节点名称
   * @param {*} oldNode - 旧节点名称
   * @param {*} newNode - 新节点名称
   * @returns {DirectedGraph} 返回自身以方便链式调用
   */
  changeNodeNameUnsafe(oldNode, newNode) {
    const outgoing = this.adjList.get(oldNode);
    const incoming = this.adjListR.get(oldNode);

    this.adjList.delete(oldNode);
    this.adjListR.delete(oldNode);

    this.adjList.set(newNode, outgoing);
    this.adjListR.set(newNode, incoming);

    // 更新所有邻居的出边和入边
    for (const neighbor of outgoing) {
      this.adjListR.get(neighbor).delete(oldNode);
      this.adjListR.get(neighbor).add(newNode);
    }
    for (const neighbor of incoming) {
      this.adjList.get(neighbor).delete(oldNode);
      this.adjList.get(neighbor).add(newNode);
    }

    return this;
  }

  /**
   * 更改节点名称，若节点不存在，则抛出错误
   * @param {*} oldNode - 旧节点名称
   * @param {*} newNode - 新节点名称
   * @throws {NodeNotExistError | NodeAlreadyExistError} 如果旧节点不存在或新节点已存在
   * @return {DirectedGraph} 返回自身以方便链式调用
   */
  changeNodeName(oldNode, newNode) {
    if (!this.hasNode(oldNode)) {
      throw new NodeNotExistError(oldNode);
    }
    if (this.hasNode(newNode)) {
      throw new NodeAlreadyExistError(newNode);
    }
    return this.changeNodeNameUnsafe(oldNode, newNode);
  }

  /**
   * 删除某个节点的所有边 (包括出边和入边)
   * @param {*} node - 要删除边的节点
   * @returns {DirectedGraph} 返回自身以方便链式调用
   */
  deleteAllEdgesOfNodeUnsafe(node) {
    for (const neighbor of this.adjList.get(node)) {
      this.adjListR.get(neighbor).delete(node);
    }
    this.adjList.get(node).clear();
    for (const neighbor of this.adjListR.get(node)) {
      this.adjList.get(neighbor).delete(node);
    }
    this.adjListR.get(node).clear();
    return this;
  }

  /**
   * 删除某个节点的所有边 (包括出边和入边)，如果节点不存在，则抛出错误
   * @param {*} node - 要删除边的节点
   * @throws {NodeNotExistError} 如果节点不存在
   * @return {DirectedGraph} 返回自身以方便链式调用
   */
  deleteAllEdgesOfNode(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    return this.deleteAllEdgesOfNodeUnsafe(node);
  }

  /**
   * 删除某个节点及其所有关联的边
   * @param {*} node - 要删除的节点
   * @returns {DirectedGraph} 返回自身以方便链式调用
   */
  deleteNodeUnsafe(node) {
    this.deleteAllEdgesOfNodeUnsafe(node); // 先删除所有关联的边
    this.adjList.delete(node);
    this.adjListR.delete(node);
    return this;
  }

  /**
   * 删除某个节点及其所有关联的边，如果节点不存在，则抛出错误
   * @param {*} node - 要删除的节点
   * @throws {NodeNotExistError} 如果节点不存在
   * @return {DirectedGraph} 返回自身以方便链式调用
   */
  deleteNode(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    this.deleteNodeUnsafe(node);
    return this;
  }

  /**
   * 查询节点的后继点，如果节点不存在，则抛出错误
   * @param {*} node - 要查询的节点
   * @throws {NodeNotExistError} 如果节点不存在
   * @returns {Set<*> | undefined} 该节点的后继
   */
  neighbors(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    return this.neighborsUnsafe(node);
  }

  /**
   * 查询节点的后继点
   * @param {*} node - 要查询的节点
   * @returns {Set<*> | undefined} 该节点的后继
   */
  neighborsUnsafe(node) {
    return this.adjList.get(node);
  }

  /**
   * 查询节点的前驱点，如果节点不存在，则抛出错误
   * @param {*} node - 要查询的节点
   * @throws {NodeNotExistError} 如果节点不存在
   * @returns {Set<*> | undefined} 该节点的前驱
   */
  predecessors(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    return this.predecessorsUnsafe(node);
  }

  /**
   * 查询节点的前驱点
   * @param {*} node - 要查询的节点
   * @returns {Set<*> | undefined} 该节点的前驱
   */
  predecessorsUnsafe(node) {
    return this.adjListR.get(node);
  }

  /**
   * 图中节点数量
   * @returns {number} 节点数量
   */
  get size() {
    return this.adjList.size;
  }

  /**
   * 查询节点的入度
   * @param {*} node - 要查询的节点
   * @returns {number} 节点的入度
   */
  getInDegreeUnsafe(node) {
    return this.adjListR.get(node).size;
  }

  /**
   * 查询节点的入度，若节点不存在，则抛出错误
   * @param {*} node - 要查询的节点
   * @throws {NodeNotExistError} 如果节点不存在
   * @returns {number} 节点的入度
   */
  getInDegree(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    return this.getInDegreeUnsafe(node);
  }

  /**
   * 查询节点的出度
   * @param {*} node - 要查询的节点
   * @returns {number} 节点的出度
   */
  getOutDegreeUnsafe(node) {
    return this.adjList.get(node).size;
  }

  /**
   * 查询节点的出度，若节点不存在，则抛出错误
   * @param {*} node - 要查询的节点
   * @throws {NodeNotExistError} 如果节点不存在
   * @returns {number} 节点的出度
   */
  getOutDegree(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    return this.getOutDegreeUnsafe(node);
  }

  /**
   * 获取图中所有节点的入度映射
   * @returns {Map<*, number>} 节点到入度的映射
   */
  getInDegreeMap() {
    let inDegreeMap = new Map();
    for (const [node, predecessors] of this.adjListR.entries()) {
      inDegreeMap.set(node, predecessors.size);
    }
    return inDegreeMap;
  }

  /**
   * 获取所有入度为 0 的节点
   * @returns {Array<*>} 所有入度为 0 的节点
   */
  getNoIncomingNodes() {
    let noIncoming = [];
    for (const [node, predecessors] of this.adjListR.entries()) {
      if (predecessors.size === 0) {
        noIncoming.push(node);
      }
    }
    return noIncoming;
  }

  /**
   * 获取图中所有节点的出度映射
   * @returns {Map<*, number>} 节点到出度的映射
   */
  getOutDegreeMap() {
    let outDegreeMap = new Map();
    for (const [node, neighbors] of this.adjList.entries()) {
      outDegreeMap.set(node, neighbors.size);
    }
    return outDegreeMap;
  }

  /**
   * 获取所有出度为 0 的节点
   * @returns {Array<*>} 所有出度为 0 的节点
   */
  getNoOutgoingNodes() {
    let noOutgoing = [];
    for (const [node, neighbors] of this.adjList.entries()) {
      if (neighbors.size === 0) {
        noOutgoing.push(node);
      }
    }
    return noOutgoing;
  }

  /**
   * 获取图中所有节点
   * @returns {Array<*>} 图中所有节点
   */
  getNodes() {
    return Array.from(this.adjList.keys());
  }

  /**
   * 清空图
   * @returns {DirectedGraph} 返回自身以方便链式调用
   */
  clear() {
    this.adjList.clear();
    this.adjListR.clear();
    return this;
  }

  /**
   * 检测图是否为有向无环图 (DAG)
   * @returns {boolean} 如果图为 DAG，则返回 true，否则返回 false
   */
  isDAG() {
    // 使用 Kahn 算法检测是否有环
    let inDegreeMap = this.getInDegreeMap();
    let queue = [];
    for (const [node, inDegree] of inDegreeMap.entries()) {
      if (inDegree === 0) {
        queue.push(node);
      }
    }

    let visitedCount = 0;

    while (queue.length > 0) {
      let node = queue.shift();
      visitedCount++;

      for (const neighbor of this.neighborsUnsafe(node) || []) {
        inDegreeMap.set(neighbor, inDegreeMap.get(neighbor) - 1);
        if (inDegreeMap.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    return visitedCount === this.size;
  }

  /**
   * 检测图是否为空
   * @returns {boolean} 如果图为空，则返回 true，否则返回 false
   */
  isEmpty() {
    return this.size === 0;
  }

  /**
   * 从邻接表构建一个有向图实例
   * @param {Array<Array<any>>} arr - 邻接表表示的有向图
   * @example
   * let graph = DirectedGraph.parse([[1, [2, 3]], [2, [3]], [3, []]]);
   * // graph 表示的有向图为：1 -> 2, 1 -> 3, 2 -> 3
   * @static
   * @returns {DirectedGraph} 创建的实例
   */
  static parse(arr) {
    let graph = new DirectedGraph();

    for (const item of arr) {
      const from = item[0];
      if (!graph.hasNode(from)) {
        graph.addNodeUnsafe(from);
      }
      for (const to of item[1]) {
        if (!graph.hasNode(from)) {
          graph.addNodeUnsafe(from);
        }
        if (!graph.hasNode(to)) {
          graph.addNodeUnsafe(to);
        }
        graph.addEdgeUnsafe(from, to);
      }
    }

    return graph;
  }

  /**
   * 将图转换为邻接表表示的数组
   * @returns {Array<Array<any>>} 邻接表表示的数组
   */
  toArray() {
    let arr = [];
    for (const [node, neighbors] of this.adjList.entries()) {
      arr.push([node, Array.from(neighbors)]);
    }
    return arr;
  }

  /**
   * 将图转换为字符串表示
   * @returns {string} 图的字符串表示
   * @description 每行表示一个节点及其所有邻居，格式为 "node -> neighbor1, neighbor2, ..."，调试用。
   */
  toString() {
    let str = "";
    for (const [node, neighbors] of this.adjList.entries()) {
      str += `${node} -> ${Array.from(neighbors).join(", ")}\n`;
    }
    return str;
  }

  /**
   * 比较该图与另一个图是否相等
   * @param {DirectedGraph} otherGraph - 另一个有向图
   * @returns {boolean} 是否与另一个图相等，即节点和边均相同，相等则返回 true，否则返回 false
   */
  equals(otherGraph) {
    if (this.size !== otherGraph.size) {
      return false;
    }

    for (const node of this.getNodes()) {
      if (!otherGraph.hasNode(node)) {
        return false;
      }
      const thisNeighbors = this.neighborsUnsafe(node);
      const otherNeighbors = otherGraph.neighborsUnsafe(node);
      if (thisNeighbors.size !== otherNeighbors.size) {
        return false;
      }
      for (const neighbor of thisNeighbors) {
        if (!otherNeighbors.has(neighbor)) {
          return false;
        }
      }
    }

    return true;
  }
}

export {
  DirectedGraph,
  GraphError,
  NodeNotExistError,
  EdgeNotExistError,
  NodeAlreadyExistError,
  EdgeAlreadyExistError,
};
