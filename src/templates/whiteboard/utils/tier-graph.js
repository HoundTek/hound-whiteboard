/**
 * @file 层叠图实现
 * @module tier-graph
 * @author Zhou Chenyu
 */

/**
 * 自定义图错误基类
 */
class GraphError extends Error {
  /**
   * 错误名称
   * @type {string}
   */
  name;

  constructor(message) {
    super(message);
    this.name = "GraphError";
  }
}

/**
 * 节点不存在错误
 */
class NodeNotExistError extends GraphError {
  /**
   * 不存在的节点
   * @type {number}
   */
  node;

  constructor(node) {
    super(`Node ${node} does not exist.`);
    this.name = "NodeNotExistError";
    this.node = node;
  }
}

/**
 * 边不存在错误
 */
class EdgeNotExistError extends GraphError {
  constructor(from, to) {
    super(`Edge from ${from} to ${to} does not exist.`);
    this.name = "EdgeNotExistError";
    this.from = from;
    this.to = to;
  }
}

/**
 * 节点已存在错误
 */
class NodeAlreadyExistError extends GraphError {
  constructor(node) {
    super(`Node ${node} already exists.`);
    this.name = "NodeAlreadyExistError";
    this.node = node;
  }
}

/**
 * 边已存在错误
 */
class EdgeAlreadyExistError extends GraphError {
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
   * @type {Map<number, Set<number>>}
   */
  adjList;

  /**
   * 该图的反向邻接表
   * @type {Map<number, Set<number>>}
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
   * @param {number} node - 要查询的节点
   * @returns {boolean} 如果图中包含该节点，则返回 true，否则返回 false。
   */
  hasNode(node) {
    return this.adjList.has(node);
  }

  /**
   * 查询图中是否存在从 fromNode 到 toNode 的边
   * @param {number} from - 起点
   * @param {number} to - 终点
   */
  hasEdge(from, to) {
    return this.adjList.has(from) && this.adjList.get(from).has(to);
  }

  /**
   * 添加一个节点到图中
   * @param {number} node - 要添加的节点
   */
  addNodeUnsafe(node) {
    this.adjList.set(node, new Set());
    this.adjListR.set(node, new Set());
  }

  /**
   * 添加一个节点到图中。如果节点已存在，则抛出错误。
   * @param {number} node - 要添加的节点
   * @throws {Error} 如果节点已存在
   */
  addNode(node) {
    if (this.hasNode(node)) {
      throw new NodeAlreadyExistError(node);
    }
    this.addNodeUnsafe(node);
  }

  /**
   * 添加一条边
   * @param {number} from - 起点
   * @param {number} to - 终点
   */
  addEdgeUnsafe(from, to) {
    this.adjList.get(from).add(to);
    this.adjListR.get(to).add(from);
  }

  /**
   * 添加一条边。如果起点或终点不存在，或边已存在，则抛出错误。
   * @param {number} from - 起点
   * @param {number} to - 终点
   * @throws {Error} 如果起点或终点不存在，或边已存在
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
    this.addEdgeUnsafe(from, to);
  }

  /**
   * 删除一条边
   * @param {number} from - 起点
   * @param {number} to - 终点
   */
  deleteEdgeUnsafe(from, to) {
    this.adjList.get(from).delete(to);
    this.adjListR.get(to).delete(from);
  }

  /**
   * 删除一条边。如果起点或终点不存在，或边不存在，则抛出错误。
   * @param {number} from - 起点
   * @param {number} to - 终点
   * @throws {Error} 如果起点或终点不存在，或边不存在
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
    this.deleteEdgeUnsafe(from, to);
  }

  /**
   * 更改节点名称（不安全版本）。
   * @param {number} oldNode - 旧节点名称
   * @param {number} newNode - 新节点名称
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
  }

  /**
   * 更改节点名称。若节点不存在，则抛出错误。
   * @param {number} oldNode - 旧节点名称
   * @param {number} newNode - 新节点名称
   * @throws {Error} 如果旧节点不存在或新节点已存在
   */
  changeNodeName(oldNode, newNode) {
    if (!this.hasNode(oldNode)) {
      throw new NodeNotExistError(oldNode);
    }
    if (this.hasNode(newNode)) {
      throw new NodeAlreadyExistError(newNode);
    }
    this.changeNodeNameUnsafe(oldNode, newNode);
  }

  /**
   * 删除某个节点的所有边 (包括出边和入边)
   * @param {number} node 要删除边的节点
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
  }

  /**
   * 删除某个节点的所有边 (包括出边和入边)。如果节点不存在，则抛出错误。
   * @param {number} node 要删除边的节点
   * @throws {Error} 如果节点不存在
   */
  deleteAllEdgesOfNode(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    this.deleteAllEdgesOfNodeUnsafe(node);
  }

  /**
   * 删除某个节点及其所有关联的边
   * @param {number} node - 要删除的节点
   */
  deleteNodeUnsafe(node) {
    this.deleteAllEdgesOfNodeUnsafe(node); // 先删除所有关联的边
    this.adjList.delete(node);
    this.adjListR.delete(node);
  }

  /**
   * 删除某个节点及其所有关联的边。如果节点不存在，则抛出错误。
   * @param {number} node - 要删除的节点
   * @throws {Error} 如果节点不存在
   */
  deleteNode(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    this.deleteNodeUnsafe(node);
  }
}

/**
 * 层叠图
 * @author Zhou Chenyu
 */
class TireManager {
  /**
   * 静态状态图
   * @type {DirectedGraph}
   */
  StaticGraph;

  /**
   * 动态状态图
   * @type {DirectedGraph}
   */
  DynamicGraph;

  /**
   * 创建一个新的层叠图管理器
   * @constructor
   */
  constructor() {
    this.StaticGraph = new DirectedGraph();
    this.DynamicGraph = new DirectedGraph();
  }
}

module.exports = {
  DirectedGraph,
  TireManager,
  GraphError,
  NodeNotExistError,
  EdgeNotExistError,
  NodeAlreadyExistError,
  EdgeAlreadyExistError,
};
