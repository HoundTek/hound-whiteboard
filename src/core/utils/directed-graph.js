/**
 * @file 层叠图实现
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
   * @type {any}
   */
  node;

  /**
   * @param {any} node - 不存在的节点
   * @constructor
   */
  constructor(node) {
    super(`Node ${node} is not exist.`);
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
   * @type {any}
   */
  from;

  /**
   * 边终点
   * @type {any}
   */
  to;

  /**
   * @param {any} from - 不存在的边的起点
   * @param {any} to - 不存在的边的终点
   * @constructor
   */
  constructor(from, to) {
    super(`Edge from ${from} to ${to} is not exist.`);
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
   * @type {any}
   */
  node;

  /**
   * @param {any} node - 已存在的节点
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
   * @type {any}
   */
  from;

  /**
   * 边终点
   * @type {any}
   */
  to;

  /**
   * @param {any} from - 已存在的边的起点
   * @param {any} to - 已存在的边的终点
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
   * @type {Map<any, Set<any>>}
   */
  adjList;

  /**
   * 该图的反向邻接表
   * @type {Map<any, Set<any>>}
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
   * @param {any} node - 要查询的节点
   * @returns {boolean} 如果图中包含该节点，则返回 true，否则返回 false
   */
  hasNode(node) {
    return this.adjList.has(node);
  }

  /**
   * 查询图中是否存在某边
   * @param {any} from - 起点
   * @param {any} to - 终点
   */
  hasEdge(from, to) {
    return this.adjList.has(from) && this.adjList.get(from).has(to);
  }

  /**
   * 添加一个节点
   * @param {any} node - 要添加的节点
   */
  addNodeUnsafe(node) {
    this.adjList.set(node, new Set());
    this.adjListR.set(node, new Set());
  }

  /**
   * 添加一个节点，如果节点已存在，则抛出错误
   * @param {any} node - 要添加的节点
   * @throws {NodeAlreadyExistError} 如果节点已存在
   */
  addNode(node) {
    if (this.hasNode(node)) {
      throw new NodeAlreadyExistError(node);
    }
    this.addNodeUnsafe(node);
  }

  /**
   * 添加一条边
   * @param {any} from - 起点
   * @param {any} to - 终点
   */
  addEdgeUnsafe(from, to) {
    this.adjList.get(from).add(to);
    this.adjListR.get(to).add(from);
  }

  /**
   * 添加一条边，如果起点或终点不存在，或边已存在，则抛出错误
   * @param {any} from - 起点
   * @param {any} to - 终点
   * @throws {NodeNotExistError | EdgeAlreadyExistError} 如果起点或终点不存在，或边已存在
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
   * @param {any} from - 起点
   * @param {any} to - 终点
   */
  deleteEdgeUnsafe(from, to) {
    this.adjList.get(from).delete(to);
    this.adjListR.get(to).delete(from);
  }

  /**
   * 删除一条边，如果起点或终点不存在，或边不存在，则抛出错误
   * @param {any} from - 起点
   * @param {any} to - 终点
   * @throws {NodeNotExistError | EdgeNotExistError} 如果起点或终点不存在，或边不存在
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
   * 更改节点名称
   * @param {any} oldNode - 旧节点名称
   * @param {any} newNode - 新节点名称
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
   * 更改节点名称，若节点不存在，则抛出错误
   * @param {any} oldNode - 旧节点名称
   * @param {any} newNode - 新节点名称
   * @throws {NodeNotExistError | NodeAlreadyExistError} 如果旧节点不存在或新节点已存在
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
   * @param {any} node - 要删除边的节点
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
   * 删除某个节点的所有边 (包括出边和入边)，如果节点不存在，则抛出错误
   * @param {any} node - 要删除边的节点
   * @throws {NodeNotExistError} 如果节点不存在
   */
  deleteAllEdgesOfNode(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    this.deleteAllEdgesOfNodeUnsafe(node);
  }

  /**
   * 删除某个节点及其所有关联的边
   * @param {any} node - 要删除的节点
   */
  deleteNodeUnsafe(node) {
    this.deleteAllEdgesOfNodeUnsafe(node); // 先删除所有关联的边
    this.adjList.delete(node);
    this.adjListR.delete(node);
  }

  /**
   * 删除某个节点及其所有关联的边，如果节点不存在，则抛出错误
   * @param {any} node - 要删除的节点
   * @throws {NodeNotExistError} 如果节点不存在
   */
  deleteNode(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    this.deleteNodeUnsafe(node);
  }

  /**
   * 查询节点的后继点，如果节点不存在，则抛出错误
   * @param {any} node - 要查询的节点
   * @throws {NodeNotExistError} 如果节点不存在
   * @returns {Set<any> | undefined} 该节点的后继
   */
  neighbors(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    return this.neighborsUnsafe(node);
  }

  /**
   * 查询节点的后继点
   * @param {any} node - 要查询的节点
   * @returns {Set<any> | undefined} 该节点的后继
   */
  neighborsUnsafe(node) {
    return this.adjList.get(node);
  }

  /**
   * 查询节点的前驱点，如果节点不存在，则抛出错误
   * @param {any} node - 要查询的节点
   * @throws {NodeNotExistError} 如果节点不存在
   * @returns {Set<any> | undefined} 该节点的前驱
   */
  predecessors(node) {
    if (!this.hasNode(node)) {
      throw new NodeNotExistError(node);
    }
    return this.predecessorsUnsafe(node);
  }

  /**
   * 查询节点的前驱点
   * @param {any} node - 要查询的节点
   * @returns {Set<any> | undefined} 该节点的前驱
   */
  predecessorsUnsafe(node) {
    return this.adjListR.get(node);
  }

  clear() {
    this.adjList.clear();
    this.adjListR.clear();
  }

  /**
   * 从 JSON 构建一个有向图实例
   * @param {Object} json - JSON
   * @static
   * @returns {DirectedGraph} 创建的实例
   */
  static parse(json) {
    let graph = new DirectedGraph();

    for (let fromKey in json) {
      let from = isNaN(Number(fromKey)) ? fromKey : Number(fromKey);
      if (!graph.hasNode(from)) {
        graph.addNodeUnsafe(from);
      }
      const neighbors = json[fromKey];
      for (let toKey of neighbors) {
        let to = isNaN(Number(toKey)) ? toKey : Number(toKey);
        if (!graph.hasNode(to)) {
          graph.addNodeUnsafe(to);
        }
        graph.addEdgeUnsafe(from, to);
      }
    }

    return graph;
  }

  toJSON() {
    let json = {};
    for (const [from, toSet] of this.adjList.entries()) {
      json[from] = Array.from(toSet);
    }
    return json;
  }

  toString() {
    return JSON.stringify(this.toJSON(), null, 2);
  }
}

module.exports = {
  DirectedGraph,
  GraphError,
  NodeNotExistError,
  EdgeNotExistError,
  NodeAlreadyExistError,
  EdgeAlreadyExistError,
};
