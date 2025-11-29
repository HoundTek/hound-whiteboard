const {
  DirectedGraph,
  TireManager,
  NodeNotExistError,
  EdgeNotExistError,
  NodeAlreadyExistError,
  EdgeAlreadyExistError,
} = require("../src/templates/whiteboard/utils/tier-graph");

describe("DirectedGraph", () => {
  /** @type {DirectedGraph} */
  let graph;

  beforeEach(() => {
    graph = new DirectedGraph();
  });

  test("构造函数应正确初始化 adjList 和 adjListR", () => {
    expect(graph.adjList).toBeInstanceOf(Map);
    expect(graph.adjList.size).toBe(0);
    expect(graph.adjListR).toBeInstanceOf(Map);
    expect(graph.adjListR.size).toBe(0);
  });

  test("addNodeUnsafe 应添加一个节点", () => {
    graph.addNodeUnsafe(1);
    expect(graph.adjList.has(1)).toBe(true);
    expect(graph.adjList.get(1)).toBeInstanceOf(Set);
    expect(graph.adjList.get(1).size).toBe(0);
    expect(graph.adjListR.has(1)).toBe(true);
    expect(graph.adjListR.get(1)).toBeInstanceOf(Set);
    expect(graph.adjListR.get(1).size).toBe(0);
  });

  test("addEdgeUnsafe 应添加一条边", () => {
    graph.addNodeUnsafe(1);
    graph.addNodeUnsafe(2);
    graph.addEdgeUnsafe(1, 2);

    expect(graph.adjList.get(1).has(2)).toBe(true);
    expect(graph.adjListR.get(2).has(1)).toBe(true);
  });

  test("hasNode 应正确检查节点是否存在", () => {
    graph.addNodeUnsafe(1);
    expect(graph.hasNode(1)).toBe(true);
    expect(graph.hasNode(2)).toBe(false);
  });

  test("hasEdge 应正确检查边是否存在", () => {
    graph.addNodeUnsafe(1);
    graph.addNodeUnsafe(2);
    graph.addEdgeUnsafe(1, 2);

    expect(graph.hasEdge(1, 2)).toBe(true);
    expect(graph.hasEdge(2, 1)).toBe(false);
    expect(graph.hasEdge(1, 3)).toBe(false);
  });

  test("deleteEdgeUnsafe 应删除一条边", () => {
    graph.addNodeUnsafe(1);
    graph.addNodeUnsafe(2);
    graph.addEdgeUnsafe(1, 2);
    expect(graph.hasEdge(1, 2)).toBe(true);

    graph.deleteEdgeUnsafe(1, 2);
    expect(graph.hasEdge(1, 2)).toBe(false);
    expect(graph.adjListR.get(2).has(1)).toBe(false);
  });

  test("deleteAllEdgesOfNodeUnsafe 应删除节点的所有边", () => {
    graph.addNodeUnsafe(1);
    graph.addNodeUnsafe(2);
    graph.addNodeUnsafe(3);
    graph.addEdgeUnsafe(1, 2);
    graph.addEdgeUnsafe(3, 1);
    graph.addEdgeUnsafe(1, 3);

    expect(graph.adjList.get(1).size).toBe(2);
    expect(graph.adjListR.get(1).size).toBe(1);

    graph.deleteAllEdgesOfNodeUnsafe(1);

    expect(graph.adjList.get(1).size).toBe(0);
    expect(graph.adjListR.get(1).size).toBe(0);
    expect(graph.adjList.get(3).has(1)).toBe(false); // 检查出边是否被删除
    expect(graph.adjListR.get(2).has(1)).toBe(false); // 检查入边是否被删除
  });

  test("deleteNodeUnsafe 应删除节点及其所有关联的边", () => {
    graph.addNodeUnsafe(1);
    graph.addNodeUnsafe(2);
    graph.addNodeUnsafe(3);
    graph.addEdgeUnsafe(1, 2);
    graph.addEdgeUnsafe(3, 1);

    expect(graph.hasNode(1)).toBe(true);
    expect(graph.hasEdge(1, 2)).toBe(true);
    expect(graph.hasEdge(3, 1)).toBe(true);

    graph.deleteNodeUnsafe(1);

    expect(graph.hasNode(1)).toBe(false);
    expect(graph.hasEdge(1, 2)).toBe(false);
    expect(graph.hasEdge(3, 1)).toBe(false);
    expect(graph.adjList.get(3).has(1)).toBe(false);
    expect(graph.adjListR.get(2).has(1)).toBe(false);
  });
  test("changeNodeNameUnsafe 应更改节点名称", () => {
    graph.addNodeUnsafe(1);
    graph.addNodeUnsafe(2);
    graph.addNodeUnsafe(3);
    graph.addEdgeUnsafe(1, 2);
    graph.addEdgeUnsafe(3, 1);

    graph.changeNodeNameUnsafe(1, 10);

    expect(graph.hasNode(1)).toBe(false);
    expect(graph.hasNode(10)).toBe(true);
    expect(graph.hasEdge(10, 2)).toBe(true);
    expect(graph.hasEdge(3, 10)).toBe(true);
    expect(graph.adjList.get(10).has(2)).toBe(true);
    expect(graph.adjListR.get(2).has(10)).toBe(true);
    expect(graph.adjList.get(3).has(10)).toBe(true);
    expect(graph.adjListR.get(10).has(3)).toBe(true);
  });
});

describe("DirectedGraph Safe Methods", () => {
  let graph;

  beforeEach(() => {
    graph = new DirectedGraph();
  });

  test("addNode 应添加一个节点", () => {
    graph.addNode(1);
    expect(graph.hasNode(1)).toBe(true);
  });

  test("addNode 应在节点已存在时抛出错误", () => {
    graph.addNode(1);
    expect(() => graph.addNode(1)).toThrow(NodeAlreadyExistError);
  });

  test("addEdge 应添加一条边", () => {
    graph.addNode(1);
    graph.addNode(2);
    graph.addEdge(1, 2);
    expect(graph.hasEdge(1, 2)).toBe(true);
  });

  test("addEdge 应在起点不存在时抛出错误", () => {
    graph.addNode(2);
    expect(() => graph.addEdge(1, 2)).toThrow(NodeNotExistError);
  });

  test("addEdge 应在终点不存在时抛出错误", () => {
    graph.addNode(1);
    expect(() => graph.addEdge(1, 2)).toThrow(NodeNotExistError);
  });

  test("addEdge 应在边已存在时抛出错误", () => {
    graph.addNode(1);
    graph.addNode(2);
    graph.addEdge(1, 2);
    expect(() => graph.addEdge(1, 2)).toThrow(
      EdgeAlreadyExistError
    );
  });

  test("deleteEdge 应删除一条边", () => {
    graph.addNode(1);
    graph.addNode(2);
    graph.addEdge(1, 2);
    expect(graph.hasEdge(1, 2)).toBe(true);
    graph.deleteEdge(1, 2);
    expect(graph.hasEdge(1, 2)).toBe(false);
  });

  test("deleteEdge 应在起点不存在时抛出错误", () => {
    graph.addNode(2);
    expect(() => graph.deleteEdge(1, 2)).toThrow(NodeNotExistError);
  });

  test("deleteEdge 应在终点不存在时抛出错误", () => {
    graph.addNode(1);
    expect(() => graph.deleteEdge(1, 2)).toThrow(NodeNotExistError);
  });

  test("deleteEdge 应在边不存在时抛出错误", () => {
    graph.addNode(1);
    graph.addNode(2);
    expect(() => graph.deleteEdge(1, 2)).toThrow(
      EdgeNotExistError
    );
  });

  test("deleteNode 应删除节点及其所有关联的边", () => {
    graph.addNode(1);
    graph.addNode(2);
    graph.addEdge(1, 2);
    expect(graph.hasNode(1)).toBe(true);
    graph.deleteNode(1);
    expect(graph.hasNode(1)).toBe(false);
    expect(graph.hasEdge(1, 2)).toBe(false);
  });

  test("deleteNode 应在节点不存在时抛出错误", () => {
    expect(() => graph.deleteNode(1)).toThrow(NodeNotExistError);
  });

  test("deleteAllEdgesOfNode 应删除节点的所有边", () => {
    graph.addNode(1);
    graph.addNode(2);
    graph.addNode(3);
    graph.addEdge(1, 2);
    graph.addEdge(3, 1);
    graph.addEdge(1, 3);

    expect(graph.adjList.get(1).size).toBe(2);
    expect(graph.adjListR.get(1).size).toBe(1);

    graph.deleteAllEdgesOfNode(1);

    expect(graph.adjList.get(1).size).toBe(0);
    expect(graph.adjListR.get(1).size).toBe(0);
    expect(graph.adjList.get(3).has(1)).toBe(false); // 检查出边是否被删除
    expect(graph.adjListR.get(2).has(1)).toBe(false); // 检查入边是否被删除
  });

  test("deleteAllEdgesOfNode 应在节点不存在时抛出错误", () => {
    expect(() => graph.deleteAllEdgesOfNode(1)).toThrow(NodeNotExistError);
  });

  test("changeNodeName 应更改节点名称", () => {
    graph.addNode(1);
    graph.addNode(2);
    graph.addNode(3);
    graph.addEdge(1, 2);
    graph.addEdge(3, 1);

    graph.changeNodeName(1, 10);

    expect(graph.hasNode(1)).toBe(false);
    expect(graph.hasNode(10)).toBe(true);
    expect(graph.hasEdge(10, 2)).toBe(true);
    expect(graph.hasEdge(3, 10)).toBe(true);
  });

  test("changeNodeName 应在旧节点不存在时抛出错误", () => {
    graph.addNode(2);
    expect(() => graph.changeNodeName(1, 10)).toThrow(NodeNotExistError);
  });

  test("changeNodeName 应在新节点已存在时抛出错误", () => {
    graph.addNode(1);
    graph.addNode(10);
    expect(() => graph.changeNodeName(1, 10)).toThrow(NodeAlreadyExistError);
  });
});

describe("TireManager", () => {
  test("TireManager 应具有 DirectedGraph 类型的 StaticGraph 和 DynamicGraph 属性", () => {
    const tireManager = new TireManager();
    expect(tireManager.StaticGraph).toBeInstanceOf(DirectedGraph);
    expect(tireManager.DynamicGraph).toBeInstanceOf(DirectedGraph);
  });
});
