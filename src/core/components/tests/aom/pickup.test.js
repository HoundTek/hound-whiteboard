import { jest } from "@jest/globals";
import { MockPageLoader } from "./page-loader.mock.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Page } from "../../page.js";
import { PageObjectManager } from "../../page-object-manager.js";
import { onePageData, twoPageData, multiPageData } from "./data.js";

jest.unstable_mockModule("../../page-loader.js", () => ({
  PageLoader: MockPageLoader,
}));

const { ActiveObjectManager } = await import("../../active-object-manager.js");

describe("ActiveObjectManager/pickup", () => {
  let aom = new ActiveObjectManager();

  beforeEach(() => {
    aom = new ActiveObjectManager();
  });

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

  function pageConnect(pageA, pageB) {
    pageA.rightPage = pageB;
    pageB.leftPage = pageA;
  }

  function verticalPageConnect(lowerPage, upperPage) {
    lowerPage.upPage = upperPage;
    upperPage.downPage = lowerPage;
  }

  function setObjectCoverage(pages, objectIds) {
    const pageIds = pages.map((page) => page.id);

    for (const page of pages) {
      for (const objectId of objectIds) {
        page.objectManager.setObjectCoverPages(objectId, pageIds);
      }
    }
  }

  describe("选取无跨页对象的子图", () => {
    let page = createPage(1);

    beforeEach(() => {
      page = createPage(1);
      page.objectManager = new PageObjectManager(1);
      page.objectManager.staticGraph = DirectedGraph.parse(onePageData);
    });

    test("应能选取单对象为起点且无跨页对象的子图", () => {
      const pickup8 = aom.pickup(new Set([{ id: 8, page: page }]));

      const expected8 = DirectedGraph.parse([
        [8, [4, 5]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
      ]);

      expect(pickup8.equals(expected8)).toBe(true);

      const pickup11 = aom.pickup(new Set([{ id: 11, page: page }]));

      const expected11 = DirectedGraph.parse([
        [11, [7]],
        [7, [4]],
        [4, [2]],
        [2, [1]],
        [1, []],
      ]);

      expect(pickup11.equals(expected11)).toBe(true);
    });

    test("应能选取多对象为起点且无跨页对象的子图", () => {
      const pickup8n15 = aom.pickup(
        new Set([
          { id: 8, page: page },
          { id: 15, page: page },
        ]),
      );

      const expected8n15 = DirectedGraph.parse([
        [8, [4, 5]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
        [15, [10]],
        [10, [6]],
        [6, [3]],
        [3, [1]],
      ]);

      expect(pickup8n15.equals(expected8n15)).toBe(true);
    });
  });

  describe("选取含跨页对象的子图", () => {
    let page1 = createPage(1);
    let page2 = createPage(2);

    beforeEach(() => {
      page1 = createPage(1);
      page2 = createPage(2);

      pageConnect(page1, page2);

      page1.objectManager = new PageObjectManager(1);
      page2.objectManager = new PageObjectManager(2);

      page1.objectManager.staticGraph = DirectedGraph.parse(twoPageData[0]);
      page2.objectManager.staticGraph = DirectedGraph.parse(twoPageData[1]);

      setObjectCoverage([page1, page2], [15, 17, 18]);
    });

    test("应能选取单对象为起点且含跨页对象的子图", () => {
      const pickup18 = aom.pickup(new Set([{ id: 18, page: page2 }]));

      const expected18 = DirectedGraph.parse([
        [18, [6]],
        [6, [3]],
        [3, [1]],
        [1, []],
      ]);

      expect(pickup18.equals(expected18)).toBe(true);

      const pickup15 = aom.pickup(new Set([{ id: 15, page: page1 }]));

      const expected15 = DirectedGraph.parse([
        [15, [10, 16]],
        [16, [17]],
        [17, [18]],
        [18, [6]],
        [10, [6, 17]],
        [6, [3]],
        [3, [1]],
        [1, []],
      ]);

      expect(pickup15.equals(expected15)).toBe(true);
    });

    test("应能选取多对象为起点且含跨页对象的子图", () => {
      const pickup8n10 = aom.pickup(
        new Set([
          { id: 8, page: page1 },
          { id: 10, page: page1 },
        ]),
      );

      const expected8n10 = DirectedGraph.parse([
        [8, [4, 5]],
        [10, [6, 17]],
        [17, [18]],
        [18, [6]],
        [6, [3]],
        [4, [2]],
        [5, [2, 3]],
        [2, [1]],
        [3, [1]],
        [1, []],
      ]);

      expect(pickup8n10.equals(expected8n10)).toBe(true);
    });
  });

  describe("选取含多页的跨页对象链的子图", () => {
    let page1 = createPageAt(0, 0);
    let page2 = createPageAt(1, 0);
    let page3 = createPageAt(2, 0);
    let page4 = createPageAt(3, 0);
    let page5 = createPageAt(4, 0);

    beforeEach(() => {
      page1 = createPageAt(0, 0);
      page2 = createPageAt(1, 0);
      page3 = createPageAt(2, 0);
      page4 = createPageAt(3, 0);
      page5 = createPageAt(4, 0);

      page1.objectManager = new PageObjectManager(page1.id);
      page2.objectManager = new PageObjectManager(page2.id);
      page3.objectManager = new PageObjectManager(page3.id);
      page4.objectManager = new PageObjectManager(page4.id);
      page5.objectManager = new PageObjectManager(page5.id);

      page1.objectManager.staticGraph = DirectedGraph.parse(multiPageData[0]);
      page2.objectManager.staticGraph = DirectedGraph.parse(multiPageData[1]);
      page3.objectManager.staticGraph = DirectedGraph.parse(multiPageData[2]);
      page4.objectManager.staticGraph = DirectedGraph.parse(multiPageData[3]);
      page5.objectManager.staticGraph = DirectedGraph.parse(multiPageData[4]);

      setObjectCoverage([page1, page2], [3, 18]);
      setObjectCoverage([page2, page3], [5, 16]);
      setObjectCoverage([page3, page4], [7, 14]);
      setObjectCoverage([page4, page5], [9, 12]);

      pageConnect(page1, page2);
      pageConnect(page2, page3);
      pageConnect(page3, page4);
      pageConnect(page4, page5);
    });

    test("应能选取多对象为起点且含多页跨页对象链的子图", () => {
      const pickup6n19 = aom.pickup(
        new Set([
          { id: 6, page: page3 },
          { id: 19, page: page1 },
        ]),
      );

      const expected6n19 = DirectedGraph.parse([
        [6, [7]],
        [7, [8]],
        [8, [9]],
        [9, [10]],
        [10, [11]],
        [11, [12]],
        [12, [13]],
        [13, [14]],
        [14, [15]],
        [15, [16]],
        [16, [17]],
        [17, [18]],
        [18, [19]],
        [19, [20]],
        [20, []],
      ]);

      console.log(pickup6n19.toString());

      expect(pickup6n19.equals(expected6n19)).toBe(true);
    });
  });

  describe("特殊情况与边界条件", () => {
    test("应能在二维页中先横向后纵向移动，并在回到原页后继续遍历其它覆盖页", () => {
      const centerPage = createPageAt(0, 0);
      const rightPage = createPageAt(1, 0);
      const upPage = createPageAt(0, 1);
      const rightUpPage = createPageAt(1, 1);

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
        [100, [103]],
        [103, []],
      ]);
      rightUpPage.objectManager.staticGraph = DirectedGraph.parse([
        [100, [104]],
        [104, []],
      ]);

      setObjectCoverage([centerPage, upPage, rightUpPage], [100]);

      pageConnect(centerPage, rightPage);
      verticalPageConnect(centerPage, upPage);
      verticalPageConnect(rightPage, rightUpPage);

      const pickup = aom.pickup(new Set([{ id: 100, page: centerPage }]));
      const expected = DirectedGraph.parse([
        [100, [101, 103, 104]],
        [101, []],
        [103, []],
        [104, []],
      ]);

      expect(pickup.equals(expected)).toBe(true);
    });

    test("应能在二维页中向左下方向移动到覆盖页", () => {
      const centerPage = createPageAt(0, 0);
      const upperPage = createPageAt(0, 1);
      const startPage = createPageAt(1, 1);

      centerPage.objectManager = new PageObjectManager(centerPage.id);
      upperPage.objectManager = new PageObjectManager(upperPage.id);
      startPage.objectManager = new PageObjectManager(startPage.id);

      centerPage.objectManager.staticGraph = DirectedGraph.parse([
        [200, [201]],
        [201, []],
      ]);
      upperPage.objectManager.staticGraph = DirectedGraph.parse([]);
      startPage.objectManager.staticGraph = DirectedGraph.parse([
        [200, [202]],
        [202, []],
      ]);

      setObjectCoverage([startPage, centerPage], [200]);

      pageConnect(upperPage, startPage);
      verticalPageConnect(centerPage, upperPage);

      const pickup = aom.pickup(new Set([{ id: 200, page: startPage }]));
      const expected = DirectedGraph.parse([
        [200, [201, 202]],
        [201, []],
        [202, []],
      ]);

      expect(pickup.equals(expected)).toBe(true);
    });

    test("应能选取空集的子图", () => {
      const pickupEmpty = aom.pickup(new Set());

      const expectedEmpty = DirectedGraph.parse([]);

      expect(pickupEmpty.equals(expectedEmpty)).toBe(true);
    });

    test("当某个二维覆盖页不可达时，应跳过该页并继续处理其它可达覆盖页", () => {
      const centerPage = createPageAt(0, 0);
      const upPage = createPageAt(0, 1);
      const unreachablePage = createPageAt(1, 1);

      centerPage.objectManager = new PageObjectManager(centerPage.id);
      upPage.objectManager = new PageObjectManager(upPage.id);
      unreachablePage.objectManager = new PageObjectManager(unreachablePage.id);

      centerPage.objectManager.staticGraph = DirectedGraph.parse([[300, []]]);
      upPage.objectManager.staticGraph = DirectedGraph.parse([
        [300, [302]],
        [302, []],
      ]);
      unreachablePage.objectManager.staticGraph = DirectedGraph.parse([
        [300, [301]],
        [301, []],
      ]);

      setObjectCoverage([centerPage, upPage, unreachablePage], [300]);

      verticalPageConnect(centerPage, upPage);

      const pickup = aom.pickup(new Set([{ id: 300, page: centerPage }]));
      const expected = DirectedGraph.parse([
        [300, [302]],
        [302, []],
      ]);

      expect(pickup.equals(expected)).toBe(true);
    });
  });
});
