const { MockPageLoadManager } = require("./page-load-manager.mock");

jest.mock("../../page-load-manager", () => ({
  PageLoadManager: MockPageLoadManager,
}));

const { DirectedGraph } = require("../../../utils/directed-graph");
const { ActiveObjectManager } = require("../../active-object-manager");
const { PageManager } = require("../../page-manager");
const { onePageData } = require("./data");

describe("ActiveObjectManager/choose", () => {
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

    // 将 RandomNumberPool Mock 一下
    let idCounter = 0;
    aom.layerPool.generate = () => {
      idCounter += 1;
      return idCounter;
    };
  });

  describe("单次选择对象", () => {
    test("应正确选择单个对象", () => {
      // 选 12
      aom.choose(new Set([{ id: 12, page: page }]));

      const expectedActiveSet = new Set([12]);
      const expectedInactiveGraph = DirectedGraph.parse([
        [7, [4]],
        [8, [4, 5]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
      ]);

      expect(aom.layerOrder.length).toBe(1);
      expect(aom.layerOrder[0].activeObjects).toEqual(expectedActiveSet);
      expect(
        aom.layerOrder[0].inactiveGraph.equals(expectedInactiveGraph),
      ).toBe(true);
    });

    test("应正确选择多个对象", () => {
      // 选 12, 13, 8
      aom.choose(
        new Set([
          { id: 12, page: page },
          { id: 13, page: page },
          { id: 8, page: page },
        ]),
      );

      const expectedActiveSet = [new Set([12, 13]), new Set([8])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, []],
          [9, [6]],
          [6, []],
        ]),
        DirectedGraph.parse([
          [5, [2, 3]],
          [4, [2]],
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
  });

  describe("多次选择对象", () => {
    test("应正确在已有选择的对象上再次选择单个对象", () => {
      // 选 12, 13, 8
      aom.choose(
        new Set([
          { id: 12, page: page },
          { id: 13, page: page },
          { id: 8, page: page },
        ]),
      );

      // 在上面基础上再选 5
      aom.choose(new Set([{ id: 5, page: page }]));

      const expectedActiveSet = [new Set([12, 13]), new Set([8]), new Set([5])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, []],
          [9, [6]],
          [6, []],
        ]),
        DirectedGraph.parse([[4, []]]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(3);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });

    test("应正确在已有选择的对象间再次选择单个对象", () => {
      // 选 12, 13, 5
      aom.choose(
        new Set([
          { id: 12, page: page },
          { id: 13, page: page },
          { id: 5, page: page },
        ]),
      );

      const expectedActiveSet1 = [new Set([12, 13]), new Set([5])];
      const expectedInactiveGraph1 = [
        DirectedGraph.parse([
          [7, [4]],
          [8, [4]],
          [9, [6]],
          [6, []],
          [4, []],
        ]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(2);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet1[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph1[i]),
        ).toBe(true);
      }

      // 在上面基础上再选 8
      aom.choose(new Set([{ id: 8, page: page }]));

      const expectedActiveSet = [new Set([12, 13]), new Set([8]), new Set([5])];
      const expectedInactiveGraph = [
        DirectedGraph.parse([
          [7, []],
          [9, [6]],
          [6, []],
        ]),
        DirectedGraph.parse([[4, []]]),
        DirectedGraph.parse([
          [2, [1]],
          [3, [1]],
          [1, []],
        ]),
      ];

      expect(aom.layerOrder.length).toBe(3);
      for (let i = 0; i < aom.layerOrder.length; i++) {
        expect(aom.layerOrder[i].activeObjects).toEqual(expectedActiveSet[i]);
        expect(
          aom.layerOrder[i].inactiveGraph.equals(expectedInactiveGraph[i]),
        ).toBe(true);
      }
    });
  });
});
