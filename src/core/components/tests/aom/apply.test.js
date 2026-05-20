import { jest } from "@jest/globals";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Vector } from "../../../utils/math.js";
import { BasicObject } from "../../../objects/basic-obj.js";
import { ActiveObjectManager } from "../../active-object-manager.js";
import { Board } from "../../board.js";
import { Page } from "../../page.js";
import { PageObjectManager } from "../../page-object-manager.js";
import { StrokeObject } from "../../../objects/stroke/stroke.js";
import { MockPageLoader } from "./page-loader.mock.js";
import { onePageData } from "./data.js";

describe("ActiveObjectManager/apply", () => {
  function createPage(id) {
    const page = Page.fromId(id);
    page.isLoad = true;
    page.isTempLoad = false;
    return page;
  }

  test("pickup 应优先使用 Board.createPageLoader 且不再要求 Page 入参", () => {
    const page = createPage(1);
    page.objectManager = new PageObjectManager(1);
    page.objectManager.staticGraph = DirectedGraph.parse(onePageData);

    const board = {
      createPageLoader: jest.fn(() => new MockPageLoader()),
      getPageById: jest.fn((pageId) => (pageId === 1 ? page : undefined)),
    };
    const aom = new ActiveObjectManager(board);

    const pickup8 = aom.pickup(
      new Set([new BasicObject(new Vector(0, 0), 8, 1)]),
    );
    const expected8 = DirectedGraph.parse([
      [8, [4, 5]],
      [4, [2]],
      [5, [2, 3]],
      [2, [1]],
      [3, [1]],
      [1, []],
    ]);

    expect(board.createPageLoader).toHaveBeenCalled();
    expect(pickup8.equals(expected8)).toBe(true);
  });

  test("add 应将白板外新对象注册到动态图顶层", () => {
    const aom = new ActiveObjectManager();
    const lower = new StrokeObject(new Vector(0, 0), 30, 1);
    lower.setPathPoints([new Vector(1, 1), new Vector(5, 5)]);
    const upper = new StrokeObject(new Vector(0, 0), 31, 1);
    upper.setPathPoints([new Vector(2, 2), new Vector(6, 6)]);

    const firstLayer = aom.add(new Set([lower]));
    const secondLayer = aom.add(new Set([upper]));

    expect(firstLayer.activeObjects).toEqual(new Set([30]));
    expect(secondLayer.activeObjects).toEqual(new Set([31]));
    expect(aom.activeObjects).toEqual(new Set([lower, upper]));
    expect(aom.layerOrder).toEqual([firstLayer, secondLayer]);
    expect(aom.onLayer.get(30)).toBe(firstLayer);
    expect(aom.onLayer.get(31)).toBe(secondLayer);
  });

  test("apply 应将活动对象写回 PageObjectManager 并同步覆盖页索引", () => {
    const board = new Board();
    board.width = 10;
    board.height = 10;

    const stroke = new StrokeObject(new Vector(0, 0), 15, 1);
    stroke.setPathPoints([
      new Vector(1, 1),
      new Vector(19, 1),
      new Vector(19, 19),
    ]);

    board.activeObjectManager.choose(new Set([stroke]));
    board.activeObjectManager.apply(new Set([stroke]));

    const ownerPage = board.getPageById(1);
    const coveredPage = board.getPageById(2);

    expect(board.activeObjectManager.activeObjects.size).toBe(0);
    expect(ownerPage.objectManager.pageObjects.get(15)).toBe(stroke);
    expect(ownerPage.objectManager.getObjectCoverPages(15)).toEqual(
      new Set([1, 2, 3]),
    );
    expect(coveredPage.objectManager.getObjectCoverPages(15)).toEqual(
      new Set([1, 2, 3]),
    );
    expect(ownerPage.objectManager.staticGraph.hasNode(15)).toBe(true);
    expect(coveredPage.objectManager.staticGraph.hasNode(15)).toBe(true);
  });

  test("apply 应根据活动层顺序为相交对象写回静态图上下关系", () => {
    const board = new Board();
    board.width = 10;
    board.height = 10;

    const lower = new StrokeObject(new Vector(0, 0), 21, 1);
    lower.setPathPoints([new Vector(1, 1), new Vector(8, 8)]);

    const upper = new StrokeObject(new Vector(0, 0), 22, 1);
    upper.setPathPoints([new Vector(2, 2), new Vector(9, 9)]);

    board.activeObjectManager.choose(new Set([lower]));
    board.activeObjectManager.choose(new Set([upper]));
    board.activeObjectManager.apply(new Set([lower, upper]));

    const ownerPage = board.getPageById(1);
    expect(ownerPage.objectManager.staticGraph.hasNode(21)).toBe(true);
    expect(ownerPage.objectManager.staticGraph.hasNode(22)).toBe(true);
    expect(ownerPage.objectManager.staticGraph.hasEdge(21, 22)).toBe(true);
  });
});
