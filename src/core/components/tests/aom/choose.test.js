import { jest } from "@jest/globals";
import { MockPageLoader } from "./page-loader.mock.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Page } from "../../page.js";
import { PageObjectManager } from "../../page-object-manager.js";
import { BasicObject } from "../../../objects/basic-obj.js";
import { Vector } from "../../../utils/math.js";
import { onePageData } from "./data.js";

jest.unstable_mockModule("../../page-loader.js", () => ({
  PageLoader: MockPageLoader,
}));

const { ActiveObjectManager } = await import("../../active-object-manager.js");

describe("ActiveObjectManager/choose", () => {
  let aom = new ActiveObjectManager();
  let page = createPage(1);

  function createPage(id) {
    const page = Page.fromId(id);
    page.isLoad = true;
    page.isTempLoad = false;
    return page;
  }

  function createPageAt(x, y) {
    const page = Page.fromCoordinate(x, y);
    page.isLoad = true;
    page.isTempLoad = false;
    return page;
  }

  function createObject(id, pageId) {
    return new BasicObject(new Vector(0, 0), id, pageId);
  }

  function createBoard(...pages) {
    const pageMap = new Map(pages.map((page) => [page.id, page]));
    return {
      createPageLoader: () => new MockPageLoader(),
      getPageById: (pageId) => pageMap.get(pageId),
    };
  }

  function pageConnect(pageA, pageB) {
    pageA.rightPage = pageB;
    pageB.leftPage = pageA;
  }

  function verticalPageConnect(lowerPage, upperPage) {
    lowerPage.upPage = upperPage;
    upperPage.downPage = lowerPage;
  }

  function setObjectCoverage(pages, objectIds) {
    const pageIds = pages.map((item) => item.id);

    for (const targetPage of pages) {
      for (const objectId of objectIds) {
        targetPage.objectManager.setObjectCoverPages(objectId, pageIds);
      }
    }
  }

  beforeEach(() => {
    page = createPage(1);
    page.objectManager = new PageObjectManager(1);
    page.objectManager.staticGraph = DirectedGraph.parse(onePageData);
    aom = new ActiveObjectManager(createBoard(page));

    // 将 RandomNumberPool Mock 一下
    let idCounter = 0;
    aom.layerPool.generate = () => {
      idCounter += 1;
      return idCounter;
    };
  });

  describe("单次选择对象", () => {
    test("应正确选择单个对象", () => {
      aom.choose(new Set([createObject(12, page.id)]));

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
      aom.choose(
        new Set([
          createObject(12, page.id),
          createObject(13, page.id),
          createObject(8, page.id),
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
      const object12 = createObject(12, page.id);
      const object13 = createObject(13, page.id);
      const object8 = createObject(8, page.id);
      const object5 = createObject(5, page.id);
      aom.choose(
        new Set([
          object12,
          object13,
          object8,
        ]),
      );

      aom.choose(new Set([object5]));

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
      const object12 = createObject(12, page.id);
      const object13 = createObject(13, page.id);
      const object5 = createObject(5, page.id);
      const object8 = createObject(8, page.id);
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
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

      aom.choose(new Set([object8]));

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

  describe("二维跨页选择对象", () => {
    test("应能基于二维覆盖页子图正确分层", () => {
      const centerPage = createPageAt(0, 0);
      const rightPage = createPageAt(1, 0);
      const upPage = createPageAt(0, 1);
      const rightUpPage = createPageAt(1, 1);
      aom = new ActiveObjectManager(
        createBoard(centerPage, rightPage, upPage, rightUpPage),
      );

      centerPage.objectManager = new PageObjectManager(centerPage.id);
      rightPage.objectManager = new PageObjectManager(rightPage.id);
      upPage.objectManager = new PageObjectManager(upPage.id);
      rightUpPage.objectManager = new PageObjectManager(rightUpPage.id);

      centerPage.objectManager.staticGraph = DirectedGraph.parse([
        [100, [101]],
        [101, []],
      ]);
      rightPage.objectManager.staticGraph = DirectedGraph.parse([]);
      upPage.objectManager.staticGraph = DirectedGraph.parse([
        [100, [102]],
        [102, [104]],
        [104, []],
      ]);
      rightUpPage.objectManager.staticGraph = DirectedGraph.parse([
        [100, [103]],
        [103, []],
      ]);

      setObjectCoverage([centerPage, upPage, rightUpPage], [100]);

      pageConnect(centerPage, rightPage);
      verticalPageConnect(centerPage, upPage);
      verticalPageConnect(rightPage, rightUpPage);

      aom.choose(new Set([createObject(100, centerPage.id)]));

      expect(aom.layerOrder.length).toBe(1);
      expect(aom.layerOrder[0].activeObjects).toEqual(new Set([100]));
      expect(
        aom.layerOrder[0].inactiveGraph.equals(
          DirectedGraph.parse([
            [101, []],
            [102, [104]],
            [103, []],
            [104, []],
          ]),
        ),
      ).toBe(true);
    });
  });
});
