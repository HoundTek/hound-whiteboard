import { Board } from "../board.js";
import { Page } from "../page.js";
import { StrokeObject } from "../../objects/stroke/stroke.js";
import { Vector } from "../../utils/math.js";

describe("Board page grid", () => {
  test("Page 的回字形 id 与二维坐标应可双向转换", () => {
    const samples = [
      [1, 0, 0],
      [2, 1, 0],
      [3, 1, 1],
      [5, -1, 1],
      [9, 1, -1],
      [10, 2, -1],
      [13, 2, 2],
      [17, -2, 2],
    ];

    for (const [id, x, y] of samples) {
      expect(Page.idToCoordinate(id)).toEqual({ x, y });
      expect(Page.coordinateToId(x, y)).toBe(id);
    }
  });

  test("Page 应能判断 id 与坐标是否匹配", () => {
    const validPage = Page.fromId(3);
    const invalidPage = Page.fromId(3);
    invalidPage.id = -1; // 强制设置非法 id

    expect(Page.isValidPageIdentity(3, 1, 1)).toBe(true);
    expect(Page.isValidPageIdentity(3, 2, 0)).toBe(false);
    expect(validPage.isValid()).toBe(true);
    expect(invalidPage.isValid()).toBe(false);
  });

  test("PageLoader 应按区域初始化缓冲范围", () => {
    const board = new Board();
    const pageLoader = board.createPageLoader();

    const neighborhood = pageLoader.initPagesAroundCoordinate(0, 0);
    const currentPage = pageLoader.pageNow;

    expect(currentPage).toEqual(expect.objectContaining({ id: 1, x: 0, y: 0 }));
    expect(
      neighborhood.map((page) => page.id).sort((left, right) => left - right),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(pageLoader.pagesLoadedCount).toBe(9);
  });

  test("Board 的左右邻页应基于二维坐标解析", () => {
    const board = new Board();

    const center = board.getPageById(1);

    expect(board.getNeighborPage(center, "right")).toEqual(
      expect.objectContaining({ id: 2, x: 1, y: 0 }),
    );
    expect(board.getNeighborPage(center, "left")).toEqual(
      expect.objectContaining({ id: 6, x: -1, y: 0 }),
    );
    expect(board.getNeighborPage(center, "up")).toEqual(
      expect.objectContaining({ id: 4, x: 0, y: 1 }),
    );
    expect(board.getNeighborPage(center, "down")).toEqual(
      expect.objectContaining({ id: 8, x: 0, y: -1 }),
    );
  });

  test("Board.addObject 应将对象加入归属页并同步覆盖页索引", () => {
    const board = new Board();
    board.width = 10;
    board.height = 10;

    const stroke = new StrokeObject(new Vector(0, 0), 15, 1);
    stroke.setPathPoints([
      new Vector(1, 1),
      new Vector(19, 1),
      new Vector(19, 19),
    ]);

    board.addObject(stroke);

    const ownerPage = board.getPageById(1);
    expect(ownerPage.objectManager.pageObjects.get(15)).toBe(stroke);
    expect(ownerPage.objectManager.staticGraph.hasNode(15)).toBe(true);
    expect(ownerPage.objectManager.getObjectCoverPages(15)).toEqual(
      new Set([1, 2, 3]),
    );
  });
});
