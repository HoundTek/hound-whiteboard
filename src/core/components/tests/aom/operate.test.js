import { jest } from "@jest/globals";
import { MockPageLoader } from "./page-loader.mock.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Page } from "../../page.js";
import { PageObjectManager } from "../../page-object-manager.js";
import { StrokeObject } from "../../../objects/stroke/stroke.js";
import { Vector } from "../../../utils/math.js";
import { onePageData } from "./data.js";

jest.unstable_mockModule("../../page-loader.js", () => ({
  PageLoader: MockPageLoader,
}));

const { ActiveObjectManager } = await import("../../active-object-manager.js");

describe("ActiveObjectManager/operate", () => {
  let aom = new ActiveObjectManager();
  let page = createPage(1);

  function createPage(id) {
    const page = Page.fromId(id);
    page.isLoad = true;
    page.isTempLoad = false;
    return page;
  }

  function createObject(id, pageId) {
    const object = new StrokeObject(new Vector(0, 0), id, pageId);
    object.setPathPoints([new Vector(1, 1), new Vector(2, 2)]);
    return object;
  }

  function createBoard(...pages) {
    const pageMap = new Map(pages.map((page) => [page.id, page]));
    return {
      width: 10,
      height: 10,
      createPageLoader: () => new MockPageLoader(),
      getPageById: (pageId) => pageMap.get(pageId),
    };
  }

  beforeEach(() => {
    page = createPage(1);
    page.objectManager = new PageObjectManager(1);
    page.objectManager.staticGraph = DirectedGraph.parse(onePageData);
    aom = new ActiveObjectManager(createBoard(page));
  });

  describe("置顶选择对象", () => {
    test("应正确置顶选择对象", () => {
      const object12 = createObject(12, page.id);
      const object13 = createObject(13, page.id);
      const object5 = createObject(5, page.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 置顶 5
      aom.liftup(new Set([object5]));

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
      const object12 = createObject(12, page.id);
      const object13 = createObject(13, page.id);
      const object5 = createObject(5, page.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 置顶 5, 13
      aom.liftup(new Set([object5, object13]));

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
      const object12 = createObject(12, page.id);
      const object13 = createObject(13, page.id);
      const object5 = createObject(5, page.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 取消选择 5
      aom.apply(new Set([object5]));

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
      const object12 = createObject(12, page.id);
      const object13 = createObject(13, page.id);
      const object5 = createObject(5, page.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 取消选择 5, 13
      aom.apply(new Set([object5, object13]));

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
      const object12 = createObject(12, page.id);
      const object13 = createObject(13, page.id);
      const object5 = createObject(5, page.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 取消选择 12, 13
      aom.apply(new Set([object12, object13]));

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
      const object12 = createObject(12, page.id);
      const object7 = createObject(7, page.id);
      const object8 = createObject(8, page.id);
      const object4 = createObject(4, page.id);
      const object5 = createObject(5, page.id);
      // 选 12, 7, 8, 4, 5
      aom.choose(
        new Set([
          object12,
          object7,
          object8,
          object4,
          object5,
        ]),
      );
      // 置顶 7, 8
      aom.liftup(new Set([object7, object8]));
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
      const object12 = createObject(12, page.id);
      const object13 = createObject(13, page.id);
      const object5 = createObject(5, page.id);
      // 选 12, 13, 5
      aom.choose(
        new Set([
          object12,
          object13,
          object5,
        ]),
      );
      // 置顶 12, 13
      aom.liftup(new Set([object12, object13]));

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
