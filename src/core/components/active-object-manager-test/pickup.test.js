const { DirectedGraph } = require("../../utils/directed-graph");
const { ActiveObjectManager } = require("../active-object-manager");
const { PageManager } = require("../page-manager");
const { onePageData, twoPageData, multiPageData } = require("./data");

describe("ActiveObjectManager/pickup", () => {
  let aom = new ActiveObjectManager();

  beforeEach(() => {
    aom = new ActiveObjectManager();
  });

  function createPage(id) {
    const page = new PageManager(id);
    page.isLoad = true;
    page.isTempLoad = false;
    return page;
  }

  function pageConnect(pageA, pageB) {
    pageA.nextPage = pageB;
    pageB.prevPage = pageA;
  }

  describe("选取无跨页对象的子图", () => {
    let page = createPage(1);

    beforeEach(() => {
      page = createPage(1);
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

      page1.objectManager.staticGraph = DirectedGraph.parse(twoPageData[0]);
      page2.objectManager.staticGraph = DirectedGraph.parse(twoPageData[1]);

      page1.objectManager.coverRightPage = new Set([15, 17, 18]);
      page2.objectManager.coverLeftPage = new Set([15, 17, 18]);
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
    let page1 = createPage(1);
    let page2 = createPage(2);
    let page3 = createPage(3);
    let page4 = createPage(4);
    let page5 = createPage(5);

    beforeEach(() => {
      page1 = createPage(1);
      page2 = createPage(2);
      page3 = createPage(3);
      page4 = createPage(4);
      page5 = createPage(5);

      page1.objectManager.staticGraph = DirectedGraph.parse(multiPageData[0]);
      page2.objectManager.staticGraph = DirectedGraph.parse(multiPageData[1]);
      page3.objectManager.staticGraph = DirectedGraph.parse(multiPageData[2]);
      page4.objectManager.staticGraph = DirectedGraph.parse(multiPageData[3]);
      page5.objectManager.staticGraph = DirectedGraph.parse(multiPageData[4]);

      page1.objectManager.coverRightPage = new Set([3, 18]);
      page2.objectManager.coverLeftPage = new Set([3, 18]);
      page2.objectManager.coverRightPage = new Set([5, 16]);
      page3.objectManager.coverLeftPage = new Set([5, 16]);
      page3.objectManager.coverRightPage = new Set([7, 14]);
      page4.objectManager.coverLeftPage = new Set([7, 14]);
      page4.objectManager.coverRightPage = new Set([9, 12]);
      page5.objectManager.coverLeftPage = new Set([9, 12]);

      pageConnect(page1, page2);
      pageConnect(page2, page3);
      pageConnect(page3, page4);
      pageConnect(page4, page5);
    });

    test("应能选取多对象为起点且含多页跨页对象链的子图", () => {
      const pickup2n19 = aom.pickup(
        new Set([
          { id: 6, page: page3 },
          { id: 19, page: page1 },
        ]),
      );

      const expected2n19 = DirectedGraph.parse([
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

      expect(pickup2n19.equals(expected2n19)).toBe(true);
    });
  });

  describe("特殊情况与边界条件", () => {
    test("应能选取空集的子图", () => {
      const pickupEmpty = aom.pickup(new Set());

      const expectedEmpty = DirectedGraph.parse([]);

      expect(pickupEmpty.equals(expectedEmpty)).toBe(true);
    });
  });
});
