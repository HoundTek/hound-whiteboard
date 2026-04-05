const {
  DirectedGraph,
  NodeNotExistError,
  EdgeNotExistError,
  NodeAlreadyExistError,
  EdgeAlreadyExistError,
} = require("../directed-graph");

describe("DirectedGraph", () => {
  let graph = new DirectedGraph();

  beforeEach(() => {
    graph = new DirectedGraph();
  });

  describe("构造函数", () => {
    test("应正确初始化 adjList 和 adjListR", () => {
      expect(graph.adjList).toBeInstanceOf(Map);
      expect(graph.adjList.size).toBe(0);
      expect(graph.adjListR).toBeInstanceOf(Map);
      expect(graph.adjListR.size).toBe(0);
    });
  });

  describe("图的修改方法", () => {
    describe("添加节点", () => {
      test("addNode 应添加一个节点", () => {
        graph.addNode(1);
        expect(graph.adjList.has(1)).toBe(true);
        expect(graph.adjList.get(1)).toBeInstanceOf(Set);
        expect(graph.adjList.get(1).size).toBe(0);
        expect(graph.adjListR.has(1)).toBe(true);
        expect(graph.adjListR.get(1)).toBeInstanceOf(Set);
        expect(graph.adjListR.get(1).size).toBe(0);
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

      test("addNode 应在节点已存在时抛出错误", () => {
        graph.addNode(1);
        expect(() => graph.addNode(1)).toThrow(NodeAlreadyExistError);
      });
    });

    describe("添加边", () => {
      test("addEdge 应添加一条边", () => {
        graph.addNode(1);
        graph.addNode(2);
        graph.addEdge(1, 2);

        expect(graph.adjList.get(1).has(2)).toBe(true);
        expect(graph.adjListR.get(2).has(1)).toBe(true);
      });

      test("addEdgeUnsafe 应添加一条边", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addEdgeUnsafe(1, 2);

        expect(graph.adjList.get(1).has(2)).toBe(true);
        expect(graph.adjListR.get(2).has(1)).toBe(true);
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
        expect(() => graph.addEdge(1, 2)).toThrow(EdgeAlreadyExistError);
      });
    });

    describe("删除边", () => {
      test("deleteEdgeUnsafe 应删除一条边", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addEdgeUnsafe(1, 2);
        expect(graph.hasEdge(1, 2)).toBe(true);

        graph.deleteEdgeUnsafe(1, 2);
        expect(graph.hasEdge(1, 2)).toBe(false);
        expect(graph.adjListR.get(2).has(1)).toBe(false);
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
        expect(() => graph.deleteEdge(1, 2)).toThrow(EdgeNotExistError);
      });
    });

    describe("删除节点", () => {
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

      test("deleteAllEdgesOfNodeUnsafe 应删除节点的所有边但不删除节点本身", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addNodeUnsafe(3);
        graph.addEdgeUnsafe(1, 2);
        graph.addEdgeUnsafe(3, 1);
        graph.addEdgeUnsafe(1, 3);

        expect(graph.adjList.get(1).size).toBe(2);
        expect(graph.adjListR.get(1).size).toBe(1);

        graph.deleteAllEdgesOfNodeUnsafe(1);

        expect(graph.hasNode(1)).toBe(true);
        expect(graph.adjList.get(1).size).toBe(0);
        expect(graph.adjListR.get(1).size).toBe(0);
        expect(graph.adjList.get(3).has(1)).toBe(false); // 检查出边是否被删除
        expect(graph.adjListR.get(2).has(1)).toBe(false); // 检查入边是否被删除
      });

      test("deleteAllEdgesOfNode 应删除节点的所有边但不删除节点本身", () => {
        graph.addNode(1);
        graph.addNode(2);
        graph.addNode(3);
        graph.addEdge(1, 2);
        graph.addEdge(3, 1);
        graph.addEdge(1, 3);

        expect(graph.adjList.get(1).size).toBe(2);
        expect(graph.adjListR.get(1).size).toBe(1);

        graph.deleteAllEdgesOfNode(1);

        expect(graph.hasNode(1)).toBe(true);
        expect(graph.adjList.get(1).size).toBe(0);
        expect(graph.adjListR.get(1).size).toBe(0);
        expect(graph.adjList.get(3).has(1)).toBe(false); // 检查出边是否被删除
        expect(graph.adjListR.get(2).has(1)).toBe(false); // 检查入边是否被删除
      });

      test("deleteAllEdgesOfNode 应在节点不存在时抛出错误", () => {
        expect(() => graph.deleteAllEdgesOfNode(1)).toThrow(NodeNotExistError);
      });
    });

    describe("更改节点名称", () => {
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
        expect(() => graph.changeNodeName(1, 10)).toThrow(
          NodeAlreadyExistError
        );
      });
    });

    describe("清空图", () => {
      test("clear 应清空图", () => {
        graph.addNode(1);
        graph.addNode(2);
        graph.addEdge(1, 2);

        graph.clear();

        expect(graph.adjList.size).toBe(0);
        expect(graph.adjListR.size).toBe(0);
      });
    });

    describe("链式调用", () => {
      test("应支持链式调用", () => {
        graph.addNode(1);
        graph.addNode(2);
        graph.addEdge(1, 2);
        graph.deleteEdge(1, 2);
        graph.deleteNode(1);
        expect(
          new DirectedGraph()
            .addNode(1)
            .addNode(2)
            .addEdge(1, 2)
            .deleteEdge(1, 2)
            .deleteNode(1)
            .equals(graph)
        ).toBe(true);
      });
    });
  });

  describe("图的查询方法", () => {
    describe("查询后继", () => {
      test("neighborsUnsafe 应返回节点的所有后继", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addNodeUnsafe(3);
        graph.addNodeUnsafe(4);
        graph.addEdgeUnsafe(1, 2);
        graph.addEdgeUnsafe(1, 3);
        graph.addEdgeUnsafe(1, 4);
        graph.addEdgeUnsafe(2, 3);

        const neighbors = graph.neighborsUnsafe(1);
        expect(neighbors).toBeInstanceOf(Set);
        expect(neighbors.size).toBe(3);
        expect(neighbors.has(2)).toBe(true);
        expect(neighbors.has(3)).toBe(true);
        expect(neighbors.has(4)).toBe(true);
        expect(neighbors.has(1)).toBe(false);
        expect(neighbors.has(5)).toBe(false);
      });

      test("neighbors 应返回节点的所有后继", () => {
        graph.addNode(1);
        graph.addNode(2);
        graph.addNode(3);
        graph.addNode(4);
        graph.addEdge(1, 2);
        graph.addEdge(1, 3);
        graph.addEdge(1, 4);
        graph.addEdge(2, 3);

        const neighbors = graph.neighbors(1);
        expect(neighbors).toBeInstanceOf(Set);
        expect(neighbors.size).toBe(3);
        expect(neighbors.has(2)).toBe(true);
        expect(neighbors.has(3)).toBe(true);
        expect(neighbors.has(4)).toBe(true);
        expect(neighbors.has(1)).toBe(false);
        expect(neighbors.has(5)).toBe(false);
      });

      test("neighbors 应在节点不存在时抛出错误", () => {
        expect(() => graph.neighbors(1)).toThrow(NodeNotExistError);
      });
    });

    describe("查询前驱", () => {
      test("predecessorsUnsafe 应返回节点的所有前驱", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addNodeUnsafe(3);
        graph.addNodeUnsafe(4);
        graph.addEdgeUnsafe(2, 1);
        graph.addEdgeUnsafe(3, 1);
        graph.addEdgeUnsafe(4, 1);
        graph.addEdgeUnsafe(3, 2);

        const predecessors = graph.predecessorsUnsafe(1);
        expect(predecessors).toBeInstanceOf(Set);
        expect(predecessors.size).toBe(3);
        expect(predecessors.has(2)).toBe(true);
        expect(predecessors.has(3)).toBe(true);
        expect(predecessors.has(4)).toBe(true);
        expect(predecessors.has(1)).toBe(false);
        expect(predecessors.has(5)).toBe(false);
      });

      test("predecessors 应返回节点的所有前驱", () => {
        graph.addNode(1);
        graph.addNode(2);
        graph.addNode(3);
        graph.addNode(4);
        graph.addEdge(2, 1);
        graph.addEdge(3, 1);
        graph.addEdge(4, 1);
        graph.addEdge(3, 2);

        const predecessors = graph.predecessors(1);
        expect(predecessors).toBeInstanceOf(Set);
        expect(predecessors.size).toBe(3);
        expect(predecessors.has(2)).toBe(true);
        expect(predecessors.has(3)).toBe(true);
        expect(predecessors.has(4)).toBe(true);
        expect(predecessors.has(1)).toBe(false);
        expect(predecessors.has(5)).toBe(false);
      });

      test("predecessors 应在节点不存在时抛出错误", () => {
        expect(() => graph.predecessors(1)).toThrow(NodeNotExistError);
      });
    });

    describe("查询度数", () => {
      test("getInDegreeUnsafe 应返回节点的入度", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addNodeUnsafe(3);
        graph.addEdgeUnsafe(2, 1);
        graph.addEdgeUnsafe(3, 1);

        const inDegree = graph.getInDegreeUnsafe(1);
        expect(inDegree).toBe(2);
      });

      test("getInDegree 应返回节点的入度", () => {
        graph.addNode(1);
        graph.addNode(2);
        graph.addNode(3);
        graph.addEdge(2, 1);
        graph.addEdge(3, 1);

        const inDegree = graph.getInDegree(1);
        expect(inDegree).toBe(2);
      });

      test("getInDegree 应在节点不存在时抛出错误", () => {
        expect(() => graph.getInDegree(1)).toThrow(NodeNotExistError);
      });

      test("getOutDegreeUnsafe 应返回节点的出度", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addNodeUnsafe(3);
        graph.addEdgeUnsafe(1, 2);
        graph.addEdgeUnsafe(1, 3);

        const outDegree = graph.getOutDegreeUnsafe(1);
        expect(outDegree).toBe(2);
      });

      test("getOutDegree 应返回节点的出度", () => {
        graph.addNode(1);
        graph.addNode(2);
        graph.addNode(3);
        graph.addEdge(1, 2);
        graph.addEdge(1, 3);

        const outDegree = graph.getOutDegree(1);
        expect(outDegree).toBe(2);
      });

      test("getOutDegree 应在节点不存在时抛出错误", () => {
        expect(() => graph.getOutDegree(1)).toThrow(NodeNotExistError);
      });
    });

    describe("查询所有节点", () => {
      test("getNodes 应返回图中所有节点", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addNodeUnsafe(3);

        const nodes = graph.getNodes();
        expect(nodes).toBeInstanceOf(Array);
        expect(nodes.length).toBe(3);
        expect(nodes).toContain(1);
        expect(nodes).toContain(2);
        expect(nodes).toContain(3);
      });
    });

    describe("查询入度为 0 的节点", () => {
      test("getNoIncomingNodes 应返回所有入度为 0 的节点", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addNodeUnsafe(3);
        graph.addEdgeUnsafe(1, 2);

        const noIncoming = graph.getNoIncomingNodes();
        expect(noIncoming).toBeInstanceOf(Array);
        expect(noIncoming.length).toBe(2);
        expect(noIncoming).toContain(1);
        expect(noIncoming).toContain(3);
        expect(noIncoming).not.toContain(2);
      });
    });

    describe("查询出度为 0 的节点", () => {
      test("getNoOutgoingNodes 应返回所有出度为 0 的节点", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addNodeUnsafe(3);
        graph.addEdgeUnsafe(1, 2);

        const noOutgoing = graph.getNoOutgoingNodes();
        expect(noOutgoing).toBeInstanceOf(Array);
        expect(noOutgoing.length).toBe(2);
        expect(noOutgoing).toContain(2);
        expect(noOutgoing).toContain(3);
        expect(noOutgoing).not.toContain(1);
      });
    });
  });

  describe("图的存在性检查方法", () => {
    describe("检查节点存在性", () => {
      test("hasNode 应返回节点是否存在", () => {
        expect(graph.hasNode(1)).toBe(false);
        graph.addNodeUnsafe(1);
        expect(graph.hasNode(1)).toBe(true);
      });
    });

    describe("检查边存在性", () => {
      test("hasEdge 应返回边是否存在", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        expect(graph.hasEdge(1, 2)).toBe(false);
        graph.addEdgeUnsafe(1, 2);
        expect(graph.hasEdge(1, 2)).toBe(true);
      });
    });
  });

  describe("图的判断方法", () => {
    describe("isEmpty 应判断图是否为空", () => {
      test("当图为空时应返回 true", () => {
        expect(graph.isEmpty()).toBe(true);
      });

      test("当图不为空时应返回 false", () => {
        graph.addNodeUnsafe(1);
        expect(graph.isEmpty()).toBe(false);
      });
    });

    describe("isDAG 应判断图是否为有向无环图", () => {
      test("当图为有向无环图时应返回 true", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addNodeUnsafe(3);
        graph.addEdgeUnsafe(1, 2);
        graph.addEdgeUnsafe(2, 3);
        expect(graph.isDAG()).toBe(true);
      });

      test("当图含有环时应返回 false", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addNodeUnsafe(3);
        graph.addEdgeUnsafe(1, 2);
        graph.addEdgeUnsafe(2, 3);
        graph.addEdgeUnsafe(3, 1);
        expect(graph.isDAG()).toBe(false);
      });
    });

    describe("equals 应判断两图是否相等", () => {
      test("当两图相等时应返回 true", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addEdgeUnsafe(1, 2);

        const other = new DirectedGraph();
        other.addNodeUnsafe(1);
        other.addNodeUnsafe(2);
        other.addEdgeUnsafe(1, 2);

        expect(graph.equals(other)).toBe(true);
      });

      test("当两图不等时应返回 false", () => {
        graph.addNodeUnsafe(1);
        graph.addNodeUnsafe(2);
        graph.addEdgeUnsafe(1, 2);

        const other = new DirectedGraph();
        other.addNodeUnsafe(1);
        other.addNodeUnsafe(2);
        other.addEdgeUnsafe(2, 1);

        expect(graph.equals(other)).toBe(false);
      });
    });
  });

  describe("图的持久化", () => {
    test("toJSON 应正确序列化图", () => {
      graph.addNodeUnsafe(1);
      graph.addNodeUnsafe(2);
      graph.addNodeUnsafe(3);
      graph.addEdgeUnsafe(1, 2);
      graph.addEdgeUnsafe(2, 3);
      graph.addEdgeUnsafe(1, 3);

      const out = graph.toArray();
      for (const item of out) {
        switch (item[0]) {
          case 1:
            expect(item[1]).toContain(2);
            expect(item[1]).toContain(3);
            break;
          case 2:
            expect(item[1]).toContain(3);
            break;
          case 3:
            expect(item[1]).toEqual([]);
            break;
        }
      }
    });

    test("toJSON 应正确序列化有着不同类型的节点的图", () => {
      graph.addNodeUnsafe("A");
      graph.addNodeUnsafe("B");
      graph.addNodeUnsafe(3);
      graph.addEdgeUnsafe("A", "B");
      graph.addEdgeUnsafe("B", 3);
      const out = graph.toArray();
      for (const item of out) {
        switch (item[0]) {
          case "A":
            expect(item[1]).toContain("B");
            break;
          case "B":
            expect(item[1]).toContain(3);
            break;
          case 3:
            expect(item[1]).toEqual([]);
            break;
        }
      }
    });

    test("toJSON 应正确序列化空图", () => {
      const out = graph.toArray();
      expect(out).toEqual([]);
    });

    test("parse 应正确反序列化图", () => {
      graph = DirectedGraph.parse([
        [1, [2]],
        [2, [3]],
        [3, []],
      ]);
      expect(graph.hasNode(1)).toBe(true);
      expect(graph.hasNode(2)).toBe(true);
      expect(graph.hasNode(3)).toBe(true);
      expect(graph.hasEdge(1, 2)).toBe(true);
      expect(graph.hasEdge(2, 3)).toBe(true);
      expect(graph.hasEdge(1, 3)).toBe(false);
      expect(graph.adjListR.get(2).has(1)).toBe(true);
      expect(graph.adjListR.get(3).has(2)).toBe(true);
    });

    test("parse 应处理空图", () => {
      const newGraph = DirectedGraph.parse([]);
      expect(newGraph.adjList.size).toBe(0);
      expect(newGraph.adjListR.size).toBe(0);
    });

    test("parse 应处理只有节点的图", () => {
      graph = DirectedGraph.parse([
        [1, []],
        [2, []],
      ]);
      expect(graph.hasNode(1)).toBe(true);
      expect(graph.hasNode(2)).toBe(true);
      expect(graph.adjList.get(1).size).toBe(0);
      expect(graph.adjList.get(2).size).toBe(0);
    });

    test("parse 应处理有不同类型节点的图", () => {
      graph = DirectedGraph.parse([
        ["A", ["B"]],
        ["B", [3]],
        [3, []],
      ]);
      expect(graph.hasNode("A")).toBe(true);
      expect(graph.hasNode("B")).toBe(true);
      expect(graph.hasNode(3)).toBe(true);
      expect(graph.hasEdge("A", "B")).toBe(true);
      expect(graph.hasEdge("B", 3)).toBe(true);
      expect(graph.hasEdge("A", 3)).toBe(false);
    });

    test("parse 应处理自环边", () => {
      graph = DirectedGraph.parse([[1, [1]]]);
      expect(graph.hasNode(1)).toBe(true);
      expect(graph.hasEdge(1, 1)).toBe(true);
    });

    test("parse 应处理多重边", () => {
      graph = DirectedGraph.parse([
        [1, [2, 2]],
        [2, []],
      ]);
      expect(graph.hasNode(1)).toBe(true);
      expect(graph.hasNode(2)).toBe(true);
      expect(graph.hasEdge(1, 2)).toBe(true);
      expect(graph.adjList.get(1).size).toBe(1); // 多重边应被视为单一边
    });
  });

  describe("属性", () => {
    test("size 应返回节点数量", () => {
      expect(graph.size).toBe(0);
      graph.addNodeUnsafe(1);
      expect(graph.size).toBe(1);
      graph.addNodeUnsafe(2);
      expect(graph.size).toBe(2);
    });
  });

  describe("入度与出度", () => {
    test("getInDegreeMap 应返回正确的入度映射", () => {
      graph.addNodeUnsafe(1);
      graph.addNodeUnsafe(2);
      graph.addNodeUnsafe(3);
      graph.addEdgeUnsafe(1, 2);
      graph.addEdgeUnsafe(3, 2);

      const inDegreeMap = graph.getInDegreeMap();
      expect(inDegreeMap.get(1)).toBe(0);
      expect(inDegreeMap.get(2)).toBe(2);
      expect(inDegreeMap.get(3)).toBe(0);
    });

    test("getOutDegreeMap 应返回正确的出度映射", () => {
      graph.addNodeUnsafe(1);
      graph.addNodeUnsafe(2);
      graph.addNodeUnsafe(3);
      graph.addEdgeUnsafe(1, 2);
      graph.addEdgeUnsafe(1, 3);

      const outDegreeMap = graph.getOutDegreeMap();
      expect(outDegreeMap.get(1)).toBe(2);
      expect(outDegreeMap.get(2)).toBe(0);
      expect(outDegreeMap.get(3)).toBe(0);
    });

    test("getNoIncomingNodes 应返回所有入度为 0 的节点", () => {
      graph.addNodeUnsafe(1);
      graph.addNodeUnsafe(2);
      graph.addNodeUnsafe(3);
      graph.addEdgeUnsafe(1, 2);

      const noIncoming = graph.getNoIncomingNodes();
      expect(noIncoming).toContain(1);
      expect(noIncoming).toContain(3);
      expect(noIncoming).not.toContain(2);
    });

    test("getNoOutgoingNodes 应返回所有出度为 0 的节点", () => {
      graph.addNodeUnsafe(1);
      graph.addNodeUnsafe(2);
      graph.addNodeUnsafe(3);
      graph.addEdgeUnsafe(1, 2);

      const noOutgoing = graph.getNoOutgoingNodes();
      expect(noOutgoing).toContain(2);
      expect(noOutgoing).toContain(3);
      expect(noOutgoing).not.toContain(1);
    });
  });
});

describe("DirectedGraph Errors", () => {
  test("NodeNotExistError 应正确设置消息和属性", () => {
    const error = new NodeNotExistError(1);
    expect(error.message).toBe("Node 1 does not exist.");
    expect(error.node).toBe(1);
  });

  test("EdgeNotExistError 应正确设置消息和属性", () => {
    const error = new EdgeNotExistError(1, 2);
    expect(error.message).toBe("Edge from 1 to 2 does not exist.");
    expect(error.from).toBe(1);
    expect(error.to).toBe(2);
  });

  test("NodeAlreadyExistError 应正确设置消息和属性", () => {
    const error = new NodeAlreadyExistError(1);
    expect(error.message).toBe("Node 1 already exists.");
    expect(error.node).toBe(1);
  });

  test("EdgeAlreadyExistError 应正确设置消息和属性", () => {
    const error = new EdgeAlreadyExistError(1, 2);
    expect(error.message).toBe("Edge from 1 to 2 already exists.");
    expect(error.from).toBe(1);
    expect(error.to).toBe(2);
  });
});
