const { MockPageLoadManager } = require("./page-load-manager.mock");

jest.mock("../../page-load-manager", () => ({
  PageLoadManager: MockPageLoadManager,
}));

const { DirectedGraph } = require("../../../utils/directed-graph");
const { ActiveObjectManager } = require("../../active-object-manager");
const { PageManager } = require("../../page-manager");
const { onePageData } = require("./data");

describe("ActiveObjectManager/operate", () => {
  let aom = new ActiveObjectManager();
  let page = createPage(1);

  function createPage(id) {
    const page = new PageManager(id);
    page.isLoad = true;
    page.isTempLoad = false;
    return page;
  }

  beforeEach(() => {
    aom = new ActiveObjectManager();
    page = createPage(1);
    page.objectManager.staticGraph = DirectedGraph.parse(onePageData);
  });

  describe("置顶选择对象", () => {
    test("应正确置顶选择对象", () => {
      // 选 12, 13, 5
      aom.choose(
        new Set([
          { id: 12, page: page },
          { id: 13, page: page },
          { id: 5, page: page },
        ]),
      );
      // 置顶 5
      aom.liftup(new Set([5]));

      const expectedActiveSet = [new Set([12, 13]), new Set(), new Set([5])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, [4]],
          [8, [4]],
          [9, [6]],
          [4, []],
          [6, []],
        ]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
        DirectedGraph.parse([]),
      ];

      expect(aom.layerOrder.length).toBe(3);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });

    test("应正确置顶多个对象", () => {
      // 选 12, 13, 5
      aom.choose(
        new Set([
          { id: 12, page: page },
          { id: 13, page: page },
          { id: 5, page: page },
        ]),
      );
      // 置顶 5, 13
      aom.liftup(new Set([5, 13]));

      const expectedActiveSet = [
        new Set([12]),
        new Set(),
        new Set([13]),
        new Set([5]),
      ];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, [4]],
          [8, [4]],
          [9, [6]],
          [4, []],
          [6, []],
        ]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
        DirectedGraph.parse([]),
        DirectedGraph.parse([]),
      ];

      expect(aom.layerOrder.length).toBe(4);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });
  });

  describe("取消选择对象", () => {
    test("应正确取消选择单个对象", () => {
      // 选 12, 13, 5
      aom.choose(
        new Set([
          { id: 12, page: page },
          { id: 13, page: page },
          { id: 5, page: page },
        ]),
      );
      // 取消选择 5
      aom.remove(new Set([5]));

      const expectedActiveSet = [new Set([12, 13]), new Set()];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, [4]],
          [8, [4]],
          [9, [6]],
          [4, []],
          [6, []],
        ]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(2);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });

    test("应正确取消选择多个对象 #1", () => {
      // 选 12, 13, 5
      aom.choose(
        new Set([
          { id: 12, page: page },
          { id: 13, page: page },
          { id: 5, page: page },
        ]),
      );
      // 取消选择 5, 13
      aom.remove(new Set([5, 13]));

      const expectedActiveSet = [new Set([12]), new Set()];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, [4]],
          [8, [4]],
          [9, [6]],
          [4, []],
          [6, []],
        ]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(2);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });

    test("应正确取消选择多个对象 #2", () => {
      // 选 12, 13, 5
      aom.choose(
        new Set([
          { id: 12, page: page },
          { id: 13, page: page },
          { id: 5, page: page },
        ]),
      );
      // 取消选择 12, 13
      aom.remove(new Set([12, 13]));

      const expectedActiveSet = [new Set([5])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(1);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });
  });

  describe("清理动态图", () => {
    test("应能正确去除空层", () => {
      // 选 12, 7, 8, 4, 5
      aom.choose(
        new Set([
          { id: 12, page: page },
          { id: 7, page: page },
          { id: 8, page: page },
          { id: 4, page: page },
          { id: 5, page: page },
        ]),
      );
      // 置顶 7, 8
      aom.liftup(new Set([7, 8]));
      const expectedActiveSet = [
        new Set([12]),
        new Set([4, 5]),
        new Set([7, 8]),
      ];
      const expectedInactiveGraph = [
        DirectedGraph.parse([]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
        DirectedGraph.parse([]),
      ];

      expect(aom.layerOrder.length).toBe(3);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });

    test("应能正确去除不能被活动对象到达的层", () => {
      // 选 12, 13, 5
      aom.choose(
        new Set([
          { id: 12, page: page },
          { id: 13, page: page },
          { id: 5, page: page },
        ]),
      );
      // 置顶 12, 13
      aom.liftup(new Set([12, 13]));

      const expectedActiveSet = [new Set([5]), new Set([12, 13])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
        DirectedGraph.parse([]),
      ];

      expect(aom.layerOrder.length).toBe(2);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });
  });
});
